/**
 * Central de Arquivos (/api/v1/arquivos) — ciclo de vida completo.
 *
 *   leitor    consulta, versões, trilha, download de qualquer versão
 *   analista  envio, nova versão, metadados, arquivar, reativar, excluir,
 *             restaurar versão, exportar
 *   admin     expurgo definitivo
 *
 * Upload e download são em FLUXO: o arquivo nunca é carregado inteiro na
 * memória da API, qualquer que seja o tamanho.
 */
import { FINALIDADES_ARQUIVO, SITUACOES_ARQUIVO } from '@monitoramento/dominio'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Dependencias } from '../../composicao'
import { exigir } from '../autenticacao'
import { ErroHttp } from '../erros'
import { filtrosDe } from './negocio'

const uuid = z.string().uuid('identificador de arquivo inválido')
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data no formato yyyy-MM-dd')
const categoria = z.string().trim().min(1, 'categoria obrigatória').max(80)
const textoLivre = z.string().trim().max(2000)
const recursoTipo = z.string().trim().regex(/^[a-z][a-z0-9_-]{0,39}$/, 'tipo de vínculo inválido')
const recursoId = z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/, 'vínculo inválido')
const tags = z.record(z.string().trim().min(1).max(60), z.string().trim().max(500)).refine((t) => Object.keys(t).length <= 30, 'no máximo 30 etiquetas')
const motivo = z.string().trim().min(5, 'informe o motivo (mínimo 5 caracteres)').max(500)

/** Tipos seguros para abrir no próprio navegador; o resto sai sempre como anexo. */
const VISUALIZAVEIS = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'])

const vazioParaIndefinido = (v: unknown) => (v === '' ? undefined : v)

const esquemaEnvio = z.object({
  finalidade: z.enum(FINALIDADES_ARQUIVO as [string, ...string[]]).default('anexo'),
  categoria: categoria.default('geral'),
  descricao: z.preprocess(vazioParaIndefinido, textoLivre.optional()),
  recursoTipo: z.preprocess(vazioParaIndefinido, recursoTipo.optional()),
  recursoId: z.preprocess(vazioParaIndefinido, recursoId.optional()),
  arquivoOrigemId: z.preprocess(vazioParaIndefinido, uuid.optional()),
  retencaoAte: z.preprocess(vazioParaIndefinido, data.optional()),
  tags: z.preprocess((v) => (typeof v === 'string' && v ? JSON.parse(v) : undefined), tags.optional()),
  comentario: z.preprocess(vazioParaIndefinido, textoLivre.optional()),
})

