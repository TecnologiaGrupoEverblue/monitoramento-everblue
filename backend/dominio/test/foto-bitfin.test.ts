/**
 * Foto do Bitfin com os números REAIS conferidos nas rodadas 4 e 5
 * (29/10/2026): CDA (cliente 600), Action Line (6) e Fex Agro (253).
 */
import { describe, expect, it } from 'vitest'
import {
  calcularPrazoMedio,
  conferirManifesto,
  indiceLiquidez,
  montarFoto,
  statusDaProposta,
  validarLinhasPlanilha,
  type BitfinConta,
  type DadosFotoBitfin,
} from '../src'

const conta = (c: Partial<BitfinConta> & Pick<BitfinConta, 'clienteId' | 'contaOperacionalId' | 'produtoId' | 'produto' | 'risco'>): BitfinConta => ({
  contaCorrenteId: null,
  unidade: 'EverBlue I FIDC',
  riscoVencido: 0,
  riscoVencidoPrimeiraData: null,
  prorrogados: 0,
  semAtuacao: 0,
  emAndamento: 0,
  naoConcluida: 0,
  lastroInconsistente: 0,
  transacaoDesconhecida: 0,
  protestado: 0,
  concluida: 0,
  promessa: 0,
  ciencia: 0,
  naoConfirma: 0,
  inacessivel: 0,
  indiceLiquidez: null,
  vencimentario: null,
  liquidados: null,
  recomprados: null,
  penalizados: null,
  ...c,
})

// Conta 2834 da CDA (A05, apuração 29/10/2026 07:00).
const cda2834 = conta({
  clienteId: 600,
  contaOperacionalId: 2834,
  produtoId: 1,
  produto: 'Faturização',
  risco: 2192338.05,
  riscoVencido: 37264.57,
  riscoVencidoPrimeiraData: '2026-10-14T00:00:00.000Z',
  emAndamento: 126695.62,
  lastroInconsistente: 344793.25,
  concluida: 758824,
  ciencia: 768006.02,
  naoConfirma: 194019.16,
  indiceLiquidez: 91.73,
  vencimentario: 2373290.12,
  liquidados: 2177024.28,
  recomprados: 159001.27,
  penalizados: 37264.57,
})
const cda4896 = conta({ clienteId: 600, contaOperacionalId: 4896, produtoId: 18, produto: 'Nota Comercial', risco: 579785.27, inacessivel: 579785.27, indiceLiquidez: 100, liquidados: 105770.98, vencimentario: 105770.98 })
const action1916 = conta({ clienteId: 6, contaOperacionalId: 1916, produtoId: 18, produto: 'Nota Comercial', risco: 2129426.68, inacessivel: 2129426.68 })
const fex2033 = conta({
  clienteId: 253,
  contaOperacionalId: 2033,
  produtoId: 7,
  produto: 'Cobrança Vinculada',
  risco: 441490.5,
  riscoVencido: 99590.5,
  riscoVencidoPrimeiraData: '2026-06-01T00:00:00.000Z',
  emAndamento: 184100,
  lastroInconsistente: 99590.5,
  concluida: 157800,
})
const fex1985 = conta({ clienteId: 253, contaOperacionalId: 1985, produtoId: 18, produto: 'Nota Comercial', risco: 516442.69, inacessivel: 516442.69 })

