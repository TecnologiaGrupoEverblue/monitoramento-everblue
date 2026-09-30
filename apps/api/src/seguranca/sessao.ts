/**
 * Sessão da aplicação: JWT HS256 em cookie HttpOnly.
 *
 * O token carrega só o identificador do usuário; perfil e situação (`ativo`)
 * são relidos do banco a cada requisição, para que desativar alguém corte
 * todas as sessões dele na hora.
 */
import { randomUUID } from 'node:crypto'
import { jwtVerify, SignJWT } from 'jose'

export const COOKIE_SESSAO = 'emon_sessao'
export const COOKIE_RENOVACAO = 'emon_renov'
export const VALIDADE_RENOVACAO_S = 90

export class EmissorSessao {
  private readonly chave: Uint8Array

  constructor(
    segredo: string,
    private readonly horas: number,
  ) {
    this.chave = new TextEncoder().encode(segredo)
  }

  get validadeSegundos(): number {
    return this.horas * 3600
  }

  async emitir(usuarioId: string): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(usuarioId)
      .setIssuedAt()
      .setExpirationTime(`${this.horas}h`)
      .setJti(randomUUID())
      .setAudience('everblue-monitoramento')
      .sign(this.chave)
  }

  async ler(token: string | undefined): Promise<string | null> {
    if (!token) return null
    try {
      const { payload } = await jwtVerify(token, this.chave, { algorithms: ['HS256'], audience: 'everblue-monitoramento' })
      return typeof payload.sub === 'string' ? payload.sub : null
    } catch {
      return null
    }
  }
}
