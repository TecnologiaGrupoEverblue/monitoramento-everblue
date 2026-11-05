/** Leitura do Bitfin de exemplo, com os números reais das rodadas 4 e 5 (29/10/2026). */
import type { BitfinConta, DadosFotoBitfin } from '@monitoramento/dominio'

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

export const dadosFotoExemplo: DadosFotoBitfin = {
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
  aging: [{ documento: '12766216000141', vencer: { ate30: 1250000, de31a60: 640000, de61a90: 310000, de91a180: 120000, de181a360: 0, acima360: 0 }, vencido: { de6a30: 45000, de31a60: 0, de61a90: 0, de91a180: 0, de181a360: 0, acima360: 0 } }],
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


/** Base do Mapa de Garantias (sintética, mesma estrutura do caso GF). */
export const dadosMapaExemplo: import('@monitoramento/dominio').DadosMapaBitfin = {
  lidoEm: '2026-10-29T10:30:00.000Z',
  clientes: [
    { clienteId: 548, nome: 'GF Pneus Comercial e Distribuidora Ltda', documento: '093894954000176', grupo: 'Grupo GF' },
    { clienteId: 895, nome: 'Ddc Life Servicos de Escritorio Ltda', documento: '026054318000149', grupo: 'Grupo DDC' },
  ],
  contas: [
    { clienteId: 548, contaOperacionalId: 4896, contaCorrenteId: 1004, produtoId: 18, produto: 'Nota Comercial', unidade: 'EverBlue I FIDC', risco: 1000000, prorrogados: 0, indiceLiquidez: 100 },
    { clienteId: 548, contaOperacionalId: 4897, contaCorrenteId: 1074, produtoId: 7, produto: 'Cobrança Vinculada', unidade: 'EverBlue I FIDC', risco: 960000, prorrogados: 0, indiceLiquidez: 90.49 },
    { clienteId: 895, contaOperacionalId: 5001, contaCorrenteId: 2001, produtoId: 18, produto: 'Nota Comercial', unidade: 'EverBlue Securitizadora', risco: 189406.13, prorrogados: 0, indiceLiquidez: 95.23 },
    { clienteId: 895, contaOperacionalId: 5002, contaCorrenteId: 2002, produtoId: 7, produto: 'Cobrança Vinculada', unidade: 'EverBlue Securitizadora', risco: 278758.42, prorrogados: 0, indiceLiquidez: 95.23 },
  ],
  titulos: [
    { clienteId: 548, contaOperacionalId: 4897, sacadoId: 1, saldo: 60000, vencimento: '2026-10-20', vencimentoAtual: '2026-10-20', vencimentoOriginal: '2026-10-20', status: 6 },
    { clienteId: 548, contaOperacionalId: 4897, sacadoId: 2, saldo: 16799.58, vencimento: '2026-11-25', vencimentoAtual: '2026-11-25', vencimentoOriginal: '2026-11-25', status: 4 },
    { clienteId: 548, contaOperacionalId: 4897, sacadoId: 3, saldo: 883200.42, vencimento: '2026-12-15', vencimentoAtual: '2026-12-15', vencimentoOriginal: '2026-12-15', status: 6 },
    // DDC: vagão de 16.821,32 (conferido centavo a centavo com a planilha)
    { clienteId: 895, contaOperacionalId: 5002, sacadoId: 7, saldo: 16821.32, vencimento: '2026-10-10', vencimentoAtual: '2026-10-10', vencimentoOriginal: '2026-10-10', status: 9 },
    { clienteId: 895, contaOperacionalId: 5002, sacadoId: 8, saldo: 261937.1, vencimento: '2026-11-30', vencimentoAtual: '2026-11-30', vencimentoOriginal: '2026-11-30', status: 9 },
  ],
  garantias: [
    { clienteId: 548, garantiaId: 3333, tipo: 'Recebivel', valor: null, percentual: 80, status: 2, contaOperacionalId: 4897, bemTipo: null, bemDescricao: null, valorEmGarantia: null, vencimento: null },
    { clienteId: 895, garantiaId: 3400, tipo: 'Recebivel', valor: null, percentual: 100, status: 2, contaOperacionalId: 5002, bemTipo: null, bemDescricao: null, valorEmGarantia: null, vencimento: null },
  ],
  contasGraficas: [
    { clienteId: 548, contaCorrenteId: 1074, descricao: 'Conta Gráfica - Cobrança Vinculada', produto: 'Cobrança Vinculada', saldo: 30809.97, ultimoLancamento: null },
    { clienteId: 895, contaCorrenteId: 2002, descricao: 'Conta Gráfica - Cobrança Vinculada', produto: 'Cobrança Vinculada', saldo: 4286.78, ultimoLancamento: null },
  ],
  responsaveis: [
    { clienteId: 548, papel: 'GERENTE', membroId: 1, nome: 'Gerente GF', email: 'gerente.gf@grupoeverblue.com.br', ativo: true },
    { clienteId: 548, papel: 'DIRETOR', membroId: 9, nome: 'Diretor', email: 'diretor@grupoeverblue.com.br', ativo: true },
    { clienteId: 895, papel: 'GERENTE', membroId: 2, nome: 'Gerente DDC', email: 'gerente.ddc@grupoeverblue.com.br', ativo: true },
    { clienteId: 895, papel: 'ASSISTENTE', membroId: 3, nome: 'Assistente', email: 'assistente@grupoeverblue.com.br', ativo: false },
    { clienteId: 895, papel: 'DIRETOR', membroId: 9, nome: 'Diretor', email: 'diretor@grupoeverblue.com.br', ativo: true },
  ],
}
