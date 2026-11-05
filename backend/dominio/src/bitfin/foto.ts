/**
 * Foto do Bitfin → posição semanal do Monitoramento (versão 1.2).
 *
 * Regras fechadas com o especialista do Monitoramento (documento
 * "bitfin-regras-fechadas" do projeto). Princípio: o valor vem do Bitfin,
 * não de fórmula de planilha; o que o Monitoramento calcula (liquidez de 60
 * a 180 dias, prazo médio, atraso médio) segue a fórmula conferida contra o
 * valor gravado pelo próprio Bitfin.
 *
 * Função pura: recebe as linhas lidas do Bitfin e devolve as linhas no
 * formato do MODELO de importação (cabeçalho + uma linha por cliente), que
 * passam pela MESMA validação, classificação e gravação da importação
 * semanal. Nada é persistido aqui.
 *
 * Fail-closed: dado ausente nunca vira zero favorável. Campo que o Bitfin não
 * entregou fica vazio ("não informado"); campo obrigatório ausente recusa a
 * linha na validação — e a foto inteira é recusada.
 */
import type { LinhaRestritivo } from '../regras/restritivos'
import { CAMPOS_IMPORTACAO, SEM_GERENTE, canonizarDocumento } from '../utils/planilhaImportacao'

/** Versão das regras/consultas da foto, gravada em cada execução. */
export const VERSAO_REGRAS_FOTO = '1.4.3'

// ---------------------------------------------------------------------------
// Produtos do Bitfin (tabela Produto, conferida em 29/10/2026)
// ---------------------------------------------------------------------------

export const PRODUTO = {
  FATURIZACAO: 1,
  COMISSARIA: 2,
  COBRANCA_SIMPLES: 5,
  CUSTODIA: 6,
  COBRANCA_VINCULADA: 7,
  RISCO_SACADO: 14,
  TRAVA_BANCARIA: 17,
  NOTA_COMERCIAL: 18,
  CONFISSAO_DE_DIVIDA: 20,
} as const

/** Produtos FORA do manifesto (o manifesto é da carteira de recebíveis). */
export const PRODUTOS_FORA_DO_MANIFESTO: ReadonlySet<number> = new Set([PRODUTO.NOTA_COMERCIAL, PRODUTO.CONFISSAO_DE_DIVIDA, PRODUTO.COBRANCA_SIMPLES])

/** Operações que entram no prazo médio (PMR): duplicata, cheque e contrato. */
export const PRODUTOS_DO_PRAZO_MEDIO: readonly number[] = [
  PRODUTO.FATURIZACAO,
  PRODUTO.COMISSARIA,
  PRODUTO.CUSTODIA,
  PRODUTO.COBRANCA_VINCULADA,
  PRODUTO.TRAVA_BANCARIA,
]

/** Quantas operações entram na média do prazo. */
export const OPERACOES_NO_PRAZO_MEDIO = 5

/** Janelas do índice de liquidez (dias). A de 30 é a gravada pelo Bitfin. */
export const JANELAS_LIQUIDEZ = [30, 60, 90, 120, 150, 180] as const
export type JanelaLiquidez = (typeof JANELAS_LIQUIDEZ)[number]

/** Tolerância da conferência "fórmula × valor gravado" (pontos percentuais). */
export const TOLERANCIA_LIQUIDEZ_PP = 0.01

// ---------------------------------------------------------------------------
// Dados brutos (uma estrutura por consulta ao Bitfin)
// ---------------------------------------------------------------------------

export type SituacaoBitfin = 'Monitoramento' | 'SaidaDeRisco' | 'RecuperacaoDeCredito' | 'Juridico'

export interface BitfinCliente {
  clienteId: number
  nome: string
  documento: string
  situacao: string
  grupoEconomicoId: number | null
  grupo: string | null
  cnaeSecao: string | null
  cnaeDenominacao: string | null
  risco: number
  riscoVencido: number
  /** Índice de liquidez de 30 dias gravado pelo Bitfin (%), `null` = sem base. */
  indiceLiquidez: number | null
  vencimentario: number | null
  liquidados: number | null
  recomprados: number | null
  dataInicialLiquidez: string | null
  dataFinalLiquidez: string | null
  dataApuracaoLiquidez: string | null
}

export type PapelResponsavel = 'GERENTE' | 'ASSISTENTE' | 'SUBGERENTE' | 'SUPERINTENDENTE' | 'DIRETOR'

