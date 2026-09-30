/** Tradução de erros para respostas padronizadas (RFC 9457 — Problem Details).
 * Stack trace, SQL e detalhes internos nunca chegam ao cliente. */
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import { ZodError } from 'zod'
import { AcessoNegado, AutoridadeIndisponivel, PrecisaReautenticar } from '../identidade/erros'
import { AcessoRevogado } from '../identidade/servicoAutorizacao'
import { COOKIE_RENOVACAO, COOKIE_SESSAO, VALIDADE_RENOVACAO_S } from '../seguranca/sessao'
import { ErroNegocio } from '../servicos/servicoComite'

export class ErroHttp extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly codigo = 'erro',
  ) {
    super(message)
  }
}

function problema(reply: FastifyReply, status: number, titulo: string, detalhe: string, codigo: string) {
  return reply
    .status(status)
    .type('application/problem+json')
    .send({ type: `https://monitoramento.everblue/erros/${codigo}`, title: titulo, status, detail: detalhe, codigo })
}

export function criarTratadorDeErros(cookieSeguro: boolean) {
  return function tratar(erro: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) {
    if (erro instanceof PrecisaReautenticar) {
      // Já tentamos renovar e voltamos sem token: insistir seria laço.
      if (request.cookies[COOKIE_RENOVACAO]) {
        reply.clearCookie(COOKIE_RENOVACAO, { path: '/' }).clearCookie(COOKIE_SESSAO, { path: '/' })
        return problema(reply, 401, 'Sessão encerrada', 'Não foi possível renovar sua sessão automaticamente. Entre novamente.', 'renovacao')
      }
      reply.setCookie(COOKIE_RENOVACAO, '1', { httpOnly: true, secure: cookieSeguro, sameSite: 'lax', path: '/', maxAge: VALIDADE_RENOVACAO_S })
      reply.header('x-reautenticar', `/entrar/entra?destino=${encodeURIComponent(erro.destino || '/')}`)
      return problema(reply, 401, 'Sessão precisa ser renovada', erro.message, 'renovacao')
    }
    if (erro instanceof AcessoRevogado || erro instanceof AcessoNegado) {
      reply.clearCookie(COOKIE_SESSAO, { path: '/' })
      return problema(reply, 403, 'Acesso não liberado', erro.message, 'sem_acesso')
    }
    if (erro instanceof AutoridadeIndisponivel) {
      request.log.warn({ motivo: erro.message }, 'autoridade_indisponivel')
      return problema(reply, 503, 'Autorização indisponível', 'Não foi possível confirmar seu acesso na Intranet agora. Tente novamente em instantes.', 'intranet_indisponivel')
    }
    if (erro instanceof ErroNegocio) return problema(reply, erro.status, 'Operação não realizada', erro.message, erro.codigo)
    if (erro instanceof ErroHttp) return problema(reply, erro.status, 'Operação não realizada', erro.message, erro.codigo)
    if (erro instanceof ZodError) {
      const detalhe = erro.issues.map((i) => `${i.path.join('.') || 'corpo'}: ${i.message}`).join('; ')
      return problema(reply, 400, 'Dados inválidos', detalhe.slice(0, 500), 'validacao')
    }
    const fe = erro as FastifyError
    if (fe.statusCode === 413 || fe.code === 'FST_REQ_FILE_TOO_LARGE') return problema(reply, 413, 'Arquivo muito grande', 'O arquivo excede o tamanho máximo permitido.', 'arquivo_grande')
    if (fe.statusCode === 429) return problema(reply, 429, 'Muitas requisições', 'Aguarde alguns instantes e tente novamente.', 'limite')
    if (fe.validation || (fe.statusCode && fe.statusCode >= 400 && fe.statusCode < 500)) {
      return problema(reply, fe.statusCode ?? 400, 'Requisição inválida', 'A requisição não pôde ser processada.', 'requisicao_invalida')
    }
    request.log.error({ err: erro }, 'erro_nao_tratado')
    return problema(reply, 500, 'Erro interno', 'Ocorreu um erro inesperado. Se persistir, informe o código de correlação ao suporte.', 'interno')
  }
}
