import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici'

/** Respeita HTTPS_PROXY/NO_PROXY nas chamadas ao Entra, Graph e Intranet —
 * sem isso, uma rede com proxy de saída derruba login e e-mail em silêncio.
 * Usado pela API e pela linha de comando (testar-email precisa do mesmo caminho). */
export function configurarProxyDeSaida(): void {
  if (process.env.HTTPS_PROXY || process.env.https_proxy) setGlobalDispatcher(new EnvHttpProxyAgent())
}
