import { describe, expect, it } from 'vitest'
import {
  CAMPOS_IMPORTACAO,
  classificarCliente,
  compararRestritivos,
  limiaresDe,
  separarDocumentos,
  textoAlertas,
  validarLinhasPlanilha,
  type SnapshotSemanal,
} from '../src'

const lim = limiaresDe([])

function snap(extra: Partial<SnapshotSemanal> = {}): SnapshotSemanal {
  return {
    id: 's', clienteId: 'c', semanaRef: '2026-09-24', criadoEm: '', riscoCliente: 1_000_000, riscoGrupo: 1_000_000, limiteGlobal: 2_000_000,
    percConsumoLimite: 50, statusProposta: 'APROVADA', validadeProposta: null, trancheConsolidada: 0, valorEmAndamento: 0, percConsumoTranche: 0,
    statusTranche: 'DENTRO_DO_LIMITE', vencidoOficial: 0, vencidoDesde: null, agingCarteiraDias: 0, prazoMedioCarteiraDias: 30,
    il30: 95, il60: 95, il90: 95, il120: 95, il150: 95, il180: 95, manifestoPercSemAtuacao: 0, manifestoInacessivel: 0, manifestoNaoConfirma: 0,
    manifestoTransacaoDesconhecida: 0, manifestoLastroInconsistente: 0, manifestoTransacaoNaoConcluida: 0, liquidadoNoPeriodo: 0, recompras: 0,
    motivoRecompra: null, percLiquidadoNoPrazo: 100, atrasoMedioDias: 0, restritivos: 0, ...extra,
  }
}
const classificar = (s: SnapshotSemanal, extra: Partial<Parameters<typeof classificarCliente>[0]> = {}) =>
  classificarCliente({ status: 'NORMAL', carteiraApartada: false, atual: s, anterior: null, ...extra }, lim)

