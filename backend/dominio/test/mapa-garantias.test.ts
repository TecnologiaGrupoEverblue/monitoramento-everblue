/**
 * Mapa de Garantias — dados sintéticos com a mesma estrutura do caso GF
 * (conferido com a base real em 29/10/2026: total 1.803.866,35, vagão
 * 176.331,00 e transação desconhecida fora do vagão 16.799,58 = planilha).
 */
import { describe, expect, it } from 'vitest'
import { CONFIG_MAPA_PADRAO, calcularMapaCliente, montarDestinatarios, type DadosMapaBitfin, type MapaTituloBitfin } from '../src'

const t = (sacadoId: number, saldo: number, vencimento: string, status: number | null = 6, vencimentoOriginal: string | null = vencimento, vencimentoAtual: string | null = vencimento): MapaTituloBitfin => ({ clienteId: 1, contaOperacionalId: 70, sacadoId, saldo, vencimento, vencimentoAtual, vencimentoOriginal, status })

const dados: DadosMapaBitfin = {
  lidoEm: '2026-10-29T10:30:00Z',
  clientes: [{ clienteId: 1, nome: 'GF Pneus', documento: '93.894.954/0001-76', grupo: 'Grupo GF' }],
  contas: [
    { clienteId: 1, contaOperacionalId: 18, contaCorrenteId: 1004, produtoId: 18, produto: 'Nota Comercial', unidade: 'EverBlue I FIDC', risco: 1000000, prorrogados: 0, indiceLiquidez: 100 },
    { clienteId: 1, contaOperacionalId: 70, contaCorrenteId: 1074, produtoId: 7, produto: 'Cobrança Vinculada', unidade: 'EverBlue I FIDC', risco: 1010000, prorrogados: 30000, indiceLiquidez: 90.49 },
  ],
  titulos: [
    // sacado 1: um título vencido → TODO o saldo dele vai para o vagão (inclusive o desconhecido)
    t(1, 50000, '2026-10-20'),
    t(1, 40000, '2026-11-20', 4),
    // sacado 2: em dia; desconhecido e lastro deduzidos uma vez
    t(2, 16799.58, '2026-11-25', 4),
    t(2, 31730.34, '2026-11-26', 3),
    t(2, 6645.41, '2026-11-27', 2),
    // sacado 3: prorrogado (fora do vagão e do manifesto)
    t(3, 30000, '2026-12-10', 6, '2026-11-10'),
    // sacado 4: saudável, e "não confirma" (9) não é deduzido
    t(4, 834824.67, '2026-12-15', 6),
    t(4, 0, '2026-12-16', 9),
  ],
  garantias: [
    { clienteId: 1, garantiaId: 1, tipo: 'Recebivel', valor: null, percentual: 80, status: 2, contaOperacionalId: 70, bemTipo: null, bemDescricao: null, valorEmGarantia: null, vencimento: null },
    { clienteId: 1, garantiaId: 2, tipo: 'Real', valor: 3384486.68, percentual: null, status: 2, contaOperacionalId: null, bemTipo: 'Estoque', bemDescricao: '6068 pneus', valorEmGarantia: 3384486.68, vencimento: '2031-05-21' },
  ],
  contasGraficas: [
    { clienteId: 1, contaCorrenteId: 1004, descricao: 'Conta Gráfica - Nota Comercial', produto: 'Nota Comercial', saldo: 559.14, ultimoLancamento: null },
    { clienteId: 1, contaCorrenteId: 1074, descricao: 'Conta Gráfica - Cobrança Vinculada', produto: 'Cobrança Vinculada', saldo: 30809.97, ultimoLancamento: null },
  ],
  responsaveis: [
    { clienteId: 1, papel: 'GERENTE', membroId: 1, nome: 'Gerente G', email: 'Gerente@grupoeverblue.com.br', ativo: true },
    { clienteId: 1, papel: 'ASSISTENTE', membroId: 2, nome: 'Assistente A', email: 'assistente@grupoeverblue.com.br', ativo: true },
    { clienteId: 1, papel: 'DIRETOR', membroId: 3, nome: 'Diretor D', email: 'diretor@grupoeverblue.com.br', ativo: true },
    { clienteId: 1, papel: 'SUPERINTENDENTE', membroId: 4, nome: 'Inativo', email: 'inativo@grupoeverblue.com.br', ativo: false },
  ],
}

