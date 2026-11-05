/**
 * Mapa de Garantias (/api/v1/mapa-garantias). Ver: leitor. Clientes, cópias,
 * campos manuais e envio: analista. Envio diário ligado/desligado: admin.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { digitosDocumento, esquemaConfigMapaCliente, esquemaCopiaMapa, esquemaEnvioDiarioMapa, esquemaInclusaoMapa } from '@monitoramento/dominio'
import type { Dependencias } from '../../composicao'
import { exigirGestao } from '../autenticacao'
import { ErroHttp } from '../erros'
import { dataLocal } from '../../servicos/servicoFotoBitfin'

const documento = z
  .string()
  .trim()
  .transform((v) => digitosDocumento(v))
  .refine((v) => v.length === 14 || v.length === 11, 'Informe um CNPJ (14 dígitos) ou CPF (11 dígitos).')
const email = z.string().trim().toLowerCase().max(200).email('E-mail inválido.')

export async function rotasMapaGarantias(app: FastifyInstance, deps: Dependencias): Promise<void> {
  // Área de gestão (Administrador, Diretoria, Gerente na Intranet) + perfil interno.
  const leitor = { preHandler: exigirGestao(deps, 'leitor') }
  const analista = { preHandler: exigirGestao(deps, 'analista') }
  const admin = { preHandler: exigirGestao(deps, 'admin') }
  const { repos, servicos } = deps
  const auditar = (request: { ator: { id: string; email: string } | null }, acao: string, recursoId: string, detalhes: Record<string, unknown>) =>
    repos.auditoria.registrar({ acao, atorId: request.ator!.id, atorEmail: request.ator!.email, recursoTipo: 'mapa_garantias', recursoId, detalhes })

  app.get('/api/v1/mapa-garantias', leitor, async () => {
    const [calculado, clientes, copias, configs, envioDiarioAtivo] = await Promise.all([
      servicos.mapaGarantias.calcular(),
      repos.mapa.clientes(),
      repos.mapa.copias(),
      repos.mapa.configs(),
      repos.mapa.envioDiarioAtivo(),
    ])
    return { calculado, clientes, copias, configs: Object.fromEntries(configs), envioLigado: servicos.mapaGarantias.envioLigado, envioDiarioAtivo }
  })

  app.get('/api/v1/mapa-garantias/envios', leitor, () => repos.mapa.envios(100))

  app.post('/api/v1/mapa-garantias/clientes', analista, async (request, reply) => {
    const corpo = esquemaInclusaoMapa.parse(request.body)
    const r = await servicos.mapaGarantias.incluirCliente(corpo.documento, request.ator!.id)
    if (r.situacao === 'JA_EXISTIA') throw new ErroHttp(409, 'Este CPF/CNPJ já está no Mapa de Garantias.', 'ja_existe')
    if (r.situacao === 'NAO_ENCONTRADO') throw new ErroHttp(422, 'CPF/CNPJ não encontrado como cliente no Bitfin. Confira o número.', 'nao_encontrado_bitfin')
    await auditar(request, 'mapa.cliente_incluido', corpo.documento, { nome: r.nome })
    return reply.status(201).send({ documento: corpo.documento, nome: r.nome, aviso: r.aviso })
  })

  app.delete('/api/v1/mapa-garantias/clientes/:documento', analista, async (request, reply) => {
    const { documento: doc } = z.object({ documento }).parse(request.params)
    if (!(await repos.mapa.removerCliente(doc, request.ator!.id))) throw new ErroHttp(404, 'CNPJ não está no mapa.', 'nao_encontrado')
    await auditar(request, 'mapa.cliente_removido', doc, {})
    return reply.status(204).send()
  })

  app.put('/api/v1/mapa-garantias/clientes/:documento/config', analista, async (request, reply) => {
    const { documento: doc } = z.object({ documento }).parse(request.params)
    const corpo = esquemaConfigMapaCliente.parse(request.body)
    if (!(await repos.mapa.clientes()).some((c) => c.documento === doc)) throw new ErroHttp(404, 'CNPJ não está no mapa.', 'nao_encontrado')
    const anterior = (await repos.mapa.configs()).get(doc) ?? null
    const quem = request.ator!.nome
    const hoje = dataLocal()
    // Mantém autor e data do que não mudou; o que é novo leva quem salvou.
    const manter = <T extends { responsavel: string; data: string }>(antes: T | undefined, igual: boolean, novo: Omit<T, 'responsavel' | 'data'>) =>
      (igual && antes ? antes : { ...novo, responsavel: quem, data: hoje }) as T
    const config = {
      contasGraficas: corpo.contasGraficas,
      deducoes: corpo.deducoes.map((d, i) => {
        const a = anterior?.deducoes[i]
        return manter(a, Boolean(a && a.valor === d.valor && a.justificativa === d.justificativa), d)
      }),
      concentracaoExcedida: corpo.concentracaoExcedida === null ? null : manter(anterior?.concentracaoExcedida ?? undefined, anterior?.concentracaoExcedida?.texto === corpo.concentracaoExcedida, { texto: corpo.concentracaoExcedida }),
      sacadoComRestricao: corpo.sacadoComRestricao === null ? null : manter(anterior?.sacadoComRestricao ?? undefined, anterior?.sacadoComRestricao?.texto === corpo.sacadoComRestricao, { texto: corpo.sacadoComRestricao }),
    }
    await repos.mapa.salvarConfig(doc, config, request.ator!.id)
    await auditar(request, 'mapa.config', doc, { anterior, novo: config })
    return reply.status(204).send()
  })

  app.post('/api/v1/mapa-garantias/copias', analista, async (request, reply) => {
    const corpo = esquemaCopiaMapa.parse(request.body)
    if ((await repos.mapa.incluirCopia(corpo.email, request.ator!.id)) === 'JA_EXISTIA') throw new ErroHttp(409, 'Este e-mail já recebe cópia.', 'ja_existe')
    await auditar(request, 'mapa.copia_incluida', corpo.email, {})
    return reply.status(201).send({ email: corpo.email })
  })

  app.delete('/api/v1/mapa-garantias/copias/:email', analista, async (request, reply) => {
    const { email: e } = z.object({ email }).parse(request.params)
    if (!(await repos.mapa.removerCopia(e, request.ator!.id))) throw new ErroHttp(404, 'E-mail não está na lista de cópias.', 'nao_encontrado')
    await auditar(request, 'mapa.copia_removida', e, {})
    return reply.status(204).send()
  })

  app.post('/api/v1/mapa-garantias/enviar', { ...analista, config: { rateLimit: { max: 3, timeWindow: '1 minute' } } }, (request) => {
    const ator = request.ator!
    return servicos.mapaGarantias.enviar({ origem: 'MANUAL', solicitante: { id: ator.id, nome: ator.nome, email: ator.email } })
  })

  app.get('/api/v1/mapa-garantias/pdf', leitor, async (_, reply) => {
    const { nome, conteudo } = await servicos.mapaGarantias.pdf()
    return reply.header('content-type', 'application/pdf').header('content-disposition', `attachment; filename="${nome}"`).header('cache-control', 'no-store').send(conteudo)
  })

  app.put('/api/v1/mapa-garantias/envio-diario', admin, async (request, reply) => {
    const { ativo } = esquemaEnvioDiarioMapa.parse(request.body)
    await repos.mapa.definirEnvioDiario(ativo, request.ator!.id)
    await auditar(request, 'mapa.envio_diario', '1', { ativo })
    return reply.status(204).send()
  })
}