function nomeParaCabecalho(nome: string): string {
  const ascii = nome.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`
}

export async function rotasArquivos(app: FastifyInstance, deps: Dependencias): Promise<void> {
  const leitor = { preHandler: exigir(deps, 'leitor') }
  const analista = { preHandler: exigir(deps, 'analista') }
  const admin = { preHandler: exigir(deps, 'admin') }
  const servico = deps.servicos.arquivos
  const ator = (r: FastifyRequest) => ({ id: r.ator!.id, email: r.ator!.email })

  /** Lê o multipart em fluxo: campos ANTES do arquivo, arquivo por último. */
  async function receberArquivo(request: FastifyRequest) {
    const parte = await request.file({
      limits: { fileSize: deps.cfg.arquivos.maxBytes ?? Number.MAX_SAFE_INTEGER, files: 1, fields: 20, fieldSize: 16 * 1024 },
    })
    if (!parte || parte.fieldname !== 'arquivo') throw new ErroHttp(400, 'Envie o arquivo no campo "arquivo" (depois dos demais campos).', 'arquivo_ausente')
    const campos: Record<string, string> = {}
    for (const [nome, valor] of Object.entries(parte.fields)) {
      const v = Array.isArray(valor) ? valor[0] : valor
      if (v && v.type === 'field') campos[nome] = String(v.value)
    }
    let dados: z.infer<typeof esquemaEnvio>
    try {
      dados = esquemaEnvio.parse(campos)
    } catch (erro) {
      parte.file.resume() // descarta o corpo para liberar a conexão
      throw erro
    }
    return { fluxo: parte.file, nome: parte.filename || 'arquivo', dados }
  }

  // ------------------------------------------------------------ consulta
  app.get('/api/v1/arquivos', leitor, (request) => {
    const q = z
      .object({
        finalidade: z.preprocess(vazioParaIndefinido, z.enum(FINALIDADES_ARQUIVO as [string, ...string[]]).optional()),
        situacao: z.preprocess(vazioParaIndefinido, z.enum(SITUACOES_ARQUIVO as [string, ...string[]]).optional()),
        categoria: z.preprocess(vazioParaIndefinido, categoria.optional()),
        recursoTipo: z.preprocess(vazioParaIndefinido, recursoTipo.optional()),
        recursoId: z.preprocess(vazioParaIndefinido, recursoId.optional()),
        busca: z.preprocess(vazioParaIndefinido, z.string().trim().max(120).optional()),
        pagina: z.coerce.number().int().min(1).max(100000).default(1),
        porPagina: z.coerce.number().int().min(1).max(100).default(25),
      })
      .parse(request.query)
    return servico.listar(q as never)
  })
  app.get('/api/v1/arquivos/categorias', leitor, () => servico.categorias())
  app.get('/api/v1/arquivos/totais', leitor, () => servico.totais())
  app.get('/api/v1/arquivos/:arquivoId', leitor, (request) => servico.obter(z.object({ arquivoId: uuid }).parse(request.params).arquivoId))
  app.get('/api/v1/arquivos/:arquivoId/versoes', leitor, (request) => servico.versoes(z.object({ arquivoId: uuid }).parse(request.params).arquivoId))
  app.get('/api/v1/arquivos/:arquivoId/eventos', leitor, (request) => servico.eventos(z.object({ arquivoId: uuid }).parse(request.params).arquivoId))

  app.get('/api/v1/arquivos/:arquivoId/conteudo', leitor, async (request, reply) => {
    const { arquivoId } = z.object({ arquivoId: uuid }).parse(request.params)
    const { versao, visualizar } = z
      .object({ versao: z.coerce.number().int().min(1).optional(), visualizar: z.enum(['0', '1']).optional() })
      .parse(request.query)
    const c = await servico.baixar(arquivoId, versao ?? null, ator(request))
    const inline = visualizar === '1' && VISUALIZAVEIS.has(c.mime)
    return reply
      .header('content-type', inline ? c.mime : c.mime === 'text/html' ? 'application/octet-stream' : c.mime)
      .header('content-length', String(c.tamanhoBytes))
      .header('content-disposition', `${inline ? 'inline' : 'attachment'}; ${nomeParaCabecalho(c.nomeOriginal)}`)
      .header('x-content-type-options', 'nosniff')
      .header('x-arquivo-sha256', c.sha256)
      .header('x-arquivo-versao', String(c.versao))
      .header('cache-control', 'private, no-store')
      .send(c.fluxo)
  })

  // ------------------------------------------------------------ entrada
  app.post('/api/v1/arquivos', analista, async (request, reply) => {
    const { fluxo, nome, dados } = await receberArquivo(request)
    const { comentario: _c, ...envio } = dados
    const criado = await servico.enviar(fluxo, { ...envio, finalidade: envio.finalidade as never, nomeOriginal: nome }, ator(request))
    return reply.status(201).send(criado)
  })

  app.post('/api/v1/arquivos/:arquivoId/versoes', analista, async (request, reply) => {
    const { arquivoId } = z.object({ arquivoId: uuid }).parse(request.params)
    const { fluxo, nome, dados } = await receberArquivo(request)
    return reply.status(201).send(await servico.novaVersao(arquivoId, fluxo, nome, dados.comentario ?? null, ator(request)))
  })

  app.post('/api/v1/arquivos/:arquivoId/versoes/:numero/restaurar', analista, (request) => {
    const { arquivoId, numero } = z.object({ arquivoId: uuid, numero: z.coerce.number().int().min(1) }).parse(request.params)
    return servico.restaurarVersao(arquivoId, numero, ator(request))
  })

  // ------------------------------------------------------------ metadados
  app.patch('/api/v1/arquivos/:arquivoId', analista, (request) => {
    const { arquivoId } = z.object({ arquivoId: uuid }).parse(request.params)
    const corpo = z
      .object({
        descricao: textoLivre.nullable().optional(),
        categoria: categoria.optional(),
        tags: tags.optional(),
        retencaoAte: data.nullable().optional(),
        recursoTipo: recursoTipo.nullable().optional(),
        recursoId: recursoId.nullable().optional(),
      })
      .strict()
      .parse(request.body ?? {})
    return servico.atualizarMetadados(arquivoId, corpo, ator(request))
  })

  // ------------------------------------------------------------ situação
  app.post('/api/v1/arquivos/:arquivoId/arquivar', analista, (request) => servico.arquivar(z.object({ arquivoId: uuid }).parse(request.params).arquivoId, ator(request)))
  app.post('/api/v1/arquivos/:arquivoId/reativar', analista, (request) => servico.reativar(z.object({ arquivoId: uuid }).parse(request.params).arquivoId, ator(request)))
  app.post('/api/v1/arquivos/:arquivoId/excluir', analista, (request) => {
    const { arquivoId } = z.object({ arquivoId: uuid }).parse(request.params)
    return servico.excluir(arquivoId, z.object({ motivo }).parse(request.body ?? {}).motivo, ator(request))
  })
  app.post('/api/v1/arquivos/:arquivoId/expurgar', admin, (request) => {
    const { arquivoId } = z.object({ arquivoId: uuid }).parse(request.params)
    return servico.expurgar(arquivoId, z.object({ motivo }).parse(request.body ?? {}).motivo, ator(request))
  })

  // ------------------------------------------------------------ exportações
  app.get('/api/v1/exportacoes', leitor, () => deps.servicos.exportacao.disponiveis())
  app.post('/api/v1/exportacoes/:chave', analista, async (request, reply) => {
    const { chave } = z.object({ chave: z.string().regex(/^[a-z0-9-]{1,40}$/) }).parse(request.params)
    // Mesmos filtros cruzados das telas, com a mesma validação.
    return reply.status(201).send(await deps.servicos.exportacao.exportar(chave, filtrosDe(request.body ?? {}), ator(request)))
  })
}
