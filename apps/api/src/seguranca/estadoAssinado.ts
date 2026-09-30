/**
 * Estado curto assinado (HMAC-SHA256) — usado no cookie do fluxo OIDC (state,
 * nonce e verificador PKCE). Sem assinatura o cookie seria editável pelo
 * navegador e o `state` deixaria de proteger contra CSRF.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export class EstadoAssinado {
  constructor(
    private readonly segredo: string,
    private readonly rotulo: string,
  ) {}

  assinar(dados: Record<string, unknown>): string {
    const corpo = Buffer.from(JSON.stringify({ ...dados, em: Math.floor(Date.now() / 1000) })).toString('base64url')
    return `${corpo}.${this.mac(corpo)}`
  }

  ler<T extends Record<string, unknown>>(valor: string | undefined, validadeSegundos: number): (T & { em: number }) | null {
    if (!valor) return null
    const [corpo, assinatura] = valor.split('.')
    if (!corpo || !assinatura) return null
    const esperado = Buffer.from(this.mac(corpo))
    const recebido = Buffer.from(assinatura)
    if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) return null
    try {
      const dados = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8')) as T & { em: number }
      if (typeof dados.em !== 'number' || Math.floor(Date.now() / 1000) - dados.em > validadeSegundos) return null
      return dados
    } catch {
      return null
    }
  }

  private mac(corpo: string): string {
    return createHmac('sha256', this.segredo).update(`${this.rotulo}.${corpo}`).digest('base64url')
  }
}
