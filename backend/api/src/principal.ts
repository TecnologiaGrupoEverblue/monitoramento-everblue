/** Ponto de entrada da API: sobe o servidor e encerra com graça no SIGTERM. */
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici'
import { comporDependencias } from './composicao'
import { carregarConfiguracao } from './config/configuracao'
import { construirServidor } from './http/servidor'

// Respeita HTTPS_PROXY/NO_PROXY do ambiente nas chamadas ao Entra, Graph e
// Intranet — sem isso, uma rede com proxy de saída derruba o login em silêncio.
if (process.env.HTTPS_PROXY || process.env.https_proxy) setGlobalDispatcher(new EnvHttpProxyAgent())

const cfg = carregarConfiguracao()
const deps = comporDependencias(cfg)
const app = await construirServidor(deps)

let encerrando = false
async function encerrar(sinal: string) {
  if (encerrando) return
  encerrando = true
  app.log.info({ sinal }, 'encerrando')
  const prazo = setTimeout(() => process.exit(1), 25_000)
  try {
    await app.close() // para de aceitar e conclui as requisições em curso
    await deps.banco.encerrar()
  } finally {
    clearTimeout(prazo)
    process.exit(0)
  }
}
process.on('SIGTERM', () => void encerrar('SIGTERM'))
process.on('SIGINT', () => void encerrar('SIGINT'))

await app.listen({ host: '0.0.0.0', port: cfg.porta })