describe('Mapa de Garantias', () => {
  const l = calcularMapaCliente(dados, 1, CONFIG_MAPA_PADRAO, '2026-10-29')!

  it('exigibilidade = risco da NC × % de exigência', () => {
    expect(l.riscoNotaComercial).toBe(1000000)
    expect(l.exigenciaPerc).toBe(80)
    expect(l.exigibilidade).toBe(800000)
    expect(l.fundo).toBe('EverBlue I FIDC')
  })

  it('cada título deduzido uma vez: vagão → manifesto → prorrogado', () => {
    expect(l.cobrancaVinculada).toBe(1010000)
    expect(l.efeitoVagao).toBe(90000) // inclui o desconhecido de 40.000 do sacado vencido
    expect(l.manifesto).toEqual([
      { status: 2, descricao: 'Transação não concluída', valor: 6645.41 },
      { status: 3, descricao: 'Lastro inconsistente', valor: 31730.34 },
      { status: 4, descricao: 'Transação desconhecida', valor: 16799.58 },
    ])
    expect(l.prorrogados).toBe(30000)
    expect(l.garantiasValidas).toBe(1010000 - 90000 - 55175.33 - 30000)
    expect(l.divergencias).toEqual([])
  })

  it('contas gráficas: padrão = Cobrança Vinculada; o analista pode escolher outras', () => {
    expect(l.totalContasGraficas).toBe(30809.97)
    expect(l.garantiaTotal).toBe(834824.67 + 30809.97)
    expect(l.sobraFalta).toBe(Math.round((834824.67 + 30809.97 - 800000) * 100) / 100)
    const comNc = calcularMapaCliente(dados, 1, { ...CONFIG_MAPA_PADRAO, contasGraficas: [1004, 1074] }, '2026-10-29')!
    expect(comNc.totalContasGraficas).toBe(31369.11)
  })

  it('ajuste de fim de semana/feriado NÃO é prorrogação; título sem categoria fica marcado', () => {
    const feriado = { ...dados, titulos: [...dados.titulos.filter((x) => x.sacadoId !== 3), t(3, 30000, '2026-11-23', 6, '2026-11-20', '2026-11-20')] }
    const m = calcularMapaCliente(feriado, 1, CONFIG_MAPA_PADRAO, '2026-10-29')!
    expect(m.prorrogados).toBe(0)
    expect(m.divergencias.some((d) => d.includes('Prorrogados'))).toBe(true) // conta diz 30.000 prorrogados: conferir
    const semStatus = calcularMapaCliente({ ...dados, titulos: [...dados.titulos, t(5, 1000, '2026-12-20', null)], contas: dados.contas.map((c) => (c.produtoId === 7 ? { ...c, risco: 1011000 } : c)) }, 1, CONFIG_MAPA_PADRAO, '2026-10-29')!
    expect(semStatus.divergencias.some((d) => d.includes('sem categoria'))).toBe(true)
  })

  it('outras garantias aparecem à parte e não somam', () => {
    expect(l.outrasGarantias).toEqual([{ tipo: 'Real (Estoque)', descricao: '6068 pneus', valor: 3384486.68, vencimento: '2031-05-21' }])
    expect(l.garantiaTotal).toBeLessThan(1000000)
  })

  it('dedução manual com justificativa reduz as válidas; divergência fica visível', () => {
    const m = calcularMapaCliente(dados, 1, { ...CONFIG_MAPA_PADRAO, deducoes: [{ valor: 9533.3, justificativa: 'Títulos regularizados', responsavel: 'Juliano', data: '2026-10-29' }] }, '2026-10-29')!
    expect(m.deducoesManuais).toBe(9533.3)
    expect(m.garantiasValidas).toBe(Math.round((l.garantiasValidas - 9533.3) * 100) / 100)
    const div = calcularMapaCliente({ ...dados, contas: dados.contas.map((c) => (c.produtoId === 7 ? { ...c, risco: 1 } : c)) }, 1, CONFIG_MAPA_PADRAO, '2026-10-29')!
    expect(div.divergencias[0]).toContain('Títulos em aberto da Cobrança Vinculada')
    const semExig = calcularMapaCliente({ ...dados, garantias: [] }, 1, CONFIG_MAPA_PADRAO, '2026-10-29')!
    expect(semExig.exigibilidade).toBeNull()
    expect(semExig.sobraFalta).toBeNull()
  })

  it('destinatários: cada responsável recebe só os seus; cópias recebem tudo; inativo não recebe', () => {
    const outro = { ...l, bitfinClienteId: 2, documento: '11.111.111/0001-11', responsaveis: [{ clienteId: 2, papel: 'GERENTE' as const, membroId: 9, nome: 'Outro', email: 'outro@grupoeverblue.com.br', ativo: true }] }
    const d = montarDestinatarios([l, outro], ['copia@grupoeverblue.com.br', 'invalido'])
    expect(d.map((x) => x.email)).toEqual(['assistente@grupoeverblue.com.br', 'copia@grupoeverblue.com.br', 'diretor@grupoeverblue.com.br', 'gerente@grupoeverblue.com.br', 'outro@grupoeverblue.com.br'])
    expect(d.find((x) => x.email === 'gerente@grupoeverblue.com.br')!.clientes).toEqual(['93894954000176'])
    expect(d.find((x) => x.email === 'copia@grupoeverblue.com.br')!.clientes).toEqual(['93894954000176', '11111111000111'])
  })
})
