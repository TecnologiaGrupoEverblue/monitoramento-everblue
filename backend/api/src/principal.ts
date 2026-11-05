/** Ponto de entrada da API: sobe o servidor e encerra com graça no SIGTERM. */
import { configurarProxyDeSaida } from './infra/proxy'
import { comporDependencias } from './composicao'
import { carregarConfiguracao } from './config/configuracao'
import { construirServidor } from './http/servidor'

configurarProxyDeSaida()

const cfg = carregarConfiguracao()
// O log do Fastify só existe depois do servidor; a foto escreve por este repasse.
const repasse = { alvo: null as null | { info: (o: object, m: string) => void; error: (o: object, m: string) => void } }
const deps = comporDependencias(cfg, {
  log: { info: (o, m) => repasse.alvo?.info(o, m), error: (o, m) => repasse.alvo?.error(o, m) },
})
const app = await construirServidor(deps)
repasse.alvo = { info: (o, m) => app.log.info(o, m), error: (o, m) => app.log.error(o, m) }

let encerrando = false
async function encerrar(sinal: string) {
  if (encerrando) return
  encerrando = true
  app.log.info({ sinal }, 'encerrando')
  const prazo = setTimeout(() => process.exit(1), 25_000)
  try {
    deps.monitorIntranet.parar()
    deps.agendadorFoto.parar()
    await app.close() // para de aceitar e conclui as requisições em curso
    await deps.gatewayBitfin?.drenar(10_000)
    if ('encerrar' in deps.leitorBitfin) await (deps.leitorBitfin as { encerrar: () => Promise<void> }).encerrar()
    await deps.banco.encerrar()
  } finally {
    clearTimeout(prazo)
    process.exit(0)
  }
}
process.on('SIGTERM', () => void encerrar('SIGTERM'))
process.on('SIGINT', () => void encerrar('SIGINT'))

await app.listen({ host: '0.0.0.0', port: cfg.porta })
deps.monitorIntranet.iniciar(cfg.diretorio.monitorMs)
deps.agendadorFoto.iniciar()
