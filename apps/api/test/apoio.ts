import { carregarConfiguracao, type Configuracao } from '../src/config/configuracao'

export function configTeste(extra: Record<string, string> = {}): Configuracao {
  return carregarConfiguracao({
    AMBIENTE: 'desenvolvimento',
    URL_PUBLICA: 'https://monitoramento.teste',
    DATABASE_URL: process.env.TESTE_DATABASE_URL ?? 'postgresql://ninguem@localhost/nada',
    SESSAO_SEGREDO: 'a'.repeat(64),
    COFRE_CHAVE: 'b'.repeat(64),
    MINIO_ACCESS_KEY: 'teste',
    MINIO_SECRET_KEY: 'teste-segredo',
    ENTRA_TENANT_ID: 'tenant',
    ENTRA_CLIENT_ID: 'cliente-monitoramento',
    ENTRA_CLIENT_SECRET: 'segredo',
    DIRETORIO_URL: 'https://intranet.teste',
    // Vetor de compatibilidade da IA Everblue (test_assinatura_interna.py).
    DIRETORIO_CLIENT_ID: '22222222-2222-4222-8222-222222222222',
    DIRETORIO_INTEGRATION_SECRET: 'snjKGvXDq_tlev7gZ8i5wWeTH3qUw1YFlZ-H7DGkxDY',
    ...extra,
  })
}

/** Substitui `fetch` global por um roteador de respostas simuladas. */
export function simularFetch(rotas: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const original = globalThis.fetch
  const chamadas: { url: string; init?: RequestInit }[] = []
  globalThis.fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.toString() : entrada.url
    chamadas.push({ url, init })
    return rotas(url, init)
  }) as typeof fetch
  return { chamadas, restaurar: () => (globalThis.fetch = original) }
}

export const json = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } })
