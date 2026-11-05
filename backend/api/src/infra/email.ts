/**
 * Envio de e-mail (Mapa de Garantias). Transporte escolhido no .env:
 *   - smtp: servidor SMTP corporativo; STARTTLS obrigatório (ou TLS direto),
 *     certificado sempre verificado;
 *   - graph: Microsoft 365 pelo Graph (sendMail da caixa EMAIL_REMETENTE), com
 *     a App Registration do Monitoramento (permissão Mail.Send de aplicação);
 *   - desligado: nada sai; o envio fica registrado como NÃO ENVIADO.
 * Nunca registra o conteúdo nem segredos no log.
 */
import nodemailer, { type Transporter } from 'nodemailer'
import type { Configuracao } from '../config/configuracao'

export interface MensagemEmail {
  para: string[]
  assunto: string
  html: string
  texto: string
  anexos: { nome: string; conteudo: Buffer; tipo: string }[]
}

export interface EnviadorEmail {
  readonly ligado: boolean
  readonly descricao: string
  enviar(m: MensagemEmail): Promise<void>
}

export class EnvioDesligado implements EnviadorEmail {
  readonly ligado = false
  readonly descricao = 'desligado'
  async enviar(): Promise<void> {
    throw new Error('O envio de e-mail não está configurado no servidor (EMAIL_TRANSPORTE).')
  }
}

export class EnvioSmtp implements EnviadorEmail {
  readonly ligado = true
  readonly descricao: string
  private readonly transporte: Transporter
  constructor(private readonly cfg: Configuracao['email']) {
    this.descricao = `smtp ${cfg.smtp.host}:${cfg.smtp.porta}`
    this.transporte = nodemailer.createTransport({
      host: cfg.smtp.host,
      port: cfg.smtp.porta,
      secure: cfg.smtp.tlsDireto,
      requireTLS: !cfg.smtp.tlsDireto,
      auth: cfg.smtp.usuario ? { user: cfg.smtp.usuario, pass: cfg.smtp.senha } : undefined,
      connectionTimeout: cfg.timeoutMs,
      greetingTimeout: cfg.timeoutMs,
      socketTimeout: cfg.timeoutMs,
      tls: { rejectUnauthorized: true },
    })
  }
  async enviar(m: MensagemEmail): Promise<void> {
    await this.transporte.sendMail({
      from: { name: this.cfg.remetenteNome, address: this.cfg.remetente },
      to: m.para,
      subject: m.assunto,
      html: m.html,
      text: m.texto,
      attachments: m.anexos.map((a) => ({ filename: a.nome, content: a.conteudo, contentType: a.tipo })),
    })
  }
}

export class EnvioGraph implements EnviadorEmail {
  readonly ligado = true
  readonly descricao: string
  private token: { valor: string; expira: number } | null = null
  private readonly entra: Configuracao['email']['graph']
  constructor(private readonly cfg: Configuracao['email']) {
    this.entra = cfg.graph
    this.descricao = `graph ${cfg.remetente} (App ${cfg.graph.clientId}, credenciais ${cfg.graph.origem})`
  }
  private async obterToken(): Promise<string> {
    if (this.token && this.token.expira > Date.now() + 60_000) return this.token.valor
    const corpo = new URLSearchParams({ client_id: this.entra.clientId, client_secret: this.entra.clientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' })
    const r = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(this.entra.tenantId)}/oauth2/v2.0/token`, { method: 'POST', body: corpo, signal: AbortSignal.timeout(this.cfg.timeoutMs) })
    if (!r.ok) throw new Error(`Entra recusou o token para envio de e-mail (HTTP ${r.status}${await codigoErro(r, 'token')}).`)
    const j = (await r.json()) as { access_token: string; expires_in: number }
    this.token = { valor: j.access_token, expira: Date.now() + j.expires_in * 1000 }
    return j.access_token
  }
  async enviar(m: MensagemEmail): Promise<void> {
    const token = await this.obterToken()
    const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(this.cfg.remetente)}/sendMail`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(this.cfg.timeoutMs),
      body: JSON.stringify({
        message: {
          subject: m.assunto,
          body: { contentType: 'HTML', content: m.html },
          toRecipients: m.para.map((address) => ({ emailAddress: { address } })),
          attachments: m.anexos.map((a) => ({ '@odata.type': '#microsoft.graph.fileAttachment', name: a.nome, contentType: a.tipo, contentBytes: a.conteudo.toString('base64') })),
        },
        saveToSentItems: true,
      }),
    })
    if (r.status !== 202) throw new Error(`Microsoft 365 recusou o envio (HTTP ${r.status}${await codigoErro(r, 'graph')}).`)
  }
}

/** Só o código do erro (AADSTS… ou ErrorAccessDenied…), com a dica do que
 * falta. Nunca devolve o corpo inteiro (pode ecoar identificadores). */
async function codigoErro(r: Response, fonte: 'token' | 'graph'): Promise<string> {
  let texto = ''
  try {
    texto = (await r.text()).slice(0, 4000)
  } catch {
    return ''
  }
  const codigo = fonte === 'token'
    ? /AADSTS\d+/.exec(texto)?.[0]
    : /"code"\s*:\s*"([A-Za-z0-9_.]{1,80})"/.exec(texto)?.[1]
  if (!codigo) return ''
  return `, ${codigo}${DICAS[codigo] ? ` — ${DICAS[codigo]}` : ''}`
}

const DICAS: Record<string, string> = {
  AADSTS7000215: 'segredo do cliente inválido',
  AADSTS7000222: 'segredo do cliente expirado',
  AADSTS700016: 'Application (client) ID não encontrado neste tenant',
  AADSTS90002: 'tenant não encontrado',
  ErrorAccessDenied: 'falta a permissão Mail.Send de aplicação com consentimento de administrador, ou o Exchange não permite enviar por esta caixa',
  ErrorInvalidUser: 'caixa remetente não existe ou não tem licença/caixa no Exchange Online',
  MailboxNotEnabledForRESTAPI: 'a caixa remetente não está no Exchange Online',
  ResourceNotFound: 'caixa remetente não encontrada',
  ErrorSendAsDenied: 'a aplicação não pode enviar como esta caixa',
}

export function criarEnviadorEmail(cfg: Configuracao): EnviadorEmail {
  if (cfg.email.transporte === 'smtp') return new EnvioSmtp(cfg.email)
  if (cfg.email.transporte === 'graph') return new EnvioGraph(cfg.email)
  return new EnvioDesligado()
}
