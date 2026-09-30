/**
 * Cliente da API de Controle de Acessos da Intranet
 * (contrato: `docs/central-access.md` do repositório da Intranet) — porte
 * fiel de `backend/comum/diretorio.py` da IA Everblue.
 *
 * A Intranet é a autoridade de QUEM PODE usar esta aplicação e do
 * departamento. O Entra já provou QUEM a pessoa é (o `oid` do ID token); esta
 * chamada pergunta, separadamente, se ela pode usar o Monitoramento.
 *
 * A chamada é autenticada por ASSINATURA INTERNA (HMAC-SHA256), não por token
 * delegado:
 *
 *   canônico  = "v1\nGET\n<caminho>\n<client id>\n<oid>\n<timestamp>\n<nonce>"
 *   assinatura = hex(HMAC-SHA256(DIRETORIO_INTEGRATION_SECRET, canônico))
 *
 * A chave é EXCLUSIVA desta aplicação: derivada pela Intranet do segredo
 * mestre dela e do Client ID do Monitoramento. O mestre nunca sai da Intranet
 * e uma aplicação comprometida não assina em nome de outra. A Intranet recusa
 * assinatura com mais de 90 s e nonce repetido.
 */
import { createHmac, randomBytes } from 'node:crypto'
import type { Configuracao } from '../config/configuracao'
import { AcessoNegado, AutoridadeIndisponivel, motivoDeRede } from './erros'

export const CAMINHO_ME = '/api/access/v1/me'
export const CAMINHO_FOTO = '/api/access/v1/photo'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface DepartamentoCorporativo {
  /** `null` quando a Intranet só conhece o departamento pelo nome (cadastro legado). */
  externoId: string | null
  nome: string
  slug: string
}

export interface AcessoConfirmado {
  usuarioExternoId: string
  entraOid: string
  departamento: DepartamentoCorporativo | null
  nome: string
  email: string
  cargo: string | null
}

export interface FotoCorporativa {
  conteudo: Buffer
  tipo: string
}

export const LIMITE_FOTO_BYTES = 5 * 1024 * 1024
export const TIPOS_FOTO = new Set(['image/jpeg', 'image/png', 'image/webp'])

export interface EntradaAssinatura {
  metodo: string
  caminho: string
  clientId: string
  oid: string
  timestamp: string
  nonce: string
}

/** Texto assinado — idêntico a `canonicalDirectoryRequest` da Intranet. */
export function canonico(e: EntradaAssinatura): string {
  return ['v1', e.metodo.toUpperCase(), e.caminho, e.clientId.toLowerCase(), e.oid.toLowerCase(), e.timestamp, e.nonce].join('\n')
}

export function assinar(segredo: string, e: EntradaAssinatura): string {
  return createHmac('sha256', segredo).update(canonico(e), 'utf8').digest('hex')
}

export class ClienteIntranet {
  constructor(
    private readonly cfg: Configuracao,
    private readonly relogio: () => number = Date.now,
    private readonly gerarNonce: () => string = () => randomBytes(24).toString('base64url'),
  ) {}

  get ativo(): boolean {
    return this.cfg.diretorio.autorizacaoPeloMe
  }

  /** Cabeçalhos assinados para UMA requisição (nonce de uso único). */
  cabecalhosAssinados(caminho: string, oid: string): Record<string, string> {
    const clientId = this.cfg.diretorio.clientId
    const segredo = this.cfg.diretorio.integrationSecret
    if (!clientId || segredo.length < 32) {
      throw new AutoridadeIndisponivel('Integração interna com a Intranet não configurada. Preencha DIRETORIO_CLIENT_ID e DIRETORIO_INTEGRATION_SECRET no .env.')
    }
    const entrada: EntradaAssinatura = {
      metodo: 'GET',
      caminho,
      clientId,
      oid: oid.trim().toLowerCase(),
      timestamp: String(Math.floor(this.relogio() / 1000)),
      nonce: this.gerarNonce(),
    }
    return {
      'X-Everblue-Client-Id': entrada.clientId,
      'X-Everblue-User-Oid': entrada.oid,
      'X-Everblue-Timestamp': entrada.timestamp,
      'X-Everblue-Nonce': entrada.nonce,
      'X-Everblue-Signature': assinar(segredo, entrada),
    }
  }

