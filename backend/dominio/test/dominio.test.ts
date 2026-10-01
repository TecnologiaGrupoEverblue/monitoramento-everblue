import { describe, expect, it } from 'vitest'
import { aplicarFiltrosClientes, avaliarAlertasSnapshot, CONFIGURACOES_ALERTA_PADRAO, FILTROS_VAZIOS, normalizarCnpj, semanaAnteriorRef, semanaMesAnteriorRef } from '../src'
import { gerarDadosFicticios } from '../src/fixtures/gerarDadosFicticios'

describe('regras puras do domínio', () => {
  it('navega entre semanas', () => {
    const s = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28']
    expect(semanaAnteriorRef(s, '2026-09-28')).toBe('2026-09-21')
    expect(semanaAnteriorRef(s, '2026-08-31')).toBeNull()
    expect(semanaMesAnteriorRef(s, '2026-09-28')).toBe('2026-08-31')
  })
  it('normaliza CNPJ', () => expect(normalizarCnpj('12.345.678/0001-90')).toBe('12345678000190'))
  it('carga fictícia é determinística e os filtros cruzam', () => {
    const a = gerarDadosFicticios()
    const b = gerarDadosFicticios()
    expect(a.clientes.map((c) => c.cnpj)).toEqual(b.clientes.map((c) => c.cnpj))
    const monitorados = aplicarFiltrosClientes(a.clientes, { ...FILTROS_VAZIOS, status: 'MONITORAMENTO' })
    expect(monitorados.every((c) => c.status === 'MONITORAMENTO')).toBe(true)
  })
  it('alerta de tranche excedida dispara acima do limiar', () => {
    const { snapshots } = gerarDadosFicticios()
    const base = snapshots[0]
    const alertas = avaliarAlertasSnapshot({ ...base, percConsumoTranche: 150, statusTranche: 'EXCEDIDA' }, base, CONFIGURACOES_ALERTA_PADRAO)
    expect(alertas.some((a) => a.tipo.toLowerCase().includes('tranche') || a.descricao.toLowerCase().includes('tranche'))).toBe(true)
  })
})
