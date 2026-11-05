/**
 * Sessão e autorização nas rotas. Toda decisão é tomada no servidor.
 *
 * - `request.ator` é carregado do cookie de sessão e RELIDO do banco a cada
 *   requisição (perfil e `ativo` atuais).
 * - `exigir(perfil)` exige sessão, revalida a autorização na Intranet (cache
 *   de 5 min do contrato) e confere o nível do perfil.
 */
import { NIVEL_PERFIL, type PerfilAcesso } from '@monitoramento/dominio'
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify'
import type { Dependencias } from '../composicao'
import type { Usuario } from '../repositorios/usuarioRepositorio'
import { COOKIE_SESSAO } from '../seguranca/sessao'
import { ErroHttp } from './erros'

declare module 'fastify' {
  interface FastifyRequest {
    ator: Usuario | null
  }
}

export function ipDaRequisicao(request: FastifyRequest): string | null {
  return request.ip || null
}

export function registrarSessao(app: FastifyInstance, deps: Dependencias): void {
  app.decorateRequest('ator', null)
  app.addHook('onRequest', async (request) => {
    const usuarioId = await deps.sessao.ler(request.cookies[COOKIE_SESSAO])
    if (!usuarioId) return
    const usuario = await deps.repos.usuarios.porId(usuarioId)
    request.ator = usuario && usuario.ativo ? usuario : null
  })
}

export function exigir(deps: Dependencias, minimo: PerfilAcesso): preHandlerAsyncHookHandler {
  return async function (this: FastifyInstance, request: FastifyRequest, _reply: FastifyReply) {
    const ator = request.ator
    if (!ator) throw new ErroHttp(401, 'Sessão não autenticada.', 'nao_autenticado')
    const destino = typeof request.headers['x-destino'] === 'string' && request.headers['x-destino'].startsWith('/') ? request.headers['x-destino'] : '/'
    await deps.autorizacao.conferir(ator.id, { email: ator.email, ip: ipDaRequisicao(request), destino })
    if (NIVEL_PERFIL[ator.perfil] < NIVEL_PERFIL[minimo]) {
      await deps.repos.auditoria.registrar({
        acao: 'acesso.negado',
        resultado: 'negado',
        atorId: ator.id,
        atorEmail: ator.email,
        origemIp: ipDaRequisicao(request),
        recursoTipo: 'rota',
        recursoId: `${request.method} ${request.routeOptions.url ?? request.url}`,
        motivo: `perfil ${ator.perfil} abaixo de ${minimo}`,
      })
      throw new ErroHttp(403, 'Seu perfil não permite esta operação.', 'perfil_insuficiente')
    }
  }
}

/**
 * Foto do Bitfin, Mapa de Garantias e Parâmetros (decisão de 30/10/2026):
 * só para quem tem, na Intranet, um dos perfis de NIVEIS_ACESSO_GESTAO
 * (Administrador, Diretoria, Gerente). Conta de emergência local com perfil
 * admin também entra (é o acesso de quando a Intranet está fora).
 * Sem perfil informado pela Intranet = sem acesso (fail-closed).
 */
export function temAcessoGestao(usuario: Usuario, niveis: string[]): boolean {
  if (usuario.origem === 'local' && usuario.perfil === 'admin') return true
  return Boolean(usuario.nivelAcessoCodigo && niveis.includes(usuario.nivelAcessoCodigo))
}

/** `exigir(minimo)` + acesso às áreas de gestão. */
export function exigirGestao(deps: Dependencias, minimo: PerfilAcesso): preHandlerAsyncHookHandler {
  const base = exigir(deps, minimo)
  return async function (this: FastifyInstance, request: FastifyRequest, reply: FastifyReply) {
    await base.call(this, request, reply)
    const ator = request.ator!
    if (!temAcessoGestao(ator, deps.cfg.niveisAcessoGestao)) {
      await deps.repos.auditoria.registrar({
        acao: 'acesso.negado',
        resultado: 'negado',
        atorId: ator.id,
        atorEmail: ator.email,
        origemIp: ipDaRequisicao(request),
        recursoTipo: 'rota',
        recursoId: `${request.method} ${request.routeOptions.url ?? request.url}`,
        motivo: `perfil da Intranet ${ator.nivelAcessoCodigo ?? 'não informado'} fora de ${deps.cfg.niveisAcessoGestao.join(',')}`,
      })
      throw new ErroHttp(403, 'Esta área é restrita a Administrador, Diretoria e Gerente (perfil da Intranet).', 'acesso_gestao')
    }
  }
}

/** Caminho interno seguro — impede redirecionamento para site externo. */
export function destinoSeguro(valor: unknown): string {
  if (typeof valor !== 'string' || !valor.startsWith('/') || valor.startsWith('//') || valor.includes('\\')) return '/'
  return valor.slice(0, 500)
}