export interface BitfinResponsavel {
  clienteId: number
  papel: PapelResponsavel
  membroId: number
  nome: string | null
  email: string | null
  ativo: boolean
}

export interface BitfinConta {
  clienteId: number
  contaOperacionalId: number
  contaCorrenteId: number | null
  produtoId: number
  produto: string
  unidade: string
  risco: number
  riscoVencido: number
  riscoVencidoPrimeiraData: string | null
  prorrogados: number
  semAtuacao: number
  emAndamento: number
  naoConcluida: number
  lastroInconsistente: number
  transacaoDesconhecida: number
  protestado: number
  concluida: number
  promessa: number
  ciencia: number
  naoConfirma: number
  inacessivel: number
  indiceLiquidez: number | null
  vencimentario: number | null
  liquidados: number | null
  recomprados: number | null
  penalizados: number | null
}

export interface BitfinProdutoCliente {
  clienteId: number
  produtoId: number
  produto: string
  limite: number
  tranche: number
  risco: number
}

/** Posição do produto no nível do GRUPO econômico (tela "Limites Operacionais"). */
export interface BitfinProdutoGrupo {
  grupoEconomicoId: number
  produtoId: number
  produto: string
  limite: number
  tranche: number
  risco: number
  concluida: number
}

export interface BitfinProposta {
  grupoEconomicoId: number
  propostaId: number
  totalLimites: number
  validade: string | null
  vigente: boolean
}

/** Títulos que venceram na janela, somados pelo Bitfin por cliente. */
export interface BitfinLiquidezJanela {
  clienteId: number
  janela: number
  /** Valor dos títulos liquidados (situação 1). */
  liquidado: number
  /** Valor de TODOS os títulos que venceram na janela (qualquer situação). */
  total: number
}

export interface BitfinOperacaoPrazo {
  clienteId: number
  /** 1 = Faturização/Comissária/Custódia/Cob. Vinculada/Trava; 2 = Nota Comercial. */
  grupo: 1 | 2
  ordem: number
  operacaoId: number
  data: string
  produto: string
  valorBase: number
  /** Prazo da operação: média dos títulos ponderada pelo valor (= tela de vencimentos). */
  prazo: number | null
}

/** Títulos liquidados na janela de 30 dias da liquidez. */
export interface BitfinAtraso {
  clienteId: number
  valor: number
  /** Σ valor × dias de atraso (pago em dia ou antes = 0). */
  valorVezesDias: number
}

export interface BitfinPontualidade {
  documento: string
  ano: number
  mes: number
  emDia: number
  esperado: number
  pontual: number
  de8a15: number
  de16a30: number
  de31a60: number
  acima60: number
  recomprado: number
}

export interface BitfinAging {
  documento: string
  vencer: { ate30: number; de31a60: number; de61a90: number; de91a180: number; de181a360: number; acima360: number }
  vencido: { de6a30: number; de31a60: number; de61a90: number; de91a180: number; de181a360: number; acima360: number }
}

export interface BitfinEvento {
  clienteId: number
  eventoId: number
  titulo: string
  categoria: string | null
  nivel: number | null
  desfecho: number | null
  dataCadastro: string
  dataAtualizacao: string | null
  criadoPor: string | null
  ocorrencias: { data: string; autor: string | null; categoria: string | null; mensagem: string | null }[]
}

export interface BitfinOperacoesMes {
  clienteId: number
  mesAnterior: number
  mesAtual: number
}

export interface DadosFotoBitfin {
  /** Momento da leitura (ISO, UTC). */
  lidoEm: string
  clientes: BitfinCliente[]
  responsaveis: BitfinResponsavel[]
  contas: BitfinConta[]
  produtos: BitfinProdutoCliente[]
  produtosGrupo: BitfinProdutoGrupo[]
  propostas: BitfinProposta[]
  liquidez: BitfinLiquidezJanela[]
  operacoesPrazo: BitfinOperacaoPrazo[]
  atrasos: BitfinAtraso[]
  pontualidade: BitfinPontualidade[]
  aging: BitfinAging[]
  eventos: BitfinEvento[]
  operacoesMes: BitfinOperacoesMes[]
}

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

export interface DivergenciaFoto {
  clienteId: number
  nome: string
  campo: string
  mensagem: string
}

