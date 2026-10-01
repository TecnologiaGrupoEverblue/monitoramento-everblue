/**
 * Autenticação corporativa por Microsoft Entra ID (OIDC) — porte fiel do
 * fluxo da IA Everblue.
 *
 * Fluxo de código de autorização com PKCE. A aplicação nunca vê a senha:
 * recebe um código de uso único e o troca por um token de identidade
 * assinado pelo tenant, verificado por inteiro (assinatura, emissor, público,
 * validade e nonce). O usuário é reconhecido pelo `oid`, não pelo e-mail.
 *
 * Somente `openid profile email`: o login responde QUEM é a pessoa. A
 * pergunta SE ela pode entrar vai à Intranet por chamada interna assinada
 * (ver `intranet.ts`) — nenhum escopo da Intranet é pedido ao Entra e nenhum
 * token delegado é guardado.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createRemoteJWKSet, errors as errosJose, jwtVerify, type JWTPayload } from 'jose'
import type { Configuracao } from '../config/configuracao'
import { ErroAutenticacao, motivoDeRede } from './erros'

export const COOKIE_ESTADO_OIDC = 'emon_oidc'
/** Tempo máximo entre iniciar e concluir o login. */
export const VALIDADE_ESTADO_S = 600
const ESCOPOS_BASE = 'openid profile email'

export interface EstadoOidc extends Record<string, unknown> {
  state: string
  nonce: string
  verificador: string
  destino: string
}

export interface IdentidadeEntra {
  oid: string
  email: string
  nome: string
  grupos: string[]
  /** O Entra NÃO envia `groups` quando a pessoa passa do limite do token;
   * manda um ponteiro para o Graph. Detectado para não provisionar ninguém
   * com perfil mínimo em silêncio. */
  gruposTruncados: boolean
}

function iguais(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export class AutenticadorEntra {
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null

  constructor(private readonly cfg: Configuracao) {}

  get configurado(): boolean {
    return this.cfg.entra.configurado
  }

  private get base(): string {
    return `https://login.microsoftonline.com/${this.cfg.entra.tenantId}`
  }

  private escopos(): string {
    return ESCOPOS_BASE
  }

  /** Devolve a URL de autorização e o estado a guardar no cookie assinado.
   * `state` protege contra CSRF, `nonce` contra reuso de token e PKCE contra
   * interceptação do código — três proteções para três ataques distintos. */
  montarAutorizacao(destino: string): { url: string; estado: EstadoOidc } {
    if (!this.configurado) throw new ErroAutenticacao('Autenticação corporativa não configurada.', 'nao_configurado')
    const verificador = randomBytes(48).toString('base64url')
    const desafio = createHash('sha256').update(verificador).digest('base64url')
    const estado: EstadoOidc = {
      state: randomBytes(24).toString('base64url'),
      nonce: randomBytes(24).toString('base64url'),
      verificador,
      destino,
    }
    const parametros = new URLSearchParams({
      client_id: this.cfg.entra.clientId,
      response_type: 'code',
      redirect_uri: this.cfg.entra.redirectUri,
      response_mode: 'query',
      scope: this.escopos(),
      state: estado.state,
      nonce: estado.nonce,
      code_challenge: desafio,
      code_challenge_method: 'S256',
    })
    return { url: `${this.base}/oauth2/v2.0/authorize?${parametros}`, estado }
  }

  async concluir(codigo: string, estadoGuardado: EstadoOidc | null, stateRecebido: string): Promise<IdentidadeEntra> {
    if (!this.configurado) throw new ErroAutenticacao('Autenticação corporativa não configurada.', 'nao_configurado')
    if (!estadoGuardado || !iguais(estadoGuardado.state, stateRecebido ?? '')) {
      throw new ErroAutenticacao('Requisição de login inválida ou expirada. Tente novamente.', 'expirado')
    }

    let resposta: Response
    try {
      resposta = await fetch(`${this.base}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.cfg.entra.clientId,
          client_secret: this.cfg.entra.clientSecret,
          grant_type: 'authorization_code',
          code: codigo,
          redirect_uri: this.cfg.entra.redirectUri,
          code_verifier: estadoGuardado.verificador,
          scope: this.escopos(),
        }),
        signal: AbortSignal.timeout(this.cfg.entra.timeoutMs),
      })
    } catch (erro) {
      throw new ErroAutenticacao(`Não foi possível contatar o Microsoft Entra ID: ${motivoDeRede(erro)}.`, 'entra_indisponivel')
    }
    if (!resposta.ok) {
      // O corpo do erro pode ecoar parâmetros da requisição: nunca é repassado.
      throw new ErroAutenticacao('O Microsoft Entra ID recusou a autenticação.', 'recusado')
    }
    const corpo = (await resposta.json().catch(() => ({}))) as Record<string, unknown>
    const idToken = typeof corpo.id_token === 'string' ? corpo.id_token : ''
    if (!idToken) throw new ErroAutenticacao('O Microsoft Entra ID não devolveu token de identidade.', 'recusado')

    const carga = await this.verificarIdToken(idToken)
    const nonce = String(carga.nonce ?? '')
    if (!iguais(nonce, estadoGuardado.nonce)) {
      throw new ErroAutenticacao('Token de identidade não corresponde a esta tentativa de login.', 'invalido')
    }

    const oid = String(carga.oid ?? carga.sub ?? '').trim()
    const email = String(carga.preferred_username ?? carga.email ?? carga.upn ?? '')
      .trim()
      .toLowerCase()
    if (!oid || !email) throw new ErroAutenticacao('O token não traz identificador ou e-mail do usuário.', 'invalido')

    const nomesDeClaims = (carga._claim_names ?? {}) as Record<string, unknown>
    const grupos = Array.isArray(carga.groups) ? carga.groups.map(String) : []
    return {
      oid,
      email,
      nome: String(carga.name ?? email.split('@')[0]).trim(),
      grupos,
      gruposTruncados: 'groups' in nomesDeClaims,
    }
  }

  private async verificarIdToken(idToken: string): Promise<JWTPayload> {
    this.jwks ??= createRemoteJWKSet(new URL(`${this.base}/discovery/v2.0/keys`), {
      timeoutDuration: this.cfg.entra.timeoutMs,
      cacheMaxAge: 3_600_000,
    })
    try {
      const { payload } = await jwtVerify(idToken, this.jwks, {
        algorithms: ['RS256'],
        audience: this.cfg.entra.clientId,
        // O tenant emite com `/v2.0`; aceitar a barra final evita recusa por
        // detalhe de formatação que varia entre configurações.
        issuer: [`${this.base}/v2.0`, `${this.base}/v2.0/`],
        requiredClaims: ['exp', 'iat', 'aud', 'iss', 'sub'],
      })
      return payload
    } catch (erro) {
      if (erro instanceof errosJose.JWTExpired) throw new ErroAutenticacao('Token de identidade expirado.', 'invalido')
      throw new ErroAutenticacao('Token de identidade inválido.', 'invalido')
    }
  }
}
