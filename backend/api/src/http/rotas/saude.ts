/** Health checks baratos, sem topologia nem erro interno na resposta.
 * `viva`: o processo responde. `pronta`: banco e MinIO acessíveis.
 * `intranet`: a validação de acesso pela Intranet está respondendo. */
import type { FastifyInstance } from 'fastify'
import type { Dependencias } from '../../composicao'
import { exigirGestao } from '../autenticacao'

type Estado = 'UP' | 'DEGRADED' | 'DOWN' | 'UNKNOWN'

export async function rotasSaude(app: FastifyInstance, deps: Dependencias): Promise<void> {
  app.get('/api/health/live', async () => ({ status: 'ok' }))

  const pronta = async (_: unknown, reply: import('fastify').FastifyReply) => {
    const [banco, armazenamento] = await Promise.all([
      deps.banco.pool
        .query('SELECT 1')
        .then(() => true)
        .catch(() => false),
      deps.armazenamento.verificarDisponibilidade(),
    ])
    const ok = banco && armazenamento
    return reply.status(ok ? 200 : 503).send({ status: ok ? 'ok' : 'indisponivel', banco: banco ? 'ok' : 'falha', armazenamento: armazenamento ? 'ok' : 'falha' })
  }
  app.get('/api/health/ready', pronta)

  // Estado da validação de acesso pela Intranet (alerta de indisponibilidade).
  // Público e sem motivo técnico: a tela de login e ferramentas de monitoração
  // leem daqui; o motivo fica no log e na auditoria.
  app.get('/api/health/intranet', async (_, reply) => {
    const { situacao, desde, verificadoEm } = deps.monitorIntranet.atual()
    return reply.header('cache-control', 'no-store').status(situacao === 'INDISPONIVEL' ? 503 : 200).send({ situacao, desde, verificadoEm })
  })
  app.get('/api/health', pronta)

  // Estado resumido por dependência (padrão corporativo de conexões, §13):
  // autenticado, sem host, credencial ou stack trace. NÃO consulta o Bitfin —
  // lê o estado do gateway (disjuntor, fila, última execução), para não criar
  // a carga que deveria detectar. Banco e MinIO com cache de 15 s.
  let cache: { em: number; banco: boolean; armazenamento: boolean } | null = null
  app.get('/api/health/dependencies', { preHandler: exigirGestao(deps, 'leitor') }, async (_, reply) => {
    if (!cache || Date.now() - cache.em > 15_000) {
      const [banco, armazenamento] = await Promise.all([
        deps.banco.pool
          .query('SELECT 1')
          .then(() => true)
          .catch(() => false),
        deps.armazenamento.verificarDisponibilidade().catch(() => false),
      ])
      cache = { em: Date.now(), banco, armazenamento }
    }
    const g = deps.gatewayBitfin?.estado() ?? null
    let bitfin: Estado = 'UNKNOWN'
    if (!deps.leitorBitfin.configurado) bitfin = 'UNKNOWN'
    else if (g?.disjuntor === 'OPEN') bitfin = 'DOWN'
    else if (g?.disjuntor === 'HALF_OPEN') bitfin = 'DEGRADED'
    else if (g?.ultimaExecucao) bitfin = g.ultimaExecucao.status === 'SUCESSO' ? 'UP' : 'DEGRADED'
    const intranet = deps.monitorIntranet.atual()
    return reply.header('cache-control', 'no-store').send({
      verificadoEm: new Date(cache.em).toISOString(),
      dependencias: {
        postgres: { estado: (cache.banco ? 'UP' : 'DOWN') as Estado },
        minio: { estado: (cache.armazenamento ? 'UP' : 'DOWN') as Estado },
        intranet: { estado: (intranet.situacao === 'INDISPONIVEL' ? 'DOWN' : intranet.situacao === 'OK' ? 'UP' : 'UNKNOWN') as Estado, verificadoEm: intranet.verificadoEm },
        bitfin: {
          estado: bitfin,
          configurado: deps.leitorBitfin.configurado,
          disjuntor: g?.disjuntor ?? null,
          reabreEm: g?.reabreEm ?? null,
          emExecucao: g?.emExecucao ?? null,
          naFila: g?.naFila ?? null,
          filaMax: g?.filaMax ?? null,
          contadores: g?.contadores ?? null,
          duracaoMs: g?.duracaoMs ?? null,
          ultimaExecucao: g?.ultimaExecucao ?? null,
        },
      },
    })
  })
}
