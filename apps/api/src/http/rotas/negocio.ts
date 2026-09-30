/**
 * Rotas de negócio (/api/v1). Leitura exige perfil `leitor`; registro de
 * decisões, checklist e importação exigem `analista`; configuração exige
 * `admin`. Toda entrada é validada por esquema antes de chegar ao caso de uso.
 */
import { ITENS_CHECKLIST, DIMENSOES_RISCO, type FiltrosGlobais } from '@monitoramento/dominio'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Dependencias } from '../../composicao'
import { exigir } from '../autenticacao'
import { ErroHttp } from '../erros'

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data no formato yyyy-MM-dd')
const id = z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/, 'identificador inválido')
const textoCurto = z.string().trim().max(200)

const esquemaFiltros = z.object({
  semanaRef: data.optional(),
  plataformaId: id.optional(),
  gerenteId: id.optional(),
  clienteId: id.optional(),
  grupoEconomicoId: id.optional(),
  status: z.enum(['NORMAL', 'MONITORAMENTO', 'SAIDA_DE_RISCO', 'JURIDICO']).optional(),
  prioridade: z.enum(['BAIXA', 'MEDIA', 'ALTA']).optional(),
  setor: textoCurto.optional(),
  ramoAtividade: textoCurto.optional(),
  produto: textoCurto.optional(),
})

export function filtrosDe(query: unknown): Partial<FiltrosGlobais> {
  const bruto = Object.fromEntries(Object.entries((query ?? {}) as Record<string, unknown>).filter(([, v]) => v !== '' && v !== undefined && v !== null))
  return esquemaFiltros.parse(bruto)
}

const paramCliente = z.object({ clienteId: id })