export interface PrazoMedioFoto {
  origem: 'DUPLICATA' | 'NOTA_COMERCIAL' | 'SEM_OPERACAO'
  dias: number | null
  operacoesUsadas: number
  ultimaOperacao: string | null
  operacoes: { operacaoId: number; data: string; produto: string; valorBase: number; prazo: number | null }[]
}

export interface ManifestoContaFoto {
  contaOperacionalId: number
  produto: string
  noManifesto: boolean
  risco: number
  concluida: number
  semAtuacao: number
  emAndamento: number
  naoConcluida: number
  lastroInconsistente: number
  transacaoDesconhecida: number
  ciencia: number
  naoConfirma: number
  inacessivel: number
  protestado: number
  promessa: number
}

/** Detalhe gravado com a foto (telas, Mapa de Garantias, comparação). */
export interface DetalheClienteFoto {
  bitfinClienteId: number
  documento: string
  nome: string
  situacao: SituacaoBitfin
  grupoEconomicoId: number | null
  responsaveis: BitfinResponsavel[]
  limite: {
    total: number
    origem: 'PROPOSTA' | 'PRODUTOS' | 'SEM_LIMITE'
    propostaId: number | null
    validade: string | null
    porProduto: { produto: string; limite: number; tranche: number; risco: number }[]
  }
  tranche: { tranche: number; emAndamento: number; consumoPerc: number | null; porProduto: { produto: string; tranche: number; risco: number; concluida: number }[] }
  riscoPorProduto: { produto: string; risco: number }[]
  liquidez: {
    apuradoEm: string | null
    janelaInicio: string | null
    janelaFim: string | null
    bitfin30: number | null
    calculado: Partial<Record<JanelaLiquidez, number | null>>
    conferencia30: 'CONFERE' | 'DIVERGE' | 'SEM_BASE'
  }
  prazoMedio: PrazoMedioFoto
  atrasoMedio: { dias: number | null; valorLiquidado: number }
  pontualidade: { ano: number; mes: number; percPontual: number | null; percAtraso: number | null } | null
  aging: BitfinAging | null
  manifesto: { baseRisco: number; percSemAtuacao: number | null; contas: ManifestoContaFoto[] }
  eventos: BitfinEvento[]
}

export interface ResultadoFoto {
  /** Cabeçalho + uma linha por cliente, no formato do modelo de importação. */
  linhas: unknown[][]
  detalhes: DetalheClienteFoto[]
  divergencias: DivergenciaFoto[]
  /** Motivos que impedem a foto (fail-closed: a foto inteira é recusada). */
  recusas: string[]
  totais: { clientes: number; risco: number; vencido: number; eventos: number }
}

export interface OpcoesFoto {
  /** Data local da foto (yyyy-MM-dd, America/Sao_Paulo). Padrão: calculada de `lidoEm`. */
  hoje?: string
  /** Restritivos continuam manuais: quantidade da última posição gravada, por documento (só dígitos). */
  restritivosAnteriores?: Map<string, number>
}

// ---------------------------------------------------------------------------
// Auxiliares puros
// ---------------------------------------------------------------------------

const SITUACAO_PARA_STATUS: Record<SituacaoBitfin, string> = {
  Monitoramento: 'MONITORAMENTO',
  SaidaDeRisco: 'SAIDA_DE_RISCO',
  RecuperacaoDeCredito: 'RECUPERACAO_DE_CREDITO',
  Juridico: 'JURIDICO',
}

export function situacaoValida(s: string): s is SituacaoBitfin {
  return Object.prototype.hasOwnProperty.call(SITUACAO_PARA_STATUS, s)
}

/** Seções da CNAE 2.0 (IBGE). O Bitfin guarda a letra da seção. */
const SECOES_CNAE: Record<string, string> = {
  A: 'Agricultura, pecuária, produção florestal, pesca e aquicultura',
  B: 'Indústrias extrativas',
  C: 'Indústrias de transformação',
  D: 'Eletricidade e gás',
  E: 'Água, esgoto, gestão de resíduos e descontaminação',
  F: 'Construção',
  G: 'Comércio; reparação de veículos automotores e motocicletas',
  H: 'Transporte, armazenagem e correio',
  I: 'Alojamento e alimentação',
  J: 'Informação e comunicação',
  K: 'Atividades financeiras, de seguros e serviços relacionados',
  L: 'Atividades imobiliárias',
  M: 'Atividades profissionais, científicas e técnicas',
  N: 'Atividades administrativas e serviços complementares',
  O: 'Administração pública, defesa e seguridade social',
  P: 'Educação',
  Q: 'Saúde humana e serviços sociais',
  R: 'Artes, cultura, esporte e recreação',
  S: 'Outras atividades de serviços',
  T: 'Serviços domésticos',
  U: 'Organismos internacionais e outras instituições extraterritoriais',
}

