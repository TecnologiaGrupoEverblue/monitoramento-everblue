/**
 * Leitura server-side do perfil corporativo no Microsoft Graph (token
 * app-only, client credentials) — o mesmo desenho da IA Everblue:
 *
 * - a Intranet responde se a pessoa PODE usar a aplicação;
 * - o Entra ID / Graph responde QUEM ela é (nome, e-mail, cargo, foto).
 *
 * O navegador nunca escolhe o usuário consultado: o identificador é sempre o
 * `oid` do token OIDC já validado, o que impede enumeração de perfis.
 */
import type { Configuracao } from '../config/configuracao'
import { AutoridadeIndisponivel, motivoDeRede } from './erros'
import { validarFoto, type FotoCorporativa } from './intranet'

export interface PerfilCorporativo {
  oid: string
  email: string
  nome: string
  cargo: string | null
}

const FOLGA_TOKEN_MS = 120_000

export class ClienteGraph {
  private token = { valor: '', expiraEm: 0 }
  private emissao: Promise<string> | null = null

  constructor(private readonly cfg: Configuracao) {}

  get configurado(): boolean {
    return this.cfg.entra.configurado
  }

  private async obterToken(): Promise<string> {
    if (this.token.valor && Date.now() < this.token.expiraEm - FOLGA_TOKEN_MS) return this.token.valor
    // Uma emissão por vez: sem isto, várias requisições no vencimento pedem
    // token ao mesmo tempo e poluem o log de auditoria do tenant.
    this.emissao ??= this.emitirToken().finally(() => {
      this.emissao = null
    })
    return this.emissao
  }

  private async emitirToken(): Promise<string> {
    if (!this.configurado) throw new AutoridadeIndisponivel('Microsoft Entra ID não está configurado.')
    let resposta: Response
    try {
      resposta = await fetch(`https://login.microsoftonline.com/${this.cfg.entra.tenantId}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.cfg.entra.clientId,
          client_secret: this.cfg.entra.clientSecret,
          scope: 'https://graph.microsoft.com/.default',
        }),
        signal: AbortSignal.timeout(this.cfg.entra.timeoutMs),
      })
    } catch (erro) {
      throw new AutoridadeIndisponivel(`Não foi possível contatar o Microsoft Entra ID: ${motivoDeRede(erro)}.`)
    }
    const corpo = (await resposta.json().catch(() => ({}))) as Record<string, unknown>
    if (resposta.status !== 200) {
      const codigo = typeof corpo.error === 'string' ? `, ${corpo.error}` : ''
      throw new AutoridadeIndisponivel(`O Entra ID recusou a credencial do Graph (${resposta.status}${codigo}).`)
    }
    const valor = typeof corpo.access_token === 'string' ? corpo.access_token : ''
    if (!valor) throw new AutoridadeIndisponivel('O Entra ID devolveu token vazio para o Graph.')
    this.token = { valor, expiraEm: Date.now() + Number(corpo.expires_in ?? 3600) * 1000 }
    return valor
  }

  private async get(caminho: string): Promise<Response> {
    const token = await this.obterToken()
    try {
      return await fetch(`https://graph.microsoft.com/v1.0${caminho}`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(this.cfg.entra.timeoutMs),
      })
    } catch (erro) {
      throw new AutoridadeIndisponivel(`Não foi possível consultar o Microsoft Graph: ${motivoDeRede(erro)}.`)
    }
  }

  async obterPerfil(oidBruto: string): Promise<PerfilCorporativo> {
    const oid = oidBruto.trim()
    if (!oid || oid.length > 128) throw new AutoridadeIndisponivel('Identificador corporativo inválido.')
    const resposta = await this.get(`/users/${encodeURIComponent(oid)}?$select=id,displayName,mail,userPrincipalName,jobTitle`)
    if (resposta.status !== 200) {
      throw new AutoridadeIndisponivel(`O Microsoft Graph não devolveu o perfil corporativo (${resposta.status}).`)
    }
    const corpo = (await resposta.json()) as Record<string, unknown>
    const devolvido = String(corpo.id ?? '').trim()
    if (!devolvido || devolvido.toLowerCase() !== oid.toLowerCase()) {
      throw new AutoridadeIndisponivel('O Microsoft Graph respondeu sobre uma identidade diferente da sessão.')
    }
    const email = String(corpo.mail ?? corpo.userPrincipalName ?? '')
      .trim()
      .toLowerCase()
    const nome = String(corpo.displayName ?? '').trim()
    if (!email || !nome) throw new AutoridadeIndisponivel('O perfil corporativo não possui nome ou e-mail.')
    const cargo = String(corpo.jobTitle ?? '').trim()
    return { oid: devolvido, email, nome, cargo: cargo || null }
  }

  async obterFoto(oidBruto: string): Promise<FotoCorporativa | null> {
    const oid = oidBruto.trim()
    if (!oid || oid.length > 128) return null
    const resposta = await this.get(`/users/${encodeURIComponent(oid)}/photo/$value`)
    if (resposta.status === 404) return null
    if (resposta.status !== 200) {
      throw new AutoridadeIndisponivel(`O Microsoft Graph não devolveu a foto corporativa (${resposta.status}).`)
    }
    return validarFoto(Buffer.from(await resposta.arrayBuffer()), resposta.headers.get('content-type'))
  }
}

/**
 * Complemento do retrato pelo Graph que NUNCA bloqueia o acesso — o mesmo
 * papel que o Graph tem na IA Everblue. Quem autoriza é a Intranet, e o
 * retrato corporativo (nome, e-mail, cargo) vem dela. O Graph só é consultado
 * quando a Intranet não devolveu algum desses campos; se falhar (ex.: 403 por
 * falta de consentimento em User.Read.All), segue com o que a Intranet deu.
 */
export async function complementarPeloGraph(
  graph: ClienteGraph,
  ligado: boolean,
  oid: string,
  intranet: { nome: string; email: string; cargo: string | null } | null,
): Promise<{ perfil: PerfilCorporativo | null; graph: 'nao_usado' | 'ok' | 'indisponivel' }> {
  const completo = Boolean(intranet?.nome && intranet?.email && intranet?.cargo)
  const daIntranet = intranet?.nome && intranet?.email ? { oid, nome: intranet.nome, email: intranet.email, cargo: intranet.cargo } : null
  if (!ligado || completo) return { perfil: daIntranet, graph: 'nao_usado' }
  try {
    const g = await graph.obterPerfil(oid)
    return {
      perfil: { oid, nome: daIntranet?.nome || g.nome, email: daIntranet?.email || g.email, cargo: daIntranet?.cargo ?? g.cargo },
      graph: 'ok',
    }
  } catch {
    return { perfil: daIntranet, graph: 'indisponivel' }
  }
}
