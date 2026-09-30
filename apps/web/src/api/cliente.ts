/**
 * Cliente HTTP único da interface. Nenhum componente chama `fetch` direto:
 * tudo passa pelos repositórios em `src/repositories`, que usam este módulo.
 *
 * Trata centralmente sessão e autorização:
 * - 401 com `X-Reautenticar`: o crachá venceu — ida e volta silenciosa ao Entra.
 * - 401 sem sessão: volta para a tela de login, lembrando onde a pessoa estava.
 * - 403 `sem_acesso`: a Intranet retirou o acesso — tela de login explica.
 */
import type { ProblemaApi } from '@monitoramento/dominio'

export class ErroApi extends Error {
  readonly status: number
  readonly codigo: string
  constructor(status: number, message: string, codigo: string) {
    super(message)
    this.name = 'ErroApi'
    this.status = status
    this.codigo = codigo
  }
}

type ValorConsulta = string | number | boolean | null | undefined

export interface OpcoesRequisicao {
  consulta?: Record<string, ValorConsulta>
  corpo?: unknown
  formulario?: FormData
  sinal?: AbortSignal
  /** `false` devolve o erro 401/403 a quem chamou, sem redirecionar (tela de login). */
  tratarSessao?: boolean
}

const EVENTO_ERRO = 'monitoramento:erro-api'

/** Tela inteira interessada em erros de API (ex.: aviso global) escuta aqui. */
export function aoOcorrerErroApi(ouvinte: (erro: ErroApi) => void): () => void {
  const manipulador = (e: Event) => ouvinte((e as CustomEvent<ErroApi>).detail)
  window.addEventListener(EVENTO_ERRO, manipulador)
  return () => window.removeEventListener(EVENTO_ERRO, manipulador)
}

function caminhoAtual(): string {
  return `${window.location.pathname}${window.location.search}`
}

function montarUrl(caminho: string, consulta?: Record<string, ValorConsulta>): string {
  const parametros = new URLSearchParams()
  for (const [chave, valor] of Object.entries(consulta ?? {})) {
    if (valor !== null && valor !== undefined && valor !== '') parametros.set(chave, String(valor))
  }
  const texto = parametros.toString()
  return texto ? `${caminho}?${texto}` : caminho
}

let redirecionando = false
function redirecionar(destino: string): Promise<never> {
  if (!redirecionando) {
    redirecionando = true
    window.location.assign(destino)
  }
  // A página vai sair; a promessa não precisa resolver.
  return new Promise<never>(() => {})
}

export async function requisitar<T>(metodo: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', caminho: string, opcoes: OpcoesRequisicao = {}): Promise<T> {
  const cabecalhos: Record<string, string> = { accept: 'application/json', 'x-destino': caminhoAtual() }
  let corpo: BodyInit | undefined
  if (opcoes.formulario) corpo = opcoes.formulario
  else if (opcoes.corpo !== undefined) {
    cabecalhos['content-type'] = 'application/json'
    corpo = JSON.stringify(opcoes.corpo)
  }

  let resposta: Response
  try {
    resposta = await fetch(montarUrl(caminho, opcoes.consulta), { method: metodo, headers: cabecalhos, body: corpo, credentials: 'same-origin', signal: opcoes.sinal })
  } catch (erro) {
    if ((erro as Error).name === 'AbortError') throw erro
    const falha = new ErroApi(0, 'Não foi possível falar com o servidor. Verifique a conexão e tente novamente.', 'rede')
    window.dispatchEvent(new CustomEvent(EVENTO_ERRO, { detail: falha }))
    throw falha
  }

  if (resposta.status === 204) return undefined as T
  const tipo = resposta.headers.get('content-type') ?? ''
  const dados = tipo.includes('json') ? await resposta.json().catch(() => null) : null

  if (resposta.ok) return dados as T

  const problema = (dados ?? {}) as Partial<ProblemaApi>
  const codigo = problema.codigo ?? 'erro'
  if (opcoes.tratarSessao === false && (resposta.status === 401 || resposta.status === 403)) {
    throw new ErroApi(resposta.status, problema.detail ?? 'Sessão não autenticada.', codigo)
  }
  if (resposta.status === 401) {
    const reautenticar = resposta.headers.get('x-reautenticar')
    if (reautenticar) return redirecionar(reautenticar)
    const motivo = codigo === 'renovacao' ? '&erro=renovacao' : ''
    return redirecionar(`/login?destino=${encodeURIComponent(caminhoAtual())}${motivo}`)
  }
  if (resposta.status === 403 && codigo === 'sem_acesso') return redirecionar('/login?erro=sem_acesso')

  const erro = new ErroApi(resposta.status, problema.detail ?? 'Não foi possível concluir a operação.', codigo)
  window.dispatchEvent(new CustomEvent(EVENTO_ERRO, { detail: erro }))
  throw erro
}

export const api = {
  get: <T>(caminho: string, consulta?: Record<string, ValorConsulta>, sinal?: AbortSignal) => requisitar<T>('GET', caminho, { consulta, sinal }),
  post: <T>(caminho: string, corpo?: unknown) => requisitar<T>('POST', caminho, { corpo }),
  put: <T>(caminho: string, corpo?: unknown) => requisitar<T>('PUT', caminho, { corpo }),
  patch: <T>(caminho: string, corpo?: unknown) => requisitar<T>('PATCH', caminho, { corpo }),
  enviar: <T>(caminho: string, formulario: FormData) => requisitar<T>('POST', caminho, { formulario }),
}

/**
 * Envio com progresso (XMLHttpRequest: `fetch` não informa o progresso do
 * upload). Usado pela Central de Arquivos, onde um arquivo pode ser grande.
 */
export function enviarComProgresso<T>(caminho: string, formulario: FormData, aoProgredir: (fracao: number) => void, sinal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolver, rejeitar) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', caminho)
    xhr.withCredentials = true
    xhr.setRequestHeader('accept', 'application/json')
    xhr.setRequestHeader('x-destino', caminhoAtual())
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) aoProgredir(e.loaded / e.total)
    }
    xhr.onerror = () => rejeitar(new ErroApi(0, 'Não foi possível falar com o servidor. Verifique a conexão e tente novamente.', 'rede'))
    xhr.onabort = () => rejeitar(Object.assign(new Error('Envio cancelado.'), { name: 'AbortError' }))
    xhr.onload = () => {
      let dados: unknown = null
      try {
        dados = xhr.responseText ? JSON.parse(xhr.responseText) : null
      } catch {
        dados = null
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolver(dados as T)
      const problema = (dados ?? {}) as Partial<ProblemaApi>
      if (xhr.status === 401) {
        const reautenticar = xhr.getResponseHeader('x-reautenticar')
        void redirecionar(reautenticar ?? `/login?destino=${encodeURIComponent(caminhoAtual())}`)
        return
      }
      if (xhr.status === 403 && problema.codigo === 'sem_acesso') {
        void redirecionar('/login?erro=sem_acesso')
        return
      }
      const mensagem = xhr.status === 413 ? 'O arquivo excede o tamanho máximo permitido.' : (problema.detail ?? 'Não foi possível concluir o envio.')
      rejeitar(new ErroApi(xhr.status, mensagem, problema.codigo ?? 'erro'))
    }
    sinal?.addEventListener('abort', () => xhr.abort())
    xhr.send(formulario)
  })
}
