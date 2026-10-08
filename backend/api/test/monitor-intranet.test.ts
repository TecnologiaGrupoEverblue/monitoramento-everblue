/** Alerta de indisponibilidade da Intranet (1.1.4): estado acompanha as
 * consultas reais e a verificação periódica; aviso e auditoria só na MUDANÇA. */
import { afterEach, describe, expect, it } from 'vitest'
import { comporDependencias } from '../src/composicao'
import { construirServidor } from '../src/http/servidor'
import { ArmazenamentoMemoria } from '../src/infra/armazenamento'
import { FonteFotoNenhuma } from '../src/identidade/fontesFoto'
import { ClienteIntranet } from '../src/identidade/intranet'
import { MonitorIntranet } from '../src/identidade/monitorIntranet'
import type { Banco } from '../src/infra/banco'
import { configTeste, json, simularFetch } from './apoio'

let restaurar = () => {}
afterEach(() => restaurar())

const OID = '33333333-3333-4333-8333-333333333333'

describe('monitor da Intranet', () => {
  it('cai, avisa uma vez, audita e volta', async () => {
    let modo: 'negado' | 'tls' | 'liberado' = 'negado'
    const f = simularFetch(() => {
      if (modo === 'tls') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' } })
      if (modo === 'negado') return json(403, { error: 'SYSTEM_ACCESS_DENIED' })
      return json(200, { allowed: true, user: { id: 'u1', entraObjectId: OID, name: 'P', email: 'p@x' } })
    })
    restaurar = f.restaurar
    const intranet = new ClienteIntranet(configTeste())
    const auditados: { acao: string; motivo?: string | null }[] = []
    const monitor = new MonitorIntranet(intranet, { registrar: async (e) => void auditados.push(e) })
    const avisos: string[] = []
    monitor.aoMudar((e, anterior) => avisos.push(`${anterior}->${e.situacao}`))

    expect(monitor.atual().situacao).toBe('DESCONHECIDA')
    // Identidade sintética negada = Intranet e assinatura funcionando.
    expect((await monitor.verificar()).situacao).toBe('OK')
    expect(avisos).toEqual([]) // subir já OK não é alerta

    modo = 'tls'
    await expect(intranet.validarAcesso(OID)).rejects.toThrow(/certificado/) // login real falhou
    expect(monitor.atual()).toMatchObject({ situacao: 'INDISPONIVEL' })
    expect(monitor.atual().motivo).toMatch(/certificado/)
    const desde = monitor.atual().desde
    await monitor.verificar()
    await monitor.verificar()
    expect(monitor.atual().desde).toBe(desde) // continua "desde" a primeira falha
    expect(avisos).toEqual(['OK->INDISPONIVEL']) // uma vez só

    modo = 'liberado'
    await intranet.validarAcesso(OID)
    expect(monitor.atual()).toMatchObject({ situacao: 'OK', motivo: null })
    expect(avisos).toEqual(['OK->INDISPONIVEL', 'INDISPONIVEL->OK'])
    await new Promise((r) => setTimeout(r, 0))
    expect(auditados.map((a) => a.acao)).toEqual(['intranet.indisponivel', 'intranet.restabelecida'])
  })

  it('sem Intranet configurada, fica NAO_CONFIGURADA e não chama nada', async () => {
    const f = simularFetch(() => json(500, {}))
    restaurar = f.restaurar
    const monitor = new MonitorIntranet(new ClienteIntranet(configTeste({ DIRETORIO_URL: '', DIRETORIO_INTEGRATION_SECRET: '' })), null)
    monitor.iniciar(60_000)
    expect((await monitor.verificar()).situacao).toBe('NAO_CONFIGURADA')
    expect(f.chamadas).toHaveLength(0)
    monitor.parar()
  })

  it('/api/health/intranet responde 503 sem expor o motivo técnico', async () => {
    const f = simularFetch(() => {
      throw new TypeError('fetch failed')
    })
    restaurar = f.restaurar
    const bancoFalso = { pool: { query: async () => ({ rows: [] }) }, encerrar: async () => undefined } as unknown as Banco
    const deps = comporDependencias(configTeste(), { banco: bancoFalso, armazenamento: new ArmazenamentoMemoria(), fonteFoto: new FonteFotoNenhuma() })
    const app = await construirServidor(deps, { log: false })
    try {
      expect((await app.inject({ url: '/api/health/intranet' })).json()).toMatchObject({ situacao: 'DESCONHECIDA' })
      await deps.monitorIntranet.verificar()
      const r = await app.inject({ url: '/api/health/intranet' })
      expect(r.statusCode).toBe(503)
      expect(r.json()).toMatchObject({ situacao: 'INDISPONIVEL' })
      expect(r.json()).not.toHaveProperty('motivo')
    } finally {
      await app.close()
    }
  })
})