describe('classificação semanal (regras da base do comitê)', () => {
  it('sem alerta é REGULAR e ENQUADRADO, prioridade 4', () => {
    const c = classificar(snap())
    expect(c).toMatchObject({ criticidade: 'REGULAR', enquadramento: 'ENQUADRADO', prioridadeOrdem: 4, qtdAlertas: 0 })
    expect(textoAlertas(c)).toBe('Sem alerta relevante')
  })

  it('situação do cliente define prioridade e alerta', () => {
    expect(classificar(snap(), { status: 'JURIDICO' })).toMatchObject({ prioridadeOrdem: 1, criticidade: 'CRITICO' })
    expect(classificar(snap(), { status: 'SAIDA_DE_RISCO' })).toMatchObject({ prioridadeOrdem: 2, criticidade: 'CRITICO' })
    expect(classificar(snap(), { status: 'MONITORAMENTO' })).toMatchObject({ prioridadeOrdem: 3, criticidade: 'ATENCAO' })
  })

  it('carteira apartada fica fora: prioridade 9, APARTADO, sem alertas', () => {
    const c = classificar(snap({ vencidoOficial: 999_999 }), { carteiraApartada: true, nomeCarteira: 'QUATTUOR' })
    expect(c).toMatchObject({ prioridadeOrdem: 9, criticidade: 'APARTADO', enquadramento: 'APARTADO', qtdAlertas: 0 })
    expect(textoAlertas(c)).toBe('Carteira QUATTUOR — apartada da análise Everblue')
  })

  it('vencido: atenção abaixo de 30% do risco; crítico a partir de 30% ou de R$ 1 milhão', () => {
    expect(classificar(snap({ vencidoOficial: 100_000 })).alertas[0]).toMatchObject({ nivel: 'ATENCAO', texto: 'Vencido R$ 100.000 (10,0%)' })
    expect(classificar(snap({ vencidoOficial: 300_000 })).alertas[0].nivel).toBe('CRITICO')
    expect(classificar(snap({ riscoGrupo: 50_000_000, vencidoOficial: 1_000_000 })).alertas[0].nivel).toBe('CRITICO')
  })

  it('manifestos: crítico por valor ou peso no risco; lastro com teto menor', () => {
    expect(classificar(snap({ manifestoNaoConfirma: 40_000 })).alertas[0]).toMatchObject({ nivel: 'ATENCAO', texto: 'Manifesto: Não confirma R$ 40.000' })
    expect(classificar(snap({ manifestoNaoConfirma: 60_000 })).alertas[0].nivel).toBe('CRITICO') // 6% do risco
    expect(classificar(snap({ riscoGrupo: 50_000_000, manifestoInacessivel: 100_000 })).alertas[0].nivel).toBe('CRITICO')
    expect(classificar(snap({ manifestoLastroInconsistente: 16_000 })).alertas[0].nivel).toBe('CRITICO')
    expect(classificar(snap({ manifestoLastroInconsistente: 8_000 })).alertas[0].nivel).toBe('ATENCAO')
  })

  it('tranche excedida é crítica, com teto de exibição', () => {
    expect(classificar(snap({ trancheConsolidada: 1, valorEmAndamento: 50_000 })).alertas[0].texto).toBe('Tranche excedida (acima de 1.000%)')
    expect(classificar(snap({ trancheConsolidada: 100_000, valorEmAndamento: 120_300 })).alertas[0].texto).toBe('Tranche excedida (120,3%)')
  })

  it('enquadramento: proposta vencida, risco acima do limite ou consumo ≥ 95%', () => {
    expect(classificar(snap({ statusProposta: 'VENCIDA' }))).toMatchObject({ enquadramento: 'DESENQUADRADO', motivosEnquadramento: ['Proposta vencida'] })
    expect(classificar(snap({ limiteGlobal: 900_000 })).motivosEnquadramento).toEqual(['Risco acima do limite global'])
    expect(classificar(snap({ limiteGlobal: 1_040_000 })).enquadramento).toBe('DESENQUADRADO')
    expect(classificar(snap({ statusProposta: 'SEM_PROPOSTA', limiteGlobal: 0 })).enquadramento).toBe('ENQUADRADO')
  })

  it('aumento de risco: atenção ≥15% e ≥R$ 250 mil; crítico ≥30% ou ≥R$ 1 milhão', () => {
    const anterior = snap({ riscoGrupo: 1_000_000 })
    expect(classificar(snap({ riscoGrupo: 1_200_000 }), { anterior }).alertas.filter((a) => a.regra === 'AUMENTO_RISCO')).toHaveLength(0)
    expect(classificar(snap({ riscoGrupo: 1_260_000, limiteGlobal: 9e6 }), { anterior }).alertas[0]).toMatchObject({ nivel: 'ATENCAO', texto: 'Aumento do risco: R$ 260.000 (26,0%)' })
    expect(classificar(snap({ riscoGrupo: 1_300_000, limiteGlobal: 9e6 }), { anterior }).alertas[0].nivel).toBe('CRITICO')
  })

  it('liquidez: sem base não alerta; IL30 < 50 crítico, < 70 atenção; quedas', () => {
    expect(classificar(snap({ il30: null, il60: null })).tendenciaLiquidez).toBe('SEM_BASE')
    expect(classificar(snap({ il30: 40, il60: 40, il90: 40 })).alertas[0]).toMatchObject({ nivel: 'CRITICO', texto: 'Liquidez 30d baixa: 40,0%' })
    expect(classificar(snap({ il30: 62, il60: 62, il90: 62 })).alertas[0].nivel).toBe('ATENCAO')
    const significativa = classificar(snap({ il30: 80, il60: 96, il90: 90 }))
    expect(significativa.tendenciaLiquidez).toBe('QUEDA_SIGNIFICATIVA')
    expect(significativa.alertas.map((a) => a.texto)).toContain('Queda de liquidez de 16,0% entre 60d e 30d')
    expect(classificar(snap({ il30: 90, il60: 93, il90: 95 })).tendenciaLiquidez).toBe('QUEDA_CONTINUA')
    expect(classificar(snap({ il30: 82, il60: 97, il90: 97 })).tendenciaLiquidez).toBe('ESTAVEL') // exatamente 15 p.p. não é queda
  })

  it('prorrogações e recompras', () => {
    expect(classificar(snap({ prorrogacoesAcima60d: 500_000 })).alertas[0]).toMatchObject({ nivel: 'ATENCAO', texto: 'Prorrogações acima de 60d: R$ 500.000' })
    expect(classificar(snap({ prorrogacoesAcima60d: 1_200_000 })).alertas[0].nivel).toBe('CRITICO')
    expect(classificar(snap({ riscoGrupo: 30_000_000, prorrogacoesAcima60d: 3_000_000 })).alertas[0].nivel).toBe('ATENCAO') // 10% do risco
    expect(classificar(snap({ recompras: 347 })).alertas[0].texto).toBe('Recompras R$ 347')
  })

  it('piora de restritivos por tipo entra como atenção', () => {
    const c = classificar(snap(), {
      restritivos: { atual: [{ tipo: 'PEFIN', quantidade: 15, valor: 229_000 }], anterior: [{ tipo: 'PEFIN', quantidade: 13, valor: 35_000 }] },
    })
    expect(c.alertas[0].regra).toBe('RESTRITIVOS')
    expect(c.alertas[0].texto).toContain('Pefin 13')
  })

  it('limiares configuráveis', () => {
    const c = classificarCliente({ status: 'NORMAL', carteiraApartada: false, atual: snap({ vencidoOficial: 100_000 }), anterior: null }, limiaresDe([{ chave: 'VENCIDO_CRITICO_PERC', valor: 5 }]))
    expect(c.criticidade).toBe('CRITICO')
  })
})

