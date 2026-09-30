/**
 * Entrada e saída. A porta é UMA: Entrar com Microsoft. O acesso de
 * emergência (conta local declarada) existe em /entrar/emergencia, sem
 * link a partir de lugar nenhum, com limite de tentativas e auditoria
 * `excecao` — mesmo desenho da IA Everblue.
 */
import type { SessaoUsuario } from '@monitoramento/dominio'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import type { Dependencias } from '../../composicao'
import { COOKIE_ESTADO_OIDC, VALIDADE_ESTADO_S, type EstadoOidc } from '../../identidade/entra'
import { LoginRecusado } from '../../identidade/servicoLogin'
import { COOKIE_RENOVACAO, COOKIE_SESSAO } from '../../seguranca/sessao'
import { destinoSeguro, exigir, ipDaRequisicao } from '../autenticacao'

/** Motivos que a tela de login sabe exibir. A mensagem é escolhida por CHAVE
 * na interface — nunca um texto recebido pela URL (é assim que se convence
 * alguém de que precisa digitar a senha de novo num endereço legítimo). */
const CODIGOS_CONHECIDOS = new Set([
  'recusado',
  'expirado',
  'invalido',
  'sem_acesso',
  'nao_cadastrado',
  'inativo',
  'intranet_indisponivel',
  'entra_indisponivel',
  'nao_configurado',
  'renovacao',
])

export async function rotasAutenticacao(app: FastifyInstance, deps: Dependencias): Promise<void> {
  const cookieBase = { httpOnly: true, secure: deps.cfg.cookieSeguro, sameSite: 'lax' as const, path: '/' }

  async function abrirSessao(reply: FastifyReply, usuarioId: string) {
    const token = await deps.sessao.emitir(usuarioId)
    reply.setCookie(COOKIE_SESSAO, token, { ...cookieBase, maxAge: deps.sessao.validadeSegundos })
    // A marca de renovação some no login bem-sucedido; de pé, faria a próxima
    // renovação legítima mandar a pessoa para a tela de login sem motivo.
    reply.clearCookie(COOKIE_RENOVACAO, { path: '/' })
  }

  app.get('/api/v1/autenticacao/modo', async () => ({ entraDisponivel: deps.entra.configurado }))

  app.get('/entrar/entra', async (request, reply) => {
    const { destino } = request.query as { destino?: string }
    if (!deps.entra.configurado) return reply.redirect('/login?erro=nao_configurado', 302)
    const { url, estado } = deps.entra.montarAutorizacao(destinoSeguro(destino))
    // Caminho "/" porque o retorno (/oauth/oidc/callback) fica fora de /entrar.
    reply.setCookie(COOKIE_ESTADO_OIDC, deps.estadoOidc.assinar(estado), { ...cookieBase, maxAge: VALIDADE_ESTADO_S })
    return reply.redirect(url, 302)
  })

  const tratarRetorno = async (request: { query: unknown; cookies: Record<string, string | undefined>; id: string; ip: string }, reply: FastifyReply) => {
    const { code, state, error } = (request.query ?? {}) as { code?: string; state?: string; error?: string }
    reply.clearCookie(COOKIE_ESTADO_OIDC, { path: '/' })
    if (error || !code) {
      // `error_description` vem do tenant e pode conter detalhe interno: não vai à tela.
      await deps.repos.auditoria.registrar({ acao: 'login.entra', resultado: 'negado', origemIp: request.ip, correlationId: request.id, motivo: error ? `entra: ${error}` : 'retorno sem código' })
      return reply.redirect('/login?erro=recusado', 302)
    }
    const estado = deps.estadoOidc.ler<EstadoOidc>(request.cookies[COOKIE_ESTADO_OIDC], VALIDADE_ESTADO_S)
    try {
      const usuarioId = await deps.login.concluirEntra(code, estado, state ?? '', { ip: request.ip, correlationId: request.id })
      await abrirSessao(reply, usuarioId)
      return reply.redirect(destinoSeguro(estado?.destino), 302)
    } catch (erro) {
      const codigo = erro instanceof LoginRecusado && CODIGOS_CONHECIDOS.has(erro.codigo) ? erro.codigo : 'recusado'
      return reply.redirect(`/login?erro=${codigo}`, 302)
    }
  }
  app.get('/oauth/oidc/callback', (request, reply) => tratarRetorno(request, reply))

  const corpoEmergencia = z.object({
    email: z.string().trim().toLowerCase().email().max(254),
    senha: z.string().min(1).max(256),
    destino: z.string().max(500).optional(),
  })
  app.post(
    '/api/v1/autenticacao/emergencia',
    { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } },
    async (request, reply) => {
      const dados = corpoEmergencia.parse(request.body)
      try {
        const usuarioId = await deps.login.autenticarEmergencia(dados.email, dados.senha, { ip: ipDaRequisicao(request), correlationId: request.id })
        await abrirSessao(reply, usuarioId)
        return { destino: destinoSeguro(dados.destino) }
      } catch (erro) {
        if (erro instanceof LoginRecusado) {
          return reply.status(erro.status).type('application/problem+json').send({ title: 'Acesso recusado', status: erro.status, detail: erro.message, codigo: erro.codigo })
        }
        throw erro
      }
    },
  )

  app.get('/api/v1/sessao', { preHandler: exigir(deps, 'leitor') }, async (request): Promise<SessaoUsuario> => {
    const ator = request.ator!
    return {
      id: ator.id,
      nome: ator.nome,
      email: ator.email,
      cargo: ator.cargo,
      perfil: ator.perfil,
      departamento: ator.departamentoNome,
      origem: ator.origem,
      temFoto: deps.cfg.fotoFonte !== 'nenhuma' && ator.origem === 'entra',
    }
  })

  app.get('/api/v1/sessao/foto', { preHandler: exigir(deps, 'leitor') }, async (request, reply) => {
    const ator = request.ator!
    const foto = await deps.fonteFoto.obter({ usuarioId: ator.id, entraOid: ator.entraOid })
    if (!foto) return reply.status(404).send()
    // Foto é dado pessoal: cache só no navegador da própria pessoa.
    return reply.header('cache-control', 'private, max-age=3600').type(foto.tipo).send(foto.conteudo)
  })

  app.post('/api/v1/sessao/sair', async (request, reply) => {
    const ator = request.ator
    if (ator) {
      // O token delegado só serve durante a sessão; encerrada, não tem função.
      await deps.repos.usuarios.encerrarSessao(ator.id)
      await deps.repos.auditoria.registrar({ acao: 'logout', atorId: ator.id, atorEmail: ator.email, origemIp: ipDaRequisicao(request) })
    }
    reply.clearCookie(COOKIE_SESSAO, { path: '/' }).clearCookie(COOKIE_RENOVACAO, { path: '/' })
    return reply.status(204).send()
  })
}
