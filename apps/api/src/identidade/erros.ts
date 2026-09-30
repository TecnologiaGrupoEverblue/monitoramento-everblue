/**
 * Erros do fluxo de identidade. Separados por DESTINATÁRIO, porque cada um
 * exige uma ação diferente de quem lê a mensagem:
 *
 * - `ErroAutenticacao`: o login em si falhou (estado expirado, token inválido).
 * - `AcessoNegado`: a Intranet respondeu, e a resposta foi NÃO.
 * - `AutoridadeIndisponivel`: não foi possível perguntar (rede, credencial,
 *   cadastro da aplicação). Nunca vira permissão.
 * - `PrecisaReautenticar`: não é recusa, é o crachá vencendo — ida e volta
 *   silenciosa ao Entra.
 */
export class ErroAutenticacao extends Error {
  constructor(
    message: string,
    readonly codigo: string = 'recusado',
  ) {
    super(message)
    this.name = 'ErroAutenticacao'
  }
}

export class AcessoNegado extends Error {
  readonly codigo = 'sem_acesso'
  constructor(message: string) {
    super(message)
    this.name = 'AcessoNegado'
  }
}

export class AutoridadeIndisponivel extends Error {
  readonly codigo = 'intranet_indisponivel'
  constructor(message: string) {
    super(message)
    this.name = 'AutoridadeIndisponivel'
  }
}

export class PrecisaReautenticar extends Error {
  readonly codigo = 'renovacao'
  constructor(readonly destino: string) {
    super('Sua sessão precisa ser renovada.')
    this.name = 'PrecisaReautenticar'
  }
}

/** Traduz falha de rede para quem vai agir, sem despejar o objeto de erro
 * (é assim que cabeçalho com credencial aparece em log). */
export function motivoDeRede(erro: unknown): string {
  const nome = (erro as { name?: string })?.name ?? ''
  const causa = (erro as { cause?: { code?: string } })?.cause?.code ?? ''
  if (nome === 'TimeoutError' || nome === 'AbortError') return 'a resposta demorou demais'
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(causa)) return 'o endereço não foi resolvido (DNS)'
  if (
    ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID'].includes(causa)
  ) {
    return `o certificado do servidor não é confiável (${causa})`
  }
  if (['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT'].includes(causa)) {
    return 'não foi possível abrir a conexão (endereço, DNS ou firewall)'
  }
  return 'falha de rede'
}
