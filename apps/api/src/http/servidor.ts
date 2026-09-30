/** Montagem do servidor HTTP (Fastify). */
import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import Fastify, { type FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import type { Dependencias } from '../composicao'
import { registrarSessao } from './autenticacao'
import { criarTratadorDeErros, ErroHttp } from './erros'
import { rotasArquivos } from './rotas/arquivos'
import { rotasAutenticacao } from './rotas/autenticacao'
import { rotasNegocio } from './rotas/negocio'
import { rotasSaude } from './rotas/saude'

const METODOS_QUE_ALTERAM = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export async function construirServidor(deps: Dependencias, opcoes: { log?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      opcoes.log === false
        ? false
        : {
            level: deps.cfg.nivelLog,
            base: { servico: 'everblue-monitoramento-api', ambiente: deps.cfg.ambiente },
            // Nunca registrar cookie nem cabeçalho de autorização.
            redact: { paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'], remove: true },
          },
    // Atrás do nginx: o IP de origem vem do X-Forwarded-For definido por ele.
    trustProxy: true,
    bodyLimit: 1 * 1024 * 1024,
    requestIdHeader: 'x-correlation-id',
    genReqId: () => randomUUID(),
  })

  app.setErrorHandler(criarTratadorDeErros(deps.cfg.cookieSeguro))
  app.setNotFoundHandler((request, reply) =>
    reply.status(404).type('application/problem+json').send({ title: 'Não encontrado', status: 404, detail: `Rota inexistente: ${request.method} ${request.url.split('?')[0]}`, codigo: 'nao_encontrado' }),
  )

  await app.register(cookie)
  await app.register(rateLimit, { global: true, max: 600, timeWindow: '1 minute', keyGenerator: (r) => r.ip })
  await app.register(multipart, { limits: { fileSize: deps.cfg.importacao.maxBytes, files: 1, fields: 5, fieldSize: 1024 } })

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-correlation-id', request.id)
    if (request.url.startsWith('/api/')) reply.header('cache-control', 'no-store')
    // Defesa em profundidade contra CSRF (além do SameSite=Lax): requisição
    // que altera estado precisa vir da própria origem pública.
    if (METODOS_QUE_ALTERAM.has(request.method)) {
      const origem = request.headers.origin
      if (origem && origem !== new URL(deps.cfg.urlPublica).origin) {
        throw new ErroHttp(403, 'Origem da requisição não permitida.', 'origem_invalida')
      }
    }
  })
  registrarSessao(app, deps)

  await app.register(async (escopo) => rotasSaude(escopo, deps))
  await app.register(async (escopo) => rotasAutenticacao(escopo, deps))
  await app.register(async (escopo) => rotasNegocio(escopo, deps))
  await app.register(async (escopo) => rotasArquivos(escopo, deps))
  return app
}