const base: DadosFotoBitfin = {
  lidoEm: '2026-10-29T10:30:00.000Z',
  clientes: [
    {
      clienteId: 600,
      nome: 'Cia. Distrib. de Alum. S A',
      documento: '012766216000141',
      situacao: 'Monitoramento',
      grupoEconomicoId: 298,
      grupo: 'Grupo Cda Aluminio',
      cnaeSecao: 'G',
      cnaeDenominacao: 'Comércio atacadista de ferragens e ferramentas',
      risco: 2772123.32,
      riscoVencido: 37264.57,
      indiceLiquidez: 91.73,
      vencimentario: 2373290.12,
      liquidados: 2177024.28,
      recomprados: 159001.27,
      dataInicialLiquidez: '2026-09-29T00:00:00.000Z',
      dataFinalLiquidez: '2026-10-28T00:00:00.000Z',
      dataApuracaoLiquidez: '2026-10-29T07:00:09.403Z',
    },
    {
      clienteId: 6,
      nome: 'Action Line Do Brasil Ltda',
      documento: '002379828000128',
      situacao: 'SaidaDeRisco',
      grupoEconomicoId: 85,
      grupo: 'Grupo Action Line Do Brasil Ltda',
      cnaeSecao: 'C',
      cnaeDenominacao: null,
      risco: 2129426.68,
      riscoVencido: 0,
      indiceLiquidez: 100,
      vencimentario: 1562479.52,
      liquidados: 1562479.52,
      recomprados: 0,
      dataInicialLiquidez: '2026-09-29T00:00:00.000Z',
      dataFinalLiquidez: '2026-10-28T00:00:00.000Z',
      dataApuracaoLiquidez: '2026-10-29T07:00:09.403Z',
    },
    {
      clienteId: 253,
      nome: 'Fex Agro Coml. Ltda',
      documento: '011011716000100',
      situacao: 'Juridico',
      grupoEconomicoId: 1295,
      grupo: 'Grupo Fex',
      cnaeSecao: 'G',
      cnaeDenominacao: 'Comércio atacadista de sementes',
      risco: 957933.19,
      riscoVencido: 99590.5,
      indiceLiquidez: null,
      vencimentario: null,
      liquidados: null,
      recomprados: null,
      dataInicialLiquidez: null,
      dataFinalLiquidez: null,
      dataApuracaoLiquidez: null,
    },
  ],
  responsaveis: [
    { clienteId: 600, papel: 'GERENTE', membroId: 10, nome: 'Joice Benicio Coelho', email: 'joice@grupoeverblue.com.br', ativo: true },
    { clienteId: 600, papel: 'ASSISTENTE', membroId: 11, nome: 'Assistente', email: 'assistente@grupoeverblue.com.br', ativo: true },
  ],
  contas: [cda2834, cda4896, action1916, fex2033, fex1985],
  produtos: [
    { clienteId: 600, produtoId: 1, produto: 'Faturização', limite: 5000000, tranche: 600000, risco: 2192338.05 },
    { clienteId: 600, produtoId: 18, produto: 'Nota Comercial', limite: 1000000, tranche: 0, risco: 579785.27 },
    { clienteId: 6, produtoId: 18, produto: 'Nota Comercial', limite: 2000000.01, tranche: 0, risco: 2129426.68 },
  ],
  produtosGrupo: [
    { grupoEconomicoId: 298, produtoId: 1, produto: 'Faturização', limite: 5000000, tranche: 600000, risco: 2192338.05, concluida: 758824 },
    { grupoEconomicoId: 298, produtoId: 18, produto: 'Nota Comercial', limite: 1000000, tranche: 0, risco: 579785.27, concluida: 0 },
    { grupoEconomicoId: 85, produtoId: 18, produto: 'Nota Comercial', limite: 2000000.01, tranche: 0, risco: 2129426.68, concluida: 0 },
  ],
  propostas: [
    { grupoEconomicoId: 298, propostaId: 1687, totalLimites: 6000000, validade: '2026-11-07T00:00:00.000Z', vigente: true },
    { grupoEconomicoId: 85, propostaId: 900, totalLimites: 2000000.01, validade: '2026-12-29T00:00:00.000Z', vigente: true },
  ],
  liquidez: [
    // CDA: recálculo de 30 dias igual ao gravado (91,73%).
    { clienteId: 600, janela: 30, liquidado: 2177024.28, total: 2373290.12 },
    { clienteId: 600, janela: 60, liquidado: 4000000, total: 4200000 },
    { clienteId: 600, janela: 90, liquidado: 6000000, total: 6200000 },
    { clienteId: 6, janela: 30, liquidado: 1562479.52, total: 1562479.52 },
  ],
  operacoesPrazo: [
    // CDA: 5 últimas de Faturização (A08) — NC fica de fora.
    { clienteId: 600, grupo: 1, ordem: 1, operacaoId: 16874, data: '2026-10-28T14:42:14.317Z', produto: 'Faturização', valorBase: 257398.35, prazo: 42 },
    { clienteId: 600, grupo: 1, ordem: 2, operacaoId: 16849, data: '2026-10-27', produto: 'Faturização', valorBase: 117450, prazo: 24 },
    { clienteId: 600, grupo: 1, ordem: 3, operacaoId: 16811, data: '2026-10-23', produto: 'Faturização', valorBase: 510607.67, prazo: 43.959002 },
    { clienteId: 600, grupo: 1, ordem: 4, operacaoId: 16804, data: '2026-10-22', produto: 'Faturização', valorBase: 77819.18, prazo: 37.496732 },
    { clienteId: 600, grupo: 1, ordem: 5, operacaoId: 16742, data: '2026-10-19', produto: 'Faturização', valorBase: 80887.83, prazo: 42 },
    { clienteId: 600, grupo: 2, ordem: 1, operacaoId: 99999, data: '2026-04-01', produto: 'Nota Comercial', valorBase: 1, prazo: 300 },
    // Action Line: só Nota Comercial (tela da operação 16562 = 77,13 dias).
    { clienteId: 6, grupo: 2, ordem: 1, operacaoId: 16562, data: '2026-10-01', produto: 'Nota Comercial', valorBase: 2129426.68, prazo: 77.133032 },
    { clienteId: 6, grupo: 2, ordem: 2, operacaoId: 14571, data: '2026-06-30', produto: 'Nota Comercial', valorBase: 2129426.68, prazo: 79.73305 },
    { clienteId: 6, grupo: 2, ordem: 3, operacaoId: 12191, data: '2026-04-01', produto: 'Nota Comercial', valorBase: 2126611.01, prazo: 77.566866 },
    { clienteId: 6, grupo: 2, ordem: 4, operacaoId: 10907, data: '2025-12-29', produto: 'Nota Comercial', valorBase: 2133180.01, prazo: 80.485518 },
    { clienteId: 6, grupo: 2, ordem: 5, operacaoId: 9153, data: '2025-09-25', produto: 'Nota Comercial', valorBase: 2123376.43, prazo: 79.471041 },
  ],
  atrasos: [{ clienteId: 600, valor: 1000, valorVezesDias: 2500 }],
  pontualidade: [{ documento: '12.766.216/0001-41', ano: 2026, mes: 9, emDia: 90, esperado: 100, pontual: 80, de8a15: 5, de16a30: 3, de31a60: 2, acima60: 0, recomprado: 0 }],
  aging: [],
  eventos: [
    {
      clienteId: 600,
      eventoId: 10911,
      titulo: 'Ata de Monitoramento de Risco',
      categoria: 'Monitoramento',
      nivel: 2,
      desfecho: 0,
      dataCadastro: '2026-10-29T16:03:29.990Z',
      dataAtualizacao: null,
      criadoPor: 'Juliano de Souza Motta',
      ocorrencias: [{ data: '2026-10-29T16:03:28.960Z', autor: 'Juliano Motta', categoria: 'Monitoramento', mensagem: 'Vencido da Spe Augusta enviado para cartório.' }],
    },
  ],
  operacoesMes: [{ clienteId: 600, mesAnterior: 3000000, mesAtual: 1500000 }],
}