export async function rotasNegocio(app: FastifyInstance, deps: Dependencias): Promise<void> {
  const leitor = { preHandler: exigir(deps, 'leitor') }
  const analista = { preHandler: exigir(deps, 'analista') }
  const admin = { preHandler: exigir(deps, 'admin') }
  const { repos, servicos } = deps

  // ------------------------------------------------------------ cadastros
  app.get('/api/v1/cadastros/grupos', leitor, () => repos.cadastros.listarGrupos())
  app.get('/api/v1/cadastros/gerentes', leitor, () => repos.cadastros.listarGerentes())
  app.get('/api/v1/cadastros/plataformas', leitor, () => repos.cadastros.listarPlataformas())

  // ------------------------------------------------------------ clientes
  app.get('/api/v1/clientes', leitor, (request) => repos.clientes.listar(filtrosDe(request.query)))
  app.get('/api/v1/clientes/enriquecidos', leitor, (request) => servicos.carteira.listarEnriquecidos(filtrosDe(request.query)))
  app.get('/api/v1/clientes/valores-distintos', leitor, () => repos.clientes.valoresDistintos())
  app.get('/api/v1/clientes/:clienteId', leitor, async (request) => {
    const { clienteId } = paramCliente.parse(request.params)
    const cliente = await repos.clientes.porId(clienteId)
    if (!cliente) throw new ErroHttp(404, 'Cliente não encontrado.', 'nao_encontrado')
    return cliente
  })

  // ------------------------------------------------------------ snapshots
  app.get('/api/v1/snapshots/semanas', leitor, () => repos.snapshots.semanasDisponiveis())
  app.get('/api/v1/snapshots/cliente/:clienteId', leitor, (request) => repos.snapshots.porCliente(paramCliente.parse(request.params).clienteId))
  app.get('/api/v1/snapshots/cliente/:clienteId/semana/:semanaRef', leitor, async (request) => {
    const p = z.object({ clienteId: id, semanaRef: data }).parse(request.params)
    return (await repos.snapshots.porClienteESemana(p.clienteId, p.semanaRef)) ?? null
  })

  // ------------------------------------------------------------ alertas, eventos, planos
  app.get('/api/v1/alertas', leitor, () => repos.alertas.listarTodos())
  app.get('/api/v1/alertas/cliente/:clienteId', leitor, (request) => repos.alertas.porCliente(paramCliente.parse(request.params).clienteId))
  app.get('/api/v1/eventos/recentes', leitor, (request) => {
    const { limite } = z.object({ limite: z.coerce.number().int().min(1).max(500).default(50) }).parse(request.query)
    return repos.eventos.recentes(limite)
  })
  app.get('/api/v1/eventos/cliente/:clienteId', leitor, (request) => repos.eventos.porCliente(paramCliente.parse(request.params).clienteId))
  app.get('/api/v1/planos', leitor, () => repos.planos.listarTodos())
  app.get('/api/v1/planos/cliente/:clienteId', leitor, (request) => repos.planos.porCliente(paramCliente.parse(request.params).clienteId))

  // ------------------------------------------------------------ carteira
  app.get('/api/v1/saidas-de-risco', leitor, () => repos.carteira.saidasDeRisco())
  app.get('/api/v1/saidas-de-risco/cliente/:clienteId', leitor, async (request) => (await repos.carteira.saidaDeRiscoDoCliente(paramCliente.parse(request.params).clienteId)) ?? null)
  app.get('/api/v1/juridico', leitor, () => repos.carteira.juridico())
  app.get('/api/v1/juridico/cliente/:clienteId', leitor, async (request) => (await repos.carteira.juridicoDoCliente(paramCliente.parse(request.params).clienteId)) ?? null)
  app.get('/api/v1/iasr/registros', leitor, () => servicos.carteira.iasrComEventos())
  app.get('/api/v1/iasr/indicadores', leitor, () => servicos.carteira.indicadoresIasr())
  app.get('/api/v1/movimentos/cliente/:clienteId/analise', leitor, async (request) => (await servicos.carteira.analiseTransacional(paramCliente.parse(request.params).clienteId)) ?? null)

  // ------------------------------------------------------------ dashboard
  app.get('/api/v1/dashboard/kpis', leitor, (request) => servicos.carteira.obterKPIs(filtrosDe(request.query)))
  app.get('/api/v1/dashboard/serie-semanal', leitor, (request) => servicos.carteira.serieEvolucaoSemanal(filtrosDe(request.query)))
  app.get('/api/v1/dashboard/criticidade', leitor, (request) => servicos.carteira.clientesPorCriticidade(filtrosDe(request.query)))
  app.get('/api/v1/dashboard/entradas-saidas', leitor, (request) => servicos.carteira.evolucaoEntradasSaidasMonitoramento(filtrosDe(request.query)))
  app.get('/api/v1/dashboard/risco-por-dimensao', leitor, (request) => {
    const { dimensao, ...resto } = (request.query ?? {}) as Record<string, unknown>
    const d = z.enum(DIMENSOES_RISCO as [string, ...string[]]).parse(dimensao) as (typeof DIMENSOES_RISCO)[number]
    return servicos.carteira.riscoPorDimensao(filtrosDe(resto), d)
  })
  app.get('/api/v1/dashboard/ranking', leitor, (request) => {
    const { dimensao, ...resto } = (request.query ?? {}) as Record<string, unknown>
    const d = z.enum(['gerenteId', 'plataformaId']).parse(dimensao)
    return servicos.carteira.rankingPorDimensao(filtrosDe(resto), d)
  })

  // ------------------------------------------------------------ checklist
  const chavesChecklist = ITENS_CHECKLIST.map((i) => i.chave) as [string, ...string[]]
  app.get('/api/v1/checklist/:clienteId/:semanaRef', leitor, (request) => {
    const p = z.object({ clienteId: id, semanaRef: data }).parse(request.params)
    return servicos.checklist.obter(p.clienteId, p.semanaRef)
  })
  app.put('/api/v1/checklist/:clienteId/:semanaRef/:item', analista, async (request, reply) => {
    const p = z.object({ clienteId: id, semanaRef: data, item: z.enum(chavesChecklist) }).parse(request.params)
    const corpo = z
      .object({
        parecer: z.string().max(10_000).optional(),
        gravidade: z.enum(['VERDE', 'AMARELO', 'VERMELHO']).optional(),
        gravidadeManual: z.boolean().optional(),
      })
      .parse(request.body)
    if (!(await repos.clientes.porId(p.clienteId))) throw new ErroHttp(404, 'Cliente não encontrado.', 'nao_encontrado')
    await servicos.checklist.salvarItem(p.clienteId, p.semanaRef, p.item as (typeof ITENS_CHECKLIST)[number]['chave'], corpo, request.ator!.nome)
    return reply.status(204).send()
  })
  app.post('/api/v1/checklist/resumos', leitor, (request) => {
    const corpo = z.object({ semanaRef: data, clienteIds: z.array(id).max(300) }).parse(request.body)
    return servicos.checklist.resumos(corpo.clienteIds, corpo.semanaRef)
  })

  // ------------------------------------------------------------ comitês e atas
  app.get('/api/v1/comites', leitor, () => repos.comites.listar())
  app.get('/api/v1/comites/proximo', leitor, () => servicos.comite.garantirProximoPlanejado())
  app.get('/api/v1/comites/ultima-ata', leitor, async () => (await repos.comites.ultimaAta()) ?? null)
  app.get('/api/v1/comites/:comiteId/decisoes', leitor, async (request) => {
    const { comiteId } = z.object({ comiteId: id }).parse(request.params)
    return { quantidade: await repos.planos.contarDoComite(comiteId) }
  })
  app.post('/api/v1/comites/:comiteId/ata', analista, async (request) => {
    const { comiteId } = z.object({ comiteId: id }).parse(request.params)
    const ata = await servicos.comite.gerarAta(comiteId)
    await repos.auditoria.registrar({ acao: 'comite.ata_gerada', atorId: request.ator!.id, atorEmail: request.ator!.email, recursoTipo: 'comite', recursoId: comiteId, detalhes: { ataId: ata.id } })
    return ata
  })
  app.post('/api/v1/comites/decisoes', analista, (request) => {
    const corpo = z
      .object({
        clienteId: id,
        decisao: z.string().trim().min(1).max(2000),
        plano: z.string().trim().max(4000).default(''),
        prazo: data,
        responsavel: z.string().trim().max(200).default(''),
      })
      .parse(request.body)
    return servicos.decisao.registrar(corpo, request.ator!)
  })

  // ------------------------------------------------------------ configurações
  app.get('/api/v1/configuracoes/alertas', leitor, () => repos.configuracoes.listarAlertas())
  app.patch('/api/v1/configuracoes/alertas/:configId', admin, async (request, reply) => {
    const { configId } = z.object({ configId: id }).parse(request.params)
    const corpo = z
      .object({ limiar: z.number().finite().min(0).max(1e12).optional(), ativo: z.boolean().optional() })
      .refine((c) => c.limiar !== undefined || c.ativo !== undefined, 'informe limiar ou ativo')
      .parse(request.body)
    if (!(await repos.configuracoes.atualizarAlerta(configId, corpo))) throw new ErroHttp(404, 'Configuração não encontrada.', 'nao_encontrado')
    await repos.auditoria.registrar({ acao: 'configuracao.alerta', atorId: request.ator!.id, atorEmail: request.ator!.email, recursoTipo: 'configuracao_alerta', recursoId: configId, detalhes: corpo })
    return reply.status(204).send()
  })

  // ------------------------------------------------------------ importação semanal
  app.post('/api/v1/importacoes', analista, async (request) => {
    const partes = request.parts()
    let semanaRef: string | null = null
    let arquivo: { nome: string; conteudo: Buffer } | null = null
    for await (const parte of partes) {
      if (parte.type === 'file') {
        if (parte.fieldname !== 'arquivo' || arquivo) {
          parte.file.resume()
          continue
        }
        arquivo = { nome: parte.filename, conteudo: await parte.toBuffer() }
      } else if (parte.fieldname === 'semanaRef') {
        semanaRef = String(parte.value)
      }
    }
    if (!arquivo) throw new ErroHttp(400, 'Envie o arquivo no campo "arquivo".', 'arquivo_ausente')
    if (!semanaRef) throw new ErroHttp(400, 'Informe a semana de referência no campo "semanaRef".', 'semana_ausente')
    const semana = data.parse(semanaRef)
    const ator = request.ator!
    return servicos.importacao.receber({ nomeOriginal: arquivo.nome, conteudo: arquivo.conteudo }, semana, { id: ator.id, nome: ator.nome, email: ator.email })
  })
  app.post('/api/v1/importacoes/:importacaoId/previa', analista, (request) => {
    const { importacaoId } = z.object({ importacaoId: z.string().uuid() }).parse(request.params)
    const { semanaRef } = z.object({ semanaRef: data }).parse(request.body)
    return servicos.importacao.previa(importacaoId, semanaRef)
  })
  app.post('/api/v1/importacoes/:importacaoId/confirmar', analista, (request) => {
    const { importacaoId } = z.object({ importacaoId: z.string().uuid() }).parse(request.params)
    const { semanaRef } = z.object({ semanaRef: data }).parse(request.body)
    const ator = request.ator!
    return servicos.importacao.confirmar(importacaoId, semanaRef, { id: ator.id, nome: ator.nome, email: ator.email })
  })
}