export function nomeSecaoCnae(secao: string | null): string {
  const s = (secao ?? '').trim()
  if (!s) return 'Não informado'
  return SECOES_CNAE[s.toUpperCase()] ?? s
}

const centavos = (v: number) => Math.round(v * 100) / 100
const duasCasas = (v: number) => Math.round(v * 100) / 100
const soma = (vs: number[]) => vs.reduce((a, b) => a + b, 0)
const somenteDigitos = (d: string) => {
  let x = d.replace(/\D/g, '')
  if (x.length === 15 && x.startsWith('0')) x = x.slice(1)
  return x
}
const dataIso = (d: string | null | undefined) => (d ? String(d).slice(0, 10) : null)
const paraBr = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '')

/** Prazo médio: média SIMPLES das 5 últimas operações, cada uma com o prazo
 * ponderado pelos títulos. Duplicata (Fat./Comissária/Custódia/Cob. Vinc./Trava)
 * primeiro; sem nenhuma, Nota Comercial; sem nenhuma das duas, sem operação. */
export function calcularPrazoMedio(operacoes: BitfinOperacaoPrazo[]): PrazoMedioFoto {
  const porGrupo = (g: 1 | 2) =>
    operacoes
      .filter((o) => o.grupo === g)
      .sort((a, b) => a.ordem - b.ordem)
      .slice(0, OPERACOES_NO_PRAZO_MEDIO)
  let usadas = porGrupo(1)
  let origem: PrazoMedioFoto['origem'] = 'DUPLICATA'
  if (usadas.length === 0) {
    usadas = porGrupo(2)
    origem = 'NOTA_COMERCIAL'
  }
  if (usadas.length === 0) return { origem: 'SEM_OPERACAO', dias: null, operacoesUsadas: 0, ultimaOperacao: null, operacoes: [] }
  const comPrazo = usadas.filter((o) => o.prazo !== null && Number.isFinite(o.prazo))
  const dias = comPrazo.length === usadas.length ? duasCasas(soma(comPrazo.map((o) => o.prazo!)) / comPrazo.length) : null
  return {
    origem,
    dias,
    operacoesUsadas: usadas.length,
    ultimaOperacao: dataIso(usadas[0].data),
    operacoes: usadas.map((o) => ({ operacaoId: o.operacaoId, data: dataIso(o.data)!, produto: o.produto, valorBase: o.valorBase, prazo: o.prazo })),
  }
}

/** IL = liquidado ÷ todos os títulos que venceram na janela, em %. `null` = sem base. */
export function indiceLiquidez(liquidado: number, total: number): number | null {
  if (!(total > 0)) return null
  return duasCasas((liquidado / total) * 100)
}

export function statusDaProposta(proposta: BitfinProposta | undefined, hojeIso: string): 'APROVADA' | 'VENCIDA' | 'SEM_PROPOSTA' {
  if (!proposta || !proposta.vigente) return 'SEM_PROPOSTA'
  const validade = dataIso(proposta.validade)
  if (validade && validade < hojeIso) return 'VENCIDA'
  return 'APROVADA'
}

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------

const COLUNA = Object.fromEntries(CAMPOS_IMPORTACAO.map((c) => [c.chave, c.coluna])) as Record<string, string>

/** Data local de São Paulo (yyyy-MM-dd) de um instante ISO. */
export function dataSaoPaulo(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}

