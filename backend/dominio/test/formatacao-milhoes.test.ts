/**
 * Regra de apresentação (1.1.2): a partir de R$ 1 milhão o valor aparece em
 * milhões com 3 casas decimais ("R$ 14,665 mi"); abaixo disso, por extenso.
 */
import { describe, expect, it } from 'vitest'
import { classificarCliente, descreverVariacao, formatarMoeda, formatarMoedaCompacta, limiaresDe, validarNovoLimiar, type SnapshotSemanal } from '../src'

const n = (s: string) => s.replace(/ /g, ' ')

describe('milhões com 3 casas decimais', () => {
  it('formatarMoeda', () => {
    expect(n(formatarMoeda(14_665_069.12))).toBe('R$ 14,665 mi')
    expect(n(formatarMoeda(1_000_000))).toBe('R$ 1,000 mi')
    expect(n(formatarMoeda(999_999.6))).toBe('R$ 1,000 mi')
    expect(n(formatarMoeda(1_234_567_890))).toBe('R$ 1.234,568 mi')
    expect(n(formatarMoeda(-2_500_000))).toBe('-R$ 2,500 mi')
    expect(n(formatarMoeda(229_000))).toBe('R$ 229.000')
    expect(n(formatarMoeda(999_999.4))).toBe('R$ 999.999')
    expect(n(formatarMoeda(0))).toBe('R$ 0')
  })
  it('formatarMoedaCompacta', () => {
    expect(n(formatarMoedaCompacta(12_000_000))).toBe('R$ 12,000 mi')
    expect(n(formatarMoedaCompacta(35_000))).toBe('R$ 35 mil')
    expect(n(formatarMoedaCompacta(800))).toBe('R$ 800')
  })
  it('textos de regra usam a mesma apresentação', () => {
    expect(n(validarNovoLimiar('RISCO_CRITICO_VALOR', 2e13, []) ?? '')).toMatch(/R\$ 10.000.000,000 mi\.$/)
    const base = { riscoCliente: 3e6, riscoGrupo: 3e6, limiteGlobal: 5e6, statusProposta: 'APROVADA', trancheConsolidada: 0, valorEmAndamento: 0, vencidoOficial: 1_500_000, il30: 90, il60: 90, il90: 90, recompras: 0, prorrogacoes60: 0, manifestoInacessivel: 0, manifestoNaoConfirma: 0, manifestoTransacaoDesconhecida: 0, manifestoLastroInconsistente: 0, manifestoTransacaoNaoConcluida: 0 } as unknown as SnapshotSemanal
    const c = classificarCliente({ status: 'NORMAL', carteiraApartada: false, atual: base, anterior: null }, limiaresDe([]))
    const textos = n(JSON.stringify(c))
    expect(textos).toContain('R$ 1,500 mi')
    expect(textos).not.toMatch(/R\$ 1\.500\.000/)
    expect(n(descreverVariacao({ label: 'Pefin', quantidadeAnterior: 1, quantidadeAtual: 2, valorAnterior: 35_000, valorAtual: 2_000_000 } as never))).toContain('R$ 2,000 mi')
  })
})
