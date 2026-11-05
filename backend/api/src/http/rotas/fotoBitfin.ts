/**
 * Foto do Bitfin (/api/v1/foto-bitfin). Ver: leitor. Tirar foto: analista.
 * Agendador e teste de conexão: admin. A leitura no Bitfin roda em segundo
 * plano; a tela acompanha pela execução.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { esquemaAgendamentoFotoCorpo, esquemaTirarFoto } from '@monitoramento/dominio'
import type { Dependencias } from '../../composicao'
import { exigir, exigirGestao } from '../autenticacao'
import { ErroHttp } from '../erros'

const uuid = z.string().uuid()

export async function rotasFotoBitfin(app: FastifyInstance, deps: Dependencias): Promise<void> {
  // Área de gestão (Administrador, Diretoria, Gerente na Intranet) + perfil interno.
  const leitor = { preHandler: exigirGestao(deps, 'leitor') }
  const analista = { preHandler: exigirGestao(deps, 'analista') }
  const admin = { preHandler: exigirGestao(deps, 'admin') }
  // Eventos e limite do Bitfin no checklist do comitê: abertos a quem vê o cliente.
  const leitorDoCliente = { preHandler: exigir(deps, 'leitor') }
  const { repos, servicos } = deps
  const limiteFoto = { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }

  app.get('/api/v1/foto-bitfin/situacao', leitor, async () => {
    const [ultimas, agendamento, ultimaConcluida, proximoComite] = await Promise.all([
      repos.fotos.listar(1),
      repos.fotos.agendamento(),
      repos.fotos.ultimaConcluida(),
      repos.comites.proximoPlanejado(),
    ])
    const ultima = ultimas[0] ?? null
    return {
      configurado: servicos.fotoBitfin.configurado,
      planilhaHabilitada: deps.cfg.importacao.planilhaHabilitada,
      retencaoTesteDias: deps.cfg.retencaoFotoTesteDias,
      emAndamento: ultima?.status === 'EXECUTANDO' ? ultima : null,
      ultima,
      ultimaConcluida,
      agendamento,
      proximoComite: proximoComite?.data ?? null,
    }
  })

  app.post('/api/v1/foto-bitfin', { ...analista, ...limiteFoto }, async (request, reply) => {
    const { gravarPosicao } = esquemaTirarFoto.parse(request.body ?? {})
    const ator = request.ator!
    const id = await servicos.fotoBitfin.solicitar({ origem: 'MANUAL', solicitante: { id: ator.id, nome: ator.nome, email: ator.email }, gravarPosicao })
    return reply.status(202).send({ id })
  })

  app.get('/api/v1/foto-bitfin/execucoes', leitor, (request) => {
    const q = z.object({ limite: z.coerce.number().int().min(1).max(200).optional(), antesDe: z.string().datetime().optional() }).parse(request.query)
    return repos.fotos.listar(q.limite ?? 30, q.antesDe)
  })

  app.get('/api/v1/foto-bitfin/execucoes/:id', leitor, async (request) => {
    const { id } = z.object({ id: uuid }).parse(request.params)
    const execucao = await repos.fotos.porId(id)
    if (!execucao) throw new ErroHttp(404, 'Foto não encontrada.', 'nao_encontrado')
    return execucao
  })

  app.get('/api/v1/foto-bitfin/execucoes/:id/comparacao', leitor, (request) => {
    const { id } = z.object({ id: uuid }).parse(request.params)
    return servicos.fotoBitfin.comparar(id)
  })

  app.get('/api/v1/clientes/:clienteId/bitfin', leitorDoCliente, (request) => {
    const { clienteId } = z.object({ clienteId: z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/) }).parse(request.params)
    const { ate } = z.object({ ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(request.query)
    return repos.fotos.ultimoDetalheDoCliente(clienteId, ate)
  })

  app.get('/api/v1/foto-bitfin/agendamento', leitor, () => repos.fotos.agendamento())

  app.put('/api/v1/foto-bitfin/agendamento', admin, async (request, reply) => {
    const corpo = esquemaAgendamentoFotoCorpo.parse(request.body)
    const diasSemana = [...new Set(corpo.diasSemana)].sort()
    if (corpo.diaPosicaoSemanal !== null && !diasSemana.includes(corpo.diaPosicaoSemanal)) {
      throw new ErroHttp(422, 'O dia da posição do comitê precisa ser um dos dias em que a foto é tirada.', 'dia_posicao_invalido')
    }
    const anterior = await repos.fotos.agendamento()
    const ator = request.ator!
    await repos.fotos.salvarAgendamento({ ...corpo, diasSemana }, ator.id)
    await repos.auditoria.registrar({
      acao: 'foto.agendamento',
      atorId: ator.id,
      atorEmail: ator.email,
      recursoTipo: 'foto_agendamento',
      recursoId: '1',
      detalhes: {
        anterior: { ativo: anterior.ativo, horario: anterior.horario, diasSemana: anterior.diasSemana, diaPosicaoSemanal: anterior.diaPosicaoSemanal },
        novo: { ...corpo, diasSemana },
      },
    })
    return reply.status(204).send()
  })

  app.post('/api/v1/foto-bitfin/testar-conexao', { ...admin, ...limiteFoto }, async () => {
    if (!deps.leitorBitfin.configurado) throw new ErroHttp(503, 'A conexão com o Bitfin não está configurada no servidor.', 'bitfin_nao_configurado')
    try {
      return { ok: true, ...(await deps.leitorBitfin.testar()) }
    } catch (e) {
      throw new ErroHttp(502, (e as Error).message, 'bitfin_indisponivel')
    }
  })
}