const validar = (linhas: unknown[][]) => validarLinhasPlanilha(linhas, { agingDerivadoDoVencido: true })

describe('foto do Bitfin', () => {
  it('prazo médio: média simples das 5 últimas de duplicata; NC fora quando há duplicata', () => {
    const cda = calcularPrazoMedio(base.operacoesPrazo.filter((o) => o.clienteId === 600))
    expect(cda.origem).toBe('DUPLICATA')
    expect(cda.dias).toBe(37.89)
    expect(cda.operacoesUsadas).toBe(5)
    const action = calcularPrazoMedio(base.operacoesPrazo.filter((o) => o.clienteId === 6))
    expect(action.origem).toBe('NOTA_COMERCIAL')
    expect(action.dias).toBe(78.88)
    expect(calcularPrazoMedio([])).toMatchObject({ origem: 'SEM_OPERACAO', dias: null })
  })

  it('índice de liquidez e proposta', () => {
    expect(indiceLiquidez(2177024.28, 2373290.12)).toBe(91.73)
    expect(indiceLiquidez(0, 0)).toBeNull()
    expect(statusDaProposta({ grupoEconomicoId: 1, propostaId: 1, totalLimites: 1, validade: '2026-10-28', vigente: true }, '2026-10-29')).toBe('VENCIDA')
    expect(statusDaProposta(undefined, '2026-10-29')).toBe('SEM_PROPOSTA')
  })

  it('manifesto fecha 100% do risco (prova da A05)', () => {
    expect(conferirManifesto(cda2834)).toBe(true)
    expect(conferirManifesto(fex2033)).toBe(true)
    expect(conferirManifesto({ ...cda2834, ciencia: 0 })).toBe(false)
  })

  it('monta linhas que passam na MESMA validação da importação, com os valores do Bitfin', () => {
    const foto = montarFoto(base)
    expect(foto.recusas).toEqual([])
    const r = validar(foto.linhas)
    expect(r.colunasFaltando).toEqual([])
    expect(r.comErro).toEqual([])
    expect(r.validas).toHaveLength(3)

    const cda = r.validas.find((l) => l.cnpj === '12.766.216/0001-41')!
    expect(cda.status).toBe('MONITORAMENTO')
    expect(cda.riscoCliente).toBe(2772123.32)
    expect(cda.limiteGlobal).toBe(6000000)
    expect(cda.statusProposta).toBe('APROVADA')
    expect(cda.validadeProposta).toBe('2026-11-07')
    // Regra 1: risco do produto com tranche − transação concluída (grupo).
    expect(cda.trancheConsolidada).toBe(600000)
    expect(cda.valorEmAndamento).toBe(1433514.05)
    expect(cda.vencidoOficial).toBe(37264.57)
    expect(cda.vencidoDesde).toBe('2026-10-14')
    expect(cda.prazoMedioCarteiraDias).toBe(37.89)
    expect(cda.il30).toBe(91.73)
    // Manifesto sem a Nota Comercial: inacessível da NC NÃO entra.
    expect(cda.manifestoInacessivel).toBe(0)
    expect(cda.manifestoNaoConfirma).toBe(194019.16)
    expect(cda.manifestoLastroInconsistente).toBe(344793.25)
    expect(cda.manifestoPercSemAtuacao).toBe(0)
    expect(cda.liquidadoNoPeriodo).toBe(2177024.28)
    expect(cda.recompras).toBe(159001.27)
    expect(cda.percLiquidadoNoPrazo).toBe(80)
    expect(cda.atrasoMedioDias).toBe(2.5)
    expect(cda.gerente).toBe('Joice Benicio Coelho')
    expect(cda.plataforma).toBe('EverBlue I FIDC')
    expect(cda.setor).toBe('Comércio; reparação de veículos automotores e motocicletas')
    expect(cda.produtos).toEqual(['Faturização', 'Nota Comercial'])
    expect(cda.operacoesMes).toBe(1500000)

    const action = r.validas.find((l) => l.cnpj === '02.379.828/0001-28')!
    expect(action.status).toBe('SAIDA_DE_RISCO')
    expect(action.prazoMedioCarteiraDias).toBe(78.88)
    expect(action.manifestoInacessivel).toBe(0)
    expect(action.trancheConsolidada).toBe(0)
    expect(action.valorEmAndamento).toBe(0)
    // Sem pontualidade do mês fechado: "não informado", nunca 0%.
    expect(action.percLiquidadoNoPrazo).toBeNull()
    expect(action.gerente).toBe('Sem Gerente')

    const fex = r.validas.find((l) => l.cnpj === '11.011.716/0001-00')!
    expect(fex.status).toBe('JURIDICO')
    // Cobrança Vinculada entra no manifesto; a NC (inacessível 516 mil) não.
    expect(fex.manifestoInacessivel).toBe(0)
    expect(fex.manifestoLastroInconsistente).toBe(99590.5)
    expect(fex.statusProposta).toBe('SEM_PROPOSTA')
    expect(fex.limiteGlobal).toBe(0)
    expect(fex.il30).toBeNull()
    expect(fex.vencidoDesde).toBe('2026-06-01')
  })

  it('fail-closed: ausente é "não informado", nunca 0', () => {
    const r = validar(montarFoto(base).linhas)
    const action = r.validas.find((l) => l.cnpj === '02.379.828/0001-28')!
    expect(action.manifestoPercSemAtuacao).toBeNull() // só Nota Comercial: sem carteira manifestada
    expect(action.atrasoMedioDias).toBeNull() // nenhum título liquidado na janela
    const fex = r.validas.find((l) => l.cnpj === '11.011.716/0001-00')!
    expect(fex.prazoMedioCarteiraDias).toBeNull() // sem operação de duplicata nem NC
    expect(fex.liquidadoNoPeriodo).toBeNull() // sem apuração de liquidez
    expect(fex.manifestoPercSemAtuacao).toBe(0) // Cobrança Vinculada sem "sem atuação"
  })

  it('apuração antiga do Bitfin e cliente sem grupo ficam marcados; data local de São Paulo', () => {
    const antiga = montarFoto({ ...base, lidoEm: '2026-10-30T12:00:00.000Z' })
    expect(antiga.divergencias.some((d) => d.campo === 'Apuração da liquidez')).toBe(true)
    // 22h de 29/10 em São Paulo = 01h de 30/10 UTC: ainda é dia 29 (apuração do dia, sem divergência)
    expect(montarFoto({ ...base, lidoEm: '2026-10-30T01:00:00.000Z' }).divergencias.some((d) => d.campo === 'Apuração da liquidez')).toBe(false)
    const semGrupo = montarFoto({ ...base, clientes: base.clientes.map((c) => (c.clienteId === 600 ? { ...c, grupoEconomicoId: null } : c)) })
    const cda = semGrupo.detalhes.find((d) => d.bitfinClienteId === 600)!
    expect(cda.tranche).toMatchObject({ tranche: 600000, emAndamento: 1433514.05 })
    expect(semGrupo.divergencias.some((d) => d.campo === 'Grupo econômico')).toBe(true)
  })

  it('liquidez 60–180 só sai quando o recálculo de 30 dias confere com o Bitfin', () => {
    const ok = montarFoto(base)
    const cdaOk = ok.detalhes.find((d) => d.bitfinClienteId === 600)!
    expect(cdaOk.liquidez.conferencia30).toBe('CONFERE')
    expect(validar(ok.linhas).validas.find((l) => l.cnpj === '12.766.216/0001-41')!.il60).toBe(95.24)

    const divergente = montarFoto({ ...base, liquidez: base.liquidez.map((l) => (l.clienteId === 600 && l.janela === 30 ? { ...l, liquidado: l.liquidado - 10000 } : l)) })
    const cda = divergente.detalhes.find((d) => d.bitfinClienteId === 600)!
    expect(cda.liquidez.conferencia30).toBe('DIVERGE')
    expect(divergente.divergencias.some((d) => d.clienteId === 600 && d.campo === 'Índice de liquidez')).toBe(true)
    const linha = validar(divergente.linhas).validas.find((l) => l.cnpj === '12.766.216/0001-41')!
    expect(linha.il30).toBe(91.73)
    expect(linha.il60).toBeNull()
    expect(linha.il180).toBeNull()
  })

  it('fail-closed: sem clientes ou com situação/documento desconhecidos, a foto é recusada', () => {
    expect(montarFoto({ ...base, clientes: [] }).recusas.length).toBe(1)
    const estranha = montarFoto({ ...base, clientes: [{ ...base.clientes[0], situacao: 'Bloqueado' }] })
    expect(estranha.recusas[0]).toContain('Bloqueado')
    const semDoc = montarFoto({ ...base, clientes: [{ ...base.clientes[0], documento: '123' }] })
    expect(semDoc.recusas[0]).toContain('não é CNPJ nem CPF')
  })

  it('guarda o detalhe: eventos, limite, tranche, responsáveis e manifesto por conta', () => {
    const d = montarFoto(base).detalhes.find((x) => x.bitfinClienteId === 600)!
    expect(d.eventos).toHaveLength(1)
    expect(d.eventos[0].ocorrencias[0].mensagem).toContain('Spe Augusta')
    expect(d.limite).toMatchObject({ total: 6000000, origem: 'PROPOSTA', propostaId: 1687 })
    expect(d.tranche.consumoPerc).toBe(238.92)
    expect(d.responsaveis.map((r) => r.papel)).toEqual(['GERENTE', 'ASSISTENTE'])
    expect(d.manifesto.contas.find((c) => c.contaOperacionalId === 4896)!.noManifesto).toBe(false)
    expect(d.pontualidade).toMatchObject({ percPontual: 80, percAtraso: 10 })
  })

  it('restritivos continuam manuais: a foto repete a última quantidade gravada', () => {
    const foto = montarFoto(base, { restritivosAnteriores: new Map([['12766216000141', 7]]) })
    expect(validar(foto.linhas).validas.find((l) => l.cnpj === '12.766.216/0001-41')!.restritivos).toBe(7)
  })
})

