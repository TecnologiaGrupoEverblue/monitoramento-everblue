/**
 * Cifra o token delegado do Entra guardado para revalidar o acesso na
 * Intranet durante a sessão (mesmo desenho da IA Everblue).
 *
 * AES-256-GCM com chave DERIVADA de COFRE_CHAVE por HKDF e rótulo próprio.
 * Trocar o rótulo ou a semente invalida todo token guardado — inofensivo (a
 * pessoa reautentica em silêncio) e é exatamente o botão de emergência se
 * houver suspeita sobre o material cifrado.
 *
 * Refresh token nunca é guardado: o material precisa morrer sozinho.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

const ROTULO = 'everblue-monitoramento/token-delegado/v1'
const VERSAO = 'v1'

export class Cofre {
  private readonly chave: Buffer

  constructor(semente: string) {
    if (semente.length < 32) throw new Error('COFRE_CHAVE curta demais.')
    this.chave = Buffer.from(hkdfSync('sha256', Buffer.from(semente, 'utf8'), Buffer.alloc(0), ROTULO, 32))
  }

  cifrar(texto: string): string {
    const iv = randomBytes(12)
    const cifra = createCipheriv('aes-256-gcm', this.chave, iv)
    const corpo = Buffer.concat([cifra.update(texto, 'utf8'), cifra.final()])
    const etiqueta = cifra.getAuthTag()
    return [VERSAO, iv.toString('base64url'), corpo.toString('base64url'), etiqueta.toString('base64url')].join('.')
  }

  /** `null` quando não há nada guardado OU quando não abre — quem chama já
   * sabe o que fazer nesses casos: mandar a pessoa reautenticar. */
  decifrar(cifrado: string | null | undefined): string | null {
    if (!cifrado) return null
    const partes = cifrado.split('.')
    if (partes.length !== 4 || partes[0] !== VERSAO) return null
    try {
      const [, iv, corpo, etiqueta] = partes
      const decifra = createDecipheriv('aes-256-gcm', this.chave, Buffer.from(iv, 'base64url'))
      decifra.setAuthTag(Buffer.from(etiqueta, 'base64url'))
      return Buffer.concat([decifra.update(Buffer.from(corpo, 'base64url')), decifra.final()]).toString('utf8')
    } catch {
      return null
    }
  }
}