  /** Deixa seguir (devolve o acesso), ou lança. Nunca devolve "provavelmente pode". */
  async validarAcesso(oidEsperado: string): Promise<AcessoConfirmado> {
    if (!this.ativo) {
      throw new AutoridadeIndisponivel('Validação de acesso pela Intranet não configurada. Preencha DIRETORIO_URL, DIRETORIO_CLIENT_ID e DIRETORIO_INTEGRATION_SECRET no .env do servidor.')
    }
    const oid = oidEsperado.trim()
    if (!UUID.test(oid)) throw new AutoridadeIndisponivel('A sessão não possui identidade Entra válida vinculada.')

    let resposta: Response
    try {
      resposta = await fetch(`${this.cfg.diretorio.url}${CAMINHO_ME}`, {
        headers: { ...this.cabecalhosAssinados(CAMINHO_ME, oid), accept: 'application/json' },
        signal: AbortSignal.timeout(this.cfg.diretorio.timeoutMs),
      })
    } catch (erro) {
      if (erro instanceof AutoridadeIndisponivel) throw erro
      throw new AutoridadeIndisponivel(`Não foi possível validar o acesso na Intranet: ${motivoDeRede(erro)}.`)
    }
    const corpo = (await resposta.json().catch(() => ({}))) as Record<string, unknown>
    const codigo = typeof corpo.error === 'string' ? corpo.error : ''

    if (resposta.status === 403) {
      // Cada motivo tem destinatário diferente: falta de liberação é com o
      // administrador da Intranet; aplicação não cadastrada, com quem opera o
      // Controle de Acessos.
      if (codigo === 'SYSTEM_ACCESS_DENIED') {
        throw new AcessoNegado('Seu acesso ao Monitoramento não está liberado no cadastro corporativo. Solicite a liberação na Intranet, em Configurações › Controle de Acessos.')
      }
      if (codigo === 'APPLICATION_NOT_AUTHORIZED' || codigo === 'INTERNAL_AUTH_REQUIRED') {
        throw new AutoridadeIndisponivel(
          `A Intranet recusou esta aplicação (${codigo}). Confira em Configurações › Controle de Acessos se o Monitoramento está cadastrado e ativo com este Application (client) ID.`,
        )
      }
      throw new AcessoNegado('A Intranet negou o acesso a esta aplicação.')
    }
    if (resposta.status === 401) {
      throw new AutoridadeIndisponivel(`A Intranet recusou a assinatura interna (${codigo || 'INTERNAL_AUTH_INVALID'}). Confira DIRETORIO_CLIENT_ID, DIRETORIO_INTEGRATION_SECRET e o relógio do servidor.`)
    }
    if (resposta.status === 503 && codigo === 'INTERNAL_AUTH_CONFIGURATION_MISSING') {
      throw new AutoridadeIndisponivel('A Intranet ainda não tem a chave mestre da integração interna (ACCESS_API_MASTER_SECRET).')
    }
    if (resposta.status === 429) {
      throw new AutoridadeIndisponivel('A Intranet está limitando as chamadas. Tente entrar novamente em alguns instantes.')
    }
    if (resposta.status !== 200 || corpo.allowed !== true) {
      throw new AutoridadeIndisponivel(`A Intranet devolveu ${resposta.status} ao validar o acesso${codigo ? ` (${codigo})` : ''}.`)
    }

    const usuario = (corpo.user ?? {}) as Record<string, unknown>
    const oidResposta = texto(usuario.entraObjectId)
    const usuarioId = texto(usuario.id)
    if (!oidResposta || !usuarioId) {
      throw new AutoridadeIndisponivel('A Intranet autorizou o acesso, mas não devolveu a identidade corporativa esperada.')
    }
    // Divergindo, o espelho seria gravado sobre a pessoa errada, em silêncio.
    if (oidResposta.toLowerCase() !== oid.toLowerCase()) {
      throw new AutoridadeIndisponivel('A Intranet respondeu sobre uma identidade diferente da sessão.')
    }

    // A Intranet preserva usuários antigos cujo departamento existe só como
    // texto: vem o nome, com `id` e `slug` nulos. O nome basta para o espelho.
    let departamento: DepartamentoCorporativo | null = null
    const bruto = usuario.department
    if (bruto && typeof bruto === 'object') {
      const d = bruto as Record<string, unknown>
      const nome = texto(d.name)
      if (nome) departamento = { externoId: texto(d.id) || null, nome, slug: texto(d.slug) }
    }
    return {
      usuarioExternoId: usuarioId,
      entraOid: oidResposta,
      departamento,
      nome: texto(usuario.name),
      email: texto(usuario.email).toLowerCase(),
      cargo: texto(usuario.jobTitle) || null,
    }
  }

  /** Foto da pessoa autenticada (GET /api/access/v1/photo, mesma assinatura). `null` sem foto. */
  async obterFoto(oid: string | null): Promise<FotoCorporativa | null> {
    if (!this.ativo || !oid || !UUID.test(oid.trim())) return null
    try {
      const resposta = await fetch(`${this.cfg.diretorio.url}${CAMINHO_FOTO}`, {
        headers: this.cabecalhosAssinados(CAMINHO_FOTO, oid),
        signal: AbortSignal.timeout(this.cfg.diretorio.timeoutMs),
      })
      if (resposta.status !== 200) return null
      return validarFoto(Buffer.from(await resposta.arrayBuffer()), resposta.headers.get('content-type'))
    } catch {
      return null
    }
  }
}

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : ''
}

export function validarFoto(conteudo: Buffer, tipoBruto: string | null): FotoCorporativa | null {
  const tipo = (tipoBruto ?? '').split(';', 1)[0].trim().toLowerCase()
  if (!TIPOS_FOTO.has(tipo)) return null
  if (conteudo.length === 0 || conteudo.length > LIMITE_FOTO_BYTES) return null
  return { conteudo, tipo }
}
