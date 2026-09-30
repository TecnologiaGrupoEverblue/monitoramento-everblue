/** Health checks baratos, sem topologia nem erro interno na resposta.
 * `viva`: o processo responde. `pronta`: banco e MinIO acessíveis. */
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
  app.get('/api/health', pronta)
}
