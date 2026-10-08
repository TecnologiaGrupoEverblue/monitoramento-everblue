/** Health checks baratos, sem topologia nem erro interno na resposta.
 * `viva`: o processo responde. `pronta`: banco e MinIO acessíveis.
 * `intranet`: a validação de acesso pela Intranet está respondendo. */
import type { FastifyInstance } from 'fastify'
import type { Dependencias } from '../../composicao'

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
}