export function montarFoto(dados: DadosFotoBitfin, opcoes: OpcoesFoto = {}): ResultadoFoto {
  const hoje = opcoes.hoje ?? dataSaoPaulo(dados.lidoEm)
  const recusas: string[] = []
  const divergencias: DivergenciaFoto[] = []
  const detalhes: DetalheClienteFoto[] = []

  const agrupar = <T, K>(itens: T[], chave: (t: T) => K) => {
    const m = new Map<K, T[]>()
    for (const i of itens) {
      const k = chave(i)
      const l = m.get(k)
      if (l) l.push(i)
      else m.set(k, [i])
    }
    return m
  }
  const contasPorCliente = agrupar(dados.contas, (c) => c.clienteId)
  const produtosPorCliente = agrupar(dados.produtos, (p) => p.clienteId)
  const produtosPorGrupo = agrupar(dados.produtosGrupo, (p) => p.grupoEconomicoId)
  const responsaveisPorCliente = agrupar(dados.responsaveis, (r) => r.clienteId)
  const liquidezPorCliente = agrupar(dados.liquidez, (l) => l.clienteId)
  const prazoPorCliente = agrupar(dados.operacoesPrazo, (o) => o.clienteId)
  const eventosPorCliente = agrupar(dados.eventos, (e) => e.clienteId)
  const propostaPorGrupo = new Map(dados.propostas.filter((p) => p.vigente).map((p) => [p.grupoEconomicoId, p]))
  const atrasoPorCliente = new Map(dados.atrasos.map((a) => [a.clienteId, a]))
  const operacoesMes = new Map(dados.operacoesMes.map((o) => [o.clienteId, o]))
  const agingPorDoc = new Map(dados.aging.map((a) => [somenteDigitos(a.documento), a]))
  const pontualidadePorDoc = agrupar(dados.pontualidade, (p) => somenteDigitos(p.documento))

  // Apuração da liquidez do Bitfin de dia anterior (rotina das 07:00 não rodou
  // ou foto tirada antes dela): os números valem, mas ficam marcados.
  const apuracoes = dados.clientes.map((c) => dataIso(c.dataApuracaoLiquidez)).filter((d): d is string => d !== null).sort()
  const ultimaApuracao = apuracoes.at(-1) ?? null
  if (ultimaApuracao && ultimaApuracao < hoje) {
    divergencias.push({ clienteId: 0, nome: 'Bitfin', campo: 'Apuração da liquidez', mensagem: `A última apuração da liquidez no Bitfin é de ${paraBr(ultimaApuracao)}, anterior ao dia da foto (${paraBr(hoje)}).` })
  }
  if (dados.clientes.length === 0) recusas.push('O Bitfin não devolveu nenhum cliente em Monitoramento, Saída de Risco, Recuperação de Crédito ou Jurídico com risco.')

  const cabecalho = CAMPOS_IMPORTACAO.map((c) => c.coluna)
  const linhas: unknown[][] = [cabecalho]
  // O mês fechado mais recente da pontualidade (o mês corrente ainda está aberto).
  const [anoHoje, mesHoje] = hoje.split('-').map(Number)
  const ultimoMesFechado = mesHoje === 1 ? { ano: anoHoje - 1, mes: 12 } : { ano: anoHoje, mes: mesHoje - 1 }

  for (const c of dados.clientes) {
    const div = (campo: string, mensagem: string) => divergencias.push({ clienteId: c.clienteId, nome: c.nome, campo, mensagem })
    if (!situacaoValida(c.situacao)) {
      recusas.push(`${c.nome}: situação "${c.situacao}" desconhecida no Bitfin.`)
      continue
    }
    const docDigitos = somenteDigitos(c.documento)
    if (docDigitos.length !== 14 && docDigitos.length !== 11) {
      recusas.push(`${c.nome}: documento "${c.documento}" não é CNPJ nem CPF.`)
      continue
    }
    const documento = canonizarDocumento(docDigitos)
    const contas = contasPorCliente.get(c.clienteId) ?? []
    const produtos = produtosPorCliente.get(c.clienteId) ?? []
    const responsaveis = responsaveisPorCliente.get(c.clienteId) ?? []

    // Risco e vencido (regra 10: todos os vencidos).
    const somaContas = centavos(soma(contas.map((x) => x.risco)))
    if (Math.abs(somaContas - centavos(c.risco)) > 0.01) {
      div('Risco', `Risco do cliente R$ ${centavos(c.risco)} difere da soma das contas R$ ${somaContas}.`)
    }
    const vencidoDesde = contas
      .filter((x) => x.riscoVencido > 0 && x.riscoVencidoPrimeiraData)
      .map((x) => dataIso(x.riscoVencidoPrimeiraData)!)
      .sort()[0] ?? null
    if (c.riscoVencido > 0 && !vencidoDesde) div('Vencido desde', 'Há vencido, mas o Bitfin não informou a data do vencimento mais antigo.')

    // Limite: proposta vigente do grupo; sem proposta, soma dos limites por produto.
    const proposta = c.grupoEconomicoId !== null ? propostaPorGrupo.get(c.grupoEconomicoId) : undefined
    const somaLimites = centavos(soma(produtos.map((p) => p.limite)))
    const limiteTotal = proposta ? centavos(proposta.totalLimites) : somaLimites
    const statusProposta = statusDaProposta(proposta, hoje)

    // Tranche e em andamento (regra 1): grupo econômico, produtos com tranche.
    // Sem grupo econômico no Bitfin: tranche e concluída do próprio cliente.
    const doGrupo: BitfinProdutoGrupo[] =
      c.grupoEconomicoId !== null
        ? (produtosPorGrupo.get(c.grupoEconomicoId) ?? [])
        : produtos.map((p) => ({
            grupoEconomicoId: 0,
            produtoId: p.produtoId,
            produto: p.produto,
            limite: p.limite,
            tranche: p.tranche,
            risco: p.risco,
            concluida: soma(contas.filter((x) => x.produtoId === p.produtoId).map((x) => x.concluida)),
          }))
    if (c.grupoEconomicoId === null) div('Grupo econômico', 'Cliente sem grupo econômico no Bitfin: tranche e em andamento calculados pelo próprio cliente.')
    const comTranche = doGrupo.filter((p) => p.tranche > 0)
    const tranche = centavos(soma(comTranche.map((p) => p.tranche)))
    const emAndamento = centavos(soma(comTranche.map((p) => p.risco - p.concluida)))

    // Liquidez: 30 dias = Bitfin; 60 a 180 pela mesma fórmula, conferida na de 30.
    const janelas = new Map((liquidezPorCliente.get(c.clienteId) ?? []).map((l) => [l.janela, l]))
    const calculado: Partial<Record<JanelaLiquidez, number | null>> = {}
    for (const n of JANELAS_LIQUIDEZ) {
      const j = janelas.get(n)
      calculado[n] = j ? indiceLiquidez(j.liquidado, j.total) : null
    }
    const bitfin30 = c.indiceLiquidez === null || c.indiceLiquidez === undefined ? null : duasCasas(Number(c.indiceLiquidez))
    let conferencia30: DetalheClienteFoto['liquidez']['conferencia30'] = 'SEM_BASE'
    if (bitfin30 !== null) {
      const calc30 = calculado[30] ?? null
      if (calc30 !== null && Math.abs(calc30 - bitfin30) <= TOLERANCIA_LIQUIDEZ_PP) conferencia30 = 'CONFERE'
      else {
        conferencia30 = 'DIVERGE'
        div('Índice de liquidez', `IL 30 dias do Bitfin ${bitfin30}% × recálculo pelos títulos ${calc30 ?? 'sem base'}%. As janelas de 60 a 180 dias ficam "não informado" até a divergência ser explicada.`)
      }
    }
    const il = (n: JanelaLiquidez): number | null => {
      if (n === 30) return bitfin30
      if (conferencia30 !== 'CONFERE') return null
      return calculado[n] ?? null
    }

    // Prazo médio, atraso médio e pontualidade.
    const prazoMedio = calcularPrazoMedio(prazoPorCliente.get(c.clienteId) ?? [])
    const atraso = atrasoPorCliente.get(c.clienteId)
    // Sem título liquidado na janela: "não informado", nunca 0 dias.
    const atrasoMedio = atraso && atraso.valor > 0 ? duasCasas(atraso.valorVezesDias / atraso.valor) : null
    // A view pode ter mais de uma linha por cedente e mês (CNPJ_ORIGEM): soma.
    const doMes = (pontualidadePorDoc.get(docDigitos) ?? []).filter((p) => p.ano === ultimoMesFechado.ano && p.mes === ultimoMesFechado.mes)
    const pont: BitfinPontualidade | undefined = doMes.length
      ? doMes.reduce((a, b) => ({ ...a, emDia: a.emDia + b.emDia, esperado: a.esperado + b.esperado, pontual: a.pontual + b.pontual, de8a15: a.de8a15 + b.de8a15, de16a30: a.de16a30 + b.de16a30, de31a60: a.de31a60 + b.de31a60, acima60: a.acima60 + b.acima60, recomprado: a.recomprado + b.recomprado }))
      : undefined
    const percPontual = pont && pont.esperado > 0 ? duasCasas((pont.pontual / pont.esperado) * 100) : null
    const percAtraso = pont && pont.esperado > 0 ? duasCasas(((pont.de8a15 + pont.de16a30 + pont.de31a60 + pont.acima60) / pont.esperado) * 100) : null

    // Manifesto: sem Nota Comercial, Confissão de Dívida e Cobrança Simples.
    const contasManifesto = contas.filter((x) => !PRODUTOS_FORA_DO_MANIFESTO.has(x.produtoId))
    const sm = (f: (x: BitfinConta) => number) => centavos(soma(contasManifesto.map(f)))
    const baseManifesto = sm((x) => x.risco)
    const semAtuacao = sm((x) => x.semAtuacao)
    // Sem carteira manifestada (só NC/Confissão/Cobrança Simples): "não informado".
    const percSemAtuacao = baseManifesto > 0 ? duasCasas((semAtuacao / baseManifesto) * 100) : null

    // Plataforma = unidade administrativa da conta de maior risco.
    const contaPrincipal = [...contas].sort((a, b) => b.risco - a.risco)[0]
    const plataforma = contaPrincipal?.unidade?.trim() || 'Sem plataforma'
    const gerente = responsaveis.find((r) => r.papel === 'GERENTE')?.nome?.trim() || SEM_GERENTE
    const comRisco = produtos.filter((p) => p.risco > 0).sort((a, b) => b.risco - a.risco)
    const nomesProdutos = (comRisco.length > 0 ? comRisco.map((p) => p.produto) : [...new Set(contas.map((x) => x.produto))]).join('; ')
    const opsMes = operacoesMes.get(c.clienteId)
    const restritivos = opcoes.restritivosAnteriores?.get(docDigitos) ?? 0

    const valores: Record<string, unknown> = {
      nome: c.nome.trim(),
      documentos: documento,
      carteira: '',
      grupoEconomico: c.grupo?.trim() || `Grupo ${c.nome.trim()}`,
      gerente,
      plataforma,
      setor: nomeSecaoCnae(c.cnaeSecao),
      ramoAtividade: c.cnaeDenominacao?.trim() || 'Não informado',
      produtos: nomesProdutos,
      status: SITUACAO_PARA_STATUS[c.situacao],
      riscoCliente: centavos(c.risco),
      limiteGlobal: limiteTotal,
      statusProposta,
      validadeProposta: proposta ? paraBr(dataIso(proposta.validade)) : '',
      trancheConsolidada: tranche,
      valorEmAndamento: emAndamento,
      vencidoOficial: centavos(c.riscoVencido),
      vencidoDesde: paraBr(vencidoDesde),
      // Derivado do "Vencido desde" na validação (mesma regra da base do comitê).
      agingCarteiraDias: 0,
      prazoMedioCarteiraDias: prazoMedio.dias ?? '',
      il30: il(30) ?? '',
      il60: il(60) ?? '',
      il90: il(90) ?? '',
      il120: il(120) ?? '',
      il150: il(150) ?? '',
      il180: il(180) ?? '',
      manifestoPercSemAtuacao: percSemAtuacao ?? '',
      manifestoInacessivel: sm((x) => x.inacessivel),
      manifestoNaoConfirma: sm((x) => x.naoConfirma),
      manifestoTransacaoDesconhecida: sm((x) => x.transacaoDesconhecida),
      manifestoLastroInconsistente: sm((x) => x.lastroInconsistente),
      manifestoTransacaoNaoConcluida: sm((x) => x.naoConcluida),
      liquidadoNoPeriodo: c.liquidados === null ? '' : centavos(c.liquidados),
      recompras: centavos(c.recomprados ?? 0),
      motivoRecompra: '',
      percLiquidadoNoPrazo: percPontual ?? '',
      atrasoMedioDias: atrasoMedio ?? '',
      restritivos,
      prorrogacoesAcima60d: '',
      operacoesMesAnterior: opsMes ? centavos(opsMes.mesAnterior) : '',
      operacoesMes: opsMes ? centavos(opsMes.mesAtual) : '',
    }
    // Sem pontualidade do mês fechado (nenhum título esperado): "não informado", nunca 0%.
    if (percPontual === null) div('% liquidado no prazo', `Sem pontualidade do mês ${String(ultimoMesFechado.mes).padStart(2, '0')}/${ultimoMesFechado.ano} no Bitfin: "não informado".`)
    if (prazoMedio.origem === 'SEM_OPERACAO') div('Prazo médio', 'Sem operação de duplicata, cheque, contrato ou Nota Comercial: prazo médio "sem operação".')

    linhas.push(cabecalho.map((coluna) => {
      const chave = Object.keys(COLUNA).find((k) => COLUNA[k] === coluna)
      return chave && chave in valores ? valores[chave] : ''
    }))

    detalhes.push({
      bitfinClienteId: c.clienteId,
      documento,
      nome: c.nome.trim(),
      situacao: c.situacao,
      grupoEconomicoId: c.grupoEconomicoId,
      responsaveis,
      limite: {
        total: limiteTotal,
        origem: proposta ? 'PROPOSTA' : somaLimites > 0 ? 'PRODUTOS' : 'SEM_LIMITE',
        propostaId: proposta?.propostaId ?? null,
        validade: dataIso(proposta?.validade),
        porProduto: produtos.filter((p) => p.limite > 0 || p.risco > 0).map((p) => ({ produto: p.produto, limite: centavos(p.limite), tranche: centavos(p.tranche), risco: centavos(p.risco) })),
      },
      tranche: {
        tranche,
        emAndamento,
        consumoPerc: tranche > 0 ? duasCasas((emAndamento / tranche) * 100) : null,
        porProduto: comTranche.map((p) => ({ produto: p.produto, tranche: centavos(p.tranche), risco: centavos(p.risco), concluida: centavos(p.concluida) })),
      },
      riscoPorProduto: comRisco.map((p) => ({ produto: p.produto, risco: centavos(p.risco) })),
      liquidez: {
        apuradoEm: c.dataApuracaoLiquidez,
        janelaInicio: dataIso(c.dataInicialLiquidez),
        janelaFim: dataIso(c.dataFinalLiquidez),
        bitfin30,
        calculado,
        conferencia30,
      },
      prazoMedio,
      atrasoMedio: { dias: atrasoMedio, valorLiquidado: centavos(atraso?.valor ?? 0) },
      pontualidade: pont ? { ano: pont.ano, mes: pont.mes, percPontual, percAtraso } : null,
      aging: agingPorDoc.get(docDigitos) ?? null,
      manifesto: {
        baseRisco: baseManifesto,
        percSemAtuacao,
        contas: contas.map((x) => ({
          contaOperacionalId: x.contaOperacionalId,
          produto: x.produto,
          noManifesto: !PRODUTOS_FORA_DO_MANIFESTO.has(x.produtoId),
          risco: centavos(x.risco),
          concluida: centavos(x.concluida),
          semAtuacao: centavos(x.semAtuacao),
          emAndamento: centavos(x.emAndamento),
          naoConcluida: centavos(x.naoConcluida),
          lastroInconsistente: centavos(x.lastroInconsistente),
          transacaoDesconhecida: centavos(x.transacaoDesconhecida),
          ciencia: centavos(x.ciencia),
          naoConfirma: centavos(x.naoConfirma),
          inacessivel: centavos(x.inacessivel),
          protestado: centavos(x.protestado),
          promessa: centavos(x.promessa),
        })),
      },
      eventos: (eventosPorCliente.get(c.clienteId) ?? []).sort((a, b) => b.dataCadastro.localeCompare(a.dataCadastro)),
    })
  }

  return {
    linhas,
    detalhes,
    divergencias,
    recusas,
    totais: {
      clientes: detalhes.length,
      risco: centavos(soma(dados.clientes.map((c) => c.risco))),
      vencido: centavos(soma(dados.clientes.map((c) => c.riscoVencido))),
      eventos: dados.eventos.length,
    },
  }
}

/** Manifesto conferido: risco = concluída + demais categorias (prova da A05). */
export function conferirManifesto(conta: BitfinConta): boolean {
  const partes =
    conta.concluida +
    conta.semAtuacao +
    conta.emAndamento +
    conta.naoConcluida +
    conta.lastroInconsistente +
    conta.transacaoDesconhecida +
    conta.ciencia +
    conta.naoConfirma +
    conta.inacessivel +
    conta.protestado +
    conta.promessa
  return Math.abs(centavos(partes) - centavos(conta.risco)) <= 0.01
}

export type { LinhaRestritivo }