describe('restritivos', () => {
  it('compara tipo a tipo e marca piora', () => {
    const v = compararRestritivos(
      [{ tipo: 'PEFIN', quantidade: 15, valor: 36_000 }, { tipo: 'REFIN', quantidade: 5, valor: 581_000 }],
      [{ tipo: 'PEFIN', quantidade: 5, valor: 12_000 }, { tipo: 'PROTESTO', quantidade: 2, valor: 10_000 }],
    )
    expect(v.map((x) => [x.tipo, x.piorou])).toEqual([['PEFIN', true], ['REFIN', true], ['PROTESTO', false]])
    expect(compararRestritivos([{ tipo: 'PEFIN', quantidade: 1, valor: 1 }], null)[0].piorou).toBe(false)
  })
})

describe('planilha: qualidade do dado (1.1)', () => {
  const obrigatorias = CAMPOS_IMPORTACAO.filter((c) => !c.opcional).map((c) => c.coluna)
  const linha = (valores: Record<string, string>, colunas = obrigatorias) =>
    colunas.map((c) => valores[c] ?? ({ Cliente: 'Empresa', CNPJ: '11.222.333/0001-81', 'Status (NORMAL, MONITORAMENTO, SAIDA_DE_RISCO, JURIDICO)': 'NORMAL', 'Status da Proposta (EM_ANALISE, APROVADA, VENCIDA, REPROVADA)': 'APROVADA' } as Record<string, string>)[c] ?? '1000')

  it('modelo anterior (sem colunas opcionais) continua válido', () => {
    const r = validarLinhasPlanilha([obrigatorias, linha({})])
    expect(r.colunasFaltando).toEqual([])
    expect(r.validas).toHaveLength(1)
    expect(r.validas[0].carteira).toBeNull()
  })

  it('vários CNPJs na célula: o primeiro é o principal; zero extra à esquerda some', () => {
    expect(separarDocumentos('​039285002000100, 39.285.002/0008-86; 039285002000703')).toEqual(['39.285.002/0001-00', '39.285.002/0008-86', '39.285.002/0007-03'])
    const r = validarLinhasPlanilha([obrigatorias, linha({ CNPJ: '11.222.333/0001-81; 11.222.333/0002-62' })])
    expect(r.validas[0].cnpj).toBe('11.222.333/0001-81')
    expect(r.validas[0].documentos).toHaveLength(2)
  })

  it('"SEM BASE" e vazio na liquidez são ausência, não zero', () => {
    const r = validarLinhasPlanilha([obrigatorias, linha({ 'IL 30 dias (%)': 'SEM BASE', 'IL 60 dias (%)': '' })])
    expect(r.validas[0].il30).toBeNull()
    expect(r.validas[0].il60).toBeNull()
    expect(r.validas[0].il90).toBe(1000)
  })

  it('texto em campo numérico opcional vira erro da linha (antes virava 0)', () => {
    const r = validarLinhasPlanilha([obrigatorias, linha({ 'Recompras (R$)': '237 mil da garantia' })])
    expect(r.validas).toHaveLength(0)
    expect(r.comErro[0].erros[0]).toMatch(/texto em campo numérico/)
  })

  it('SEM PROPOSTA / VIGENTE e status com acento são aceitos', () => {
    const r = validarLinhasPlanilha([
      obrigatorias,
      linha({ 'Status da Proposta (EM_ANALISE, APROVADA, VENCIDA, REPROVADA)': 'SEM PROPOSTA', 'Status (NORMAL, MONITORAMENTO, SAIDA_DE_RISCO, JURIDICO)': 'SAÍDA DE RISCO' }),
      linha({ CNPJ: '22.333.444/0001-55', 'Status da Proposta (EM_ANALISE, APROVADA, VENCIDA, REPROVADA)': 'VIGENTE' }),
    ])
    expect(r.validas.map((l) => [l.statusProposta, l.status])).toEqual([['SEM_PROPOSTA', 'SAIDA_DE_RISCO'], ['APROVADA', 'NORMAL']])
  })

  it('tranche e limite simbólicos geram aviso, não erro', () => {
    const r = validarLinhasPlanilha([obrigatorias, linha({ 'Tranche Consolidada (R$)': '1', 'Limite Global (R$)': '1000' })])
    expect(r.validas[0].avisos).toEqual([expect.stringMatching(/Tranche simbólica/), expect.stringMatching(/Limite global simbólico/)])
  })

  it('carteira e restritivos por tipo (colunas opcionais)', () => {
    const colunas = [...obrigatorias, 'Carteira', 'Pefin (qtd)', 'Pefin (R$)', 'Refin (qtd)', 'Refin (R$)']
    const r = validarLinhasPlanilha([colunas, linha({ Carteira: 'QUATTUOR', 'Pefin (qtd)': '15', 'Pefin (R$)': '229.000,00', 'Refin (qtd)': '', 'Refin (R$)': '' }, colunas)])
    expect(r.validas[0].carteira).toBe('QUATTUOR')
    expect(r.validas[0].restritivosPorTipo).toEqual([{ tipo: 'PEFIN', quantidade: 15, valor: 229000 }])
    expect(r.validas[0].restritivos).toBe(15)
  })
})