describe('checklist com a foto do Bitfin (regras 1 e 2 de 29/10)', async () => {
  const { sugerirChecklist } = await import('../src')
  const { gerarDadosFicticios } = await import('../src/fixtures/gerarDadosFicticios')
  const { clientes, snapshots } = gerarDadosFicticios()
  const cliente = clientes[0]
  const snap = { ...snapshots.find((s) => s.clienteId === cliente.id)!, riscoCliente: 2772123.32, limiteGlobal: 6000000, percConsumoLimite: 46.2 }
  const base = { cliente, snapshotAtual: snap, snapshotAnterior: null, snapshotMesAnterior: null, serieRecente: [snap], planos: [], alertas: [], juridico: null, analiseTransacional: null }

  it('LIMITE CONSUMIDO mostra o limite do cliente vindo do Bitfin', () => {
    const r = sugerirChecklist({ ...base, bitfin: { tiradaEm: '2026-10-29T10:30:00Z', eventos: [], limite: { total: 6000000, origem: 'PROPOSTA', validade: '2026-11-07' } } })
    const item = r.find((i) => i.item === 'LIMITE_CONSUMIDO')!
    expect(item.resumo).toContain('Limite do cliente (Bitfin, proposta vigente até 07/11/2026)')
    expect(item.resumo.replace(/\s/g, ' ')).toContain('R$ 6,000 mi · 46,2% consumido (risco R$ 2,772 mi)')
    expect(item.gravidade).toBe('VERDE')
  })

  it('risco sem limite vigente nunca aparece como 0% consumido', () => {
    const r = sugerirChecklist({ ...base, snapshotAtual: { ...snap, limiteGlobal: 0, percConsumoLimite: 0 }, bitfin: { tiradaEm: '2026-10-29T10:30:00Z', eventos: [], limite: { total: 0, origem: 'SEM_LIMITE', validade: null } } })
    const item = r.find((i) => i.item === 'LIMITE_CONSUMIDO')!
    expect(item.gravidade).toBe('VERMELHO')
    expect(item.resumo).toContain('Sem limite vigente no Bitfin')
  })

  it('EVENTOS: só os do Bitfin da última semana; sem foto = não conferido', () => {
    const comEventos = sugerirChecklist({ ...base, bitfin: { tiradaEm: '2026-10-29T10:30:00Z', eventos: dadosFotoExemploEventos(), limite: { total: 1, origem: 'PROPOSTA', validade: null } } })
    expect(comEventos.find((i) => i.item === 'EVENTOS')!.resumo).toBe('1 evento(s) no Bitfin na última semana: Ata de Monitoramento de Risco.')
    const semFoto = sugerirChecklist({ ...base, bitfin: null })
    expect(semFoto.find((i) => i.item === 'EVENTOS')!).toMatchObject({ gravidade: 'AMARELO', resumo: 'Sem foto do Bitfin para este cliente: eventos da semana não conferidos.' })
    const vazio = sugerirChecklist({ ...base, bitfin: { tiradaEm: '2026-10-29T10:30:00Z', eventos: [], limite: { total: 1, origem: 'PROPOSTA', validade: null } } })
    expect(vazio.find((i) => i.item === 'EVENTOS')!).toMatchObject({ gravidade: 'VERDE', resumo: 'Nenhum evento no Bitfin na última semana.' })
  })

  it('MANIFESTOS: soma dos 4 tipos da foto (Imperio, 05/11: bate com a tela do Bitfin)', async () => {
    const { resumirManifesto } = await import('../src')
    const conta = (x: Record<string, number | boolean | string>) => ({
      contaOperacionalId: 1, produto: 'Faturização', noManifesto: true, risco: 0, concluida: 0, semAtuacao: 0, emAndamento: 0, naoConcluida: 0,
      lastroInconsistente: 0, transacaoDesconhecida: 0, ciencia: 0, naoConfirma: 0, inacessivel: 0, protestado: 0, promessa: 0, ...x,
    }) as Parameters<typeof resumirManifesto>[0]['contas'][number]
    const imperio = { baseRisco: 3764691.7, contas: [conta({ risco: 3764691.7, concluida: 3418409.23, naoConfirma: 214404.71, ciencia: 131877.76 })] }
    const r = resumirManifesto(imperio)
    expect(r.total).toBe(0)
    expect(r.todas.find((c) => c.chave === 'naoConfirma')).toMatchObject({ valor: 214404.71, perc: 5.7 })
    expect(r.todas.find((c) => c.chave === 'concluida')!.perc).toBe(90.8)
    const item = (m: typeof imperio) => sugerirChecklist({ ...base, bitfin: { tiradaEm: '2026-11-05T11:19:00Z', eventos: [], limite: { total: 1, origem: 'PROPOSTA', validade: null }, manifesto: m } }).find((i) => i.item === 'MANIFESTOS')!
    expect(item(imperio)).toMatchObject({ gravidade: 'VERDE', dado: { tipo: 'manifesto', total: 0 } })

    // Os 4 tipos somam; conta fora do manifesto (NC) não entra.
    const comProblema = {
      baseRisco: 1000000,
      contas: [conta({ risco: 1000000, naoConcluida: 20000, protestado: 10000, concluida: 970000 }), conta({ produto: 'Nota Comercial', noManifesto: false, risco: 500000, transacaoDesconhecida: 500000 })],
    }
    const i2 = item(comProblema)
    expect(i2.gravidade).toBe('AMARELO')
    expect(i2.resumo.replace(/\s/g, ' ')).toBe('R$ 30.000 em problemas de manifesto (3,0% do risco).')
    expect(i2.dado).toMatchObject({ tipo: 'manifesto', total: 30000, perc: 3, tipos: [{ chave: 'transacaoDesconhecida', valor: 0 }, { chave: 'lastroInconsistente', valor: 0 }, { chave: 'naoConcluida', valor: 20000 }, { chave: 'protestado', valor: 10000 }] })
    expect(item({ baseRisco: 1000000, contas: [conta({ risco: 1000000, lastroInconsistente: 1, concluida: 999999 })] }).gravidade).toBe('VERMELHO')
    expect(item({ baseRisco: 1000000, contas: [conta({ risco: 1000000, protestado: 60000, concluida: 940000 })] }).gravidade).toBe('VERMELHO')
  })

  it('AGING: vencimentário do Bitfin por faixa; sem vencimentário = não conferido (nunca "0 dias")', () => {
    const limite = { total: 1, origem: 'PROPOSTA' as const, validade: null }
    const zero = { ate30: 0, de31a60: 0, de61a90: 0, de91a180: 0, de181a360: 0, acima360: 0 }
    const zeroV = { de6a30: 0, de31a60: 0, de61a90: 0, de91a180: 0, de181a360: 0, acima360: 0 }
    const aging = (vencer: Partial<typeof zero>, vencido: Partial<typeof zeroV>) => ({ documento: '1', vencer: { ...zero, ...vencer }, vencido: { ...zeroV, ...vencido } })
    const item = (a: ReturnType<typeof aging> | null | undefined) =>
      sugerirChecklist({ ...base, bitfin: { tiradaEm: '2026-10-29T10:30:00Z', eventos: [], limite, ...(a === undefined ? {} : { aging: a }) } }).find((i) => i.item === 'AGING_CARTEIRA')!

    const emDia = item(aging({ ate30: 1500000, de31a60: 500000 }, {}))
    expect(emDia.gravidade).toBe('VERDE')
    expect(emDia.resumo.replace(/\s/g, ' ')).toBe('A vencer R$ 2,000 mi · Vencido R$ 0.')
    expect(emDia.dado).toMatchObject({ tipo: 'categorias' })

    expect(item(aging({ ate30: 1000 }, { de31a60: 200 })).gravidade).toBe('AMARELO')
    const critico = item(aging({ ate30: 1000 }, { de91a180: 200 }))
    expect(critico.gravidade).toBe('VERMELHO')
    expect(critico.resumo.replace(/\s/g, ' ')).toBe('A vencer R$ 1.000 · Vencido R$ 200 (R$ 200 há mais de 90 dias).')
    expect(critico.dado).toMatchObject({ itens: [{ cor: 'VERDE' }, { label: 'Vencido 91 a 180 dias', cor: 'VERMELHO' }] })

    expect(item(null)).toMatchObject({ gravidade: 'AMARELO', resumo: 'O Bitfin não trouxe o vencimentário deste cliente: conferir no Bitfin.' })
    expect(sugerirChecklist({ ...base, bitfin: null }).find((i) => i.item === 'AGING_CARTEIRA')!.resumo).toBe('Sem foto do Bitfin para este cliente: vencimentário não conferido.')
    // Foto antiga sem o campo: mantém o cálculo anterior.
    expect(item(undefined).resumo).toMatch(/^Aging da carteira: \d+ dias\.$/)
  })
})

function dadosFotoExemploEventos() {
  return base.eventos
}
