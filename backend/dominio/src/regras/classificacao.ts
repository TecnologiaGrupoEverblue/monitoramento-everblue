/**
 * Classificação semanal do cliente — prioridade, enquadramento, criticidade,
 * tendência da liquidez e alertas, pelas MESMAS regras da base do comitê
 * ("Base Carteira — Monitoramento", aba Análise da Carteira, quadro "Regras de
 * alerta" do Dashboard). Os limiares vêm de `RegraClassificacao` (tela de
 * Cadastros e Configurações), nunca fixos no código; os valores iniciais
 * reproduzem a base.
 *
 * Unidade de análise: como na base, o grupo econômico consolidado — os
 * percentuais usam o risco consolidado do grupo (`riscoGrupo`) e, sem grupo,
 * o risco do próprio cliente.
 *
 * Função pura: recebe as posições e devolve a classificação. Quem grava é a
 * API, na confirmação da importação.
 */
import type { SnapshotSemanal, StatusCliente } from '../models/types'
import { compararRestritivos, descreverVariacao, type LinhaRestritivo } from './restritivos'
import { formatarMilhoes, LIMITE_MILHOES } from '../utils/formatters'

export type NivelAlertaClassificacao = 'CRITICO' | 'ATENCAO'
export type EnquadramentoCliente = 'ENQUADRADO' | 'DESENQUADRADO' | 'APARTADO'
export type CriticidadeClassificada = 'CRITICO' | 'ATENCAO' | 'REGULAR' | 'APARTADO'
export type TendenciaLiquidez = 'ESTAVEL' | 'SEM_BASE' | 'QUEDA_SIGNIFICATIVA' | 'QUEDA_CONTINUA'
export type PrioridadeOrdem = 1 | 2 | 3 | 4 | 9

export const ROTULO_PRIORIDADE_ORDEM: Record<PrioridadeOrdem, string> = {
  1: '1 - Jurídico',
  2: '2 - Saída de Risco',
  3: '3 - Monitoramento',
  4: '4 - Normal',
  9: '9 - Carteira apartada',
}
export const ROTULO_ENQUADRAMENTO: Record<EnquadramentoCliente, string> = { ENQUADRADO: 'Enquadrado', DESENQUADRADO: 'Desenquadrado', APARTADO: 'Apartado' }
export const ROTULO_CRITICIDADE_CLASSIFICADA: Record<CriticidadeClassificada, string> = { CRITICO: 'Crítico', ATENCAO: 'Atenção', REGULAR: 'Regular', APARTADO: 'Apartado' }
export const ROTULO_TENDENCIA: Record<TendenciaLiquidez, string> = {
  ESTAVEL: 'Estável / sem queda relevante',
  SEM_BASE: 'Sem base',
  QUEDA_SIGNIFICATIVA: 'Queda significativa',
  QUEDA_CONTINUA: 'Queda contínua',
}

export interface AlertaClassificacao {
  nivel: NivelAlertaClassificacao
  regra: string
  texto: string
}

export interface ClassificacaoCliente {
  prioridadeOrdem: PrioridadeOrdem
  enquadramento: EnquadramentoCliente
  motivosEnquadramento: string[]
  criticidade: CriticidadeClassificada
  tendenciaLiquidez: TendenciaLiquidez
  alertas: AlertaClassificacao[]
  qtdAlertas: number
  /** Regras que não puderam ser avaliadas por falta do dado. Ausência de
   * alerta nelas NÃO significa situação regular. */
  naoAvaliados: string[]
}

export interface ClassificacaoSemanal extends ClassificacaoCliente {
  clienteId: string
  semanaRef: string
  calculadoEm: string
}

// ------------------------------------------------------------------ limiares

export type ChaveRegra =
  | 'VENCIDO_CRITICO_PERC'
  | 'VENCIDO_CRITICO_VALOR'
  | 'MANIFESTO_CRITICO_PERC'
  | 'MANIFESTO_CRITICO_VALOR'
  | 'LASTRO_CRITICO_VALOR'
  | 'RISCO_ATENCAO_PERC'
  | 'RISCO_ATENCAO_VALOR'
  | 'RISCO_CRITICO_PERC'
  | 'RISCO_CRITICO_VALOR'
  | 'IL30_CRITICO'
  | 'IL30_ATENCAO'
  | 'QUEDA_LIQUIDEZ_PP'
  | 'PRORROGACAO_CRITICO_VALOR'
  | 'PRORROGACAO_CRITICO_PERC'
  | 'QUEDA_OPERACOES_PERC'
  | 'LIMITE_DESENQUADRAMENTO_PERC'
  | 'AVISO_SALTO_RISCO_PERC'
  | 'AVISO_VALOR_SIMBOLICO'

export interface RegraClassificacao {
  chave: ChaveRegra
  grupo: string
  descricao: string
  valor: number
  unidade: '%' | 'R$' | 'p.p.'
  ordem: number
}

export const REGRAS_CLASSIFICACAO_PADRAO: RegraClassificacao[] = [
  { chave: 'VENCIDO_CRITICO_PERC', grupo: 'Vencido', descricao: 'Vencido crítico a partir de (% do risco)', valor: 30, unidade: '%', ordem: 10 },
  { chave: 'VENCIDO_CRITICO_VALOR', grupo: 'Vencido', descricao: 'Vencido crítico a partir de (valor)', valor: 1_000_000, unidade: 'R$', ordem: 11 },
  { chave: 'MANIFESTO_CRITICO_PERC', grupo: 'Manifestos', descricao: 'Manifesto crítico a partir de (% do risco)', valor: 5, unidade: '%', ordem: 20 },
  { chave: 'MANIFESTO_CRITICO_VALOR', grupo: 'Manifestos', descricao: 'Manifesto crítico a partir de (valor)', valor: 100_000, unidade: 'R$', ordem: 21 },
  { chave: 'LASTRO_CRITICO_VALOR', grupo: 'Manifestos', descricao: 'Lastro inconsistente crítico a partir de (valor)', valor: 15_000, unidade: 'R$', ordem: 22 },
  { chave: 'RISCO_ATENCAO_PERC', grupo: 'Variação de risco', descricao: 'Aumento de risco em atenção a partir de (%)', valor: 15, unidade: '%', ordem: 30 },
  { chave: 'RISCO_ATENCAO_VALOR', grupo: 'Variação de risco', descricao: 'Aumento de risco em atenção a partir de (valor)', valor: 250_000, unidade: 'R$', ordem: 31 },
  { chave: 'RISCO_CRITICO_PERC', grupo: 'Variação de risco', descricao: 'Aumento de risco crítico a partir de (%)', valor: 30, unidade: '%', ordem: 32 },
  { chave: 'RISCO_CRITICO_VALOR', grupo: 'Variação de risco', descricao: 'Aumento de risco crítico a partir de (valor)', valor: 1_000_000, unidade: 'R$', ordem: 33 },
  { chave: 'IL30_CRITICO', grupo: 'Liquidez', descricao: 'IL 30 dias crítico abaixo de', valor: 50, unidade: '%', ordem: 40 },
  { chave: 'IL30_ATENCAO', grupo: 'Liquidez', descricao: 'IL 30 dias em atenção abaixo de', valor: 70, unidade: '%', ordem: 41 },
  { chave: 'QUEDA_LIQUIDEZ_PP', grupo: 'Liquidez', descricao: 'Queda significativa entre IL 60 e IL 30 acima de', valor: 15, unidade: 'p.p.', ordem: 42 },
  { chave: 'PRORROGACAO_CRITICO_VALOR', grupo: 'Prorrogações', descricao: 'Prorrogações acima de 60d críticas a partir de (valor)', valor: 1_000_000, unidade: 'R$', ordem: 50 },
  { chave: 'PRORROGACAO_CRITICO_PERC', grupo: 'Prorrogações', descricao: '… e a partir de (% do risco)', valor: 30, unidade: '%', ordem: 51 },
  { chave: 'QUEDA_OPERACOES_PERC', grupo: 'Operações', descricao: 'Queda nas operações frente ao mês anterior a partir de', valor: 50, unidade: '%', ordem: 55 },
  { chave: 'LIMITE_DESENQUADRAMENTO_PERC', grupo: 'Enquadramento', descricao: 'Desenquadrado com consumo do limite a partir de', valor: 95, unidade: '%', ordem: 60 },
  { chave: 'AVISO_SALTO_RISCO_PERC', grupo: 'Qualidade da importação', descricao: 'Avisar salto de risco frente à semana anterior acima de', valor: 50, unidade: '%', ordem: 70 },
  { chave: 'AVISO_VALOR_SIMBOLICO', grupo: 'Qualidade da importação', descricao: 'Tranche ou limite considerado simbólico até', valor: 1_000, unidade: 'R$', ordem: 71 },
]

export type LimiaresClassificacao = Record<ChaveRegra, number>

const TETO_POR_UNIDADE: Record<RegraClassificacao['unidade'], number> = { '%': 1000, 'p.p.': 100, 'R$': 1e13 }
const ATE_100: ChaveRegra[] = ['VENCIDO_CRITICO_PERC', 'MANIFESTO_CRITICO_PERC', 'IL30_CRITICO', 'IL30_ATENCAO', 'PRORROGACAO_CRITICO_PERC', 'QUEDA_OPERACOES_PERC']
/** Pares que precisam manter a ordem (menor, maior) para a regra fazer sentido. */
const ORDEM: [ChaveRegra, ChaveRegra, string][] = [
  ['IL30_CRITICO', 'IL30_ATENCAO', 'O IL 30 crítico precisa ser menor ou igual ao de atenção.'],
  ['RISCO_ATENCAO_PERC', 'RISCO_CRITICO_PERC', 'O % de aumento de risco em atenção precisa ser menor ou igual ao crítico.'],
  ['RISCO_ATENCAO_VALOR', 'RISCO_CRITICO_VALOR', 'O valor de aumento de risco em atenção precisa ser menor ou igual ao crítico.'],
]

/** Validação semântica de um novo limiar frente aos demais (servidor). Devolve
 * a mensagem do problema ou `null` quando o valor é aceitável. */
export function validarNovoLimiar(chave: ChaveRegra, valor: number, atuais: Pick<RegraClassificacao, 'chave' | 'valor'>[]): string | null {
  const regra = REGRAS_CLASSIFICACAO_PADRAO.find((r) => r.chave === chave)
  if (!regra) return 'Regra desconhecida.'
  if (!Number.isFinite(valor) || valor < 0) return 'Informe um número maior ou igual a zero.'
  const teto = ATE_100.includes(chave) ? 100 : TETO_POR_UNIDADE[regra.unidade]
  if (valor > teto) {
    const t = teto.toLocaleString('pt-BR')
    return `O valor máximo para esta regra é ${regra.unidade === 'R$' ? reais(teto) : regra.unidade === '%' ? `${t}%` : `${t} p.p.`}.`
  }
  const lim = { ...limiaresDe(atuais), [chave]: valor }
  for (const [menor, maior, mensagem] of ORDEM) if (lim[menor] > lim[maior]) return mensagem
  return null
}

export function limiaresDe(regras: Pick<RegraClassificacao, 'chave' | 'valor'>[]): LimiaresClassificacao {
  const base = Object.fromEntries(REGRAS_CLASSIFICACAO_PADRAO.map((r) => [r.chave, r.valor])) as LimiaresClassificacao
  for (const r of regras) if (r.chave in base && Number.isFinite(r.valor)) base[r.chave] = r.valor
  return base
}

// ------------------------------------------------------------------ formatação (igual à base)

const inteiro = (v: number) => Math.round(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 })
const perc1 = (v: number) => `${v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
// Mesma regra de apresentação do resto do sistema: milhões com 3 casas.
const reais = (v: number) => (Math.abs(Math.round(v)) >= LIMITE_MILHOES ? formatarMilhoes(v) : `R$ ${inteiro(v)}`)

export const MOTIVOS_MANIFESTO: { campo: keyof SnapshotSemanal; motivo: string; lastro?: boolean }[] = [
  { campo: 'manifestoLastroInconsistente', motivo: 'Lastro inconsistente', lastro: true },
  { campo: 'manifestoNaoConfirma', motivo: 'Não confirma' },
  { campo: 'manifestoInacessivel', motivo: 'Inacessível' },
  { campo: 'manifestoTransacaoNaoConcluida', motivo: 'Transação não concluída' },
  { campo: 'manifestoTransacaoDesconhecida', motivo: 'Transação desconhecida' },
]

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
function mesesDaPosicao(semanaRef: string | undefined): { mes: string; mesAnterior: string } {
  const m = Number((semanaRef ?? '').slice(5, 7))
  if (!(m >= 1 && m <= 12)) return { mes: 'mês atual', mesAnterior: 'mês anterior' }
  return { mes: MESES[m - 1], mesAnterior: MESES[(m + 10) % 12] }
}

export interface EntradaClassificacao {
  status: StatusCliente
  carteiraApartada: boolean
  nomeCarteira?: string
  atual: SnapshotSemanal
  anterior: SnapshotSemanal | null
  /** Restritivos estruturados da semana e da anterior, quando houver. */
  restritivos?: { atual: LinhaRestritivo[]; anterior: LinhaRestritivo[] | null }
}

/** Risco da unidade de análise: consolidado do grupo, ou o do cliente. */
export function riscoDaUnidade(s: Pick<SnapshotSemanal, 'riscoGrupo' | 'riscoCliente'>): number {
  return s.riscoGrupo > 0 ? s.riscoGrupo : s.riscoCliente
}

export function tendenciaDaLiquidez(s: Pick<SnapshotSemanal, 'il30' | 'il60' | 'il90'>, quedaPP: number): TendenciaLiquidez {
  if (s.il30 === null || s.il30 === undefined) return 'SEM_BASE'
  if (s.il90 !== null && s.il60 !== null && s.il90 !== undefined && s.il60 !== undefined && s.il90 > s.il60 && s.il60 > s.il30) return 'QUEDA_CONTINUA'
  if (s.il60 !== null && s.il60 !== undefined && s.il60 - s.il30 > quedaPP + 1e-9) return 'QUEDA_SIGNIFICATIVA'
  return 'ESTAVEL'
}

export function classificarCliente(entrada: EntradaClassificacao, lim: LimiaresClassificacao): ClassificacaoCliente {
  const { atual: s, anterior, status } = entrada

  if (entrada.carteiraApartada) {
    return {
      prioridadeOrdem: 9,
      enquadramento: 'APARTADO',
      motivosEnquadramento: [`Carteira ${entrada.nomeCarteira ?? 'apartada'} — apartada da análise Everblue`],
      criticidade: 'APARTADO',
      tendenciaLiquidez: tendenciaDaLiquidez(s, lim.QUEDA_LIQUIDEZ_PP),
      alertas: [],
      qtdAlertas: 0,
      naoAvaliados: [],
    }
  }

  const naoAvaliados: string[] = []

  const alertas: AlertaClassificacao[] = []
  const add = (nivel: NivelAlertaClassificacao, regra: string, texto: string) => alertas.push({ nivel, regra, texto })
  const risco = riscoDaUnidade(s)
  const pctDoRisco = (v: number) => (risco > 0 ? (v / risco) * 100 : null)

  // Manifestos: os cinco motivos sempre geram alerta; a criticidade depende do
  // valor e do peso no risco (lastro inconsistente tem teto próprio, menor).
  for (const m of MOTIVOS_MANIFESTO) {
    const valor = Number(s[m.campo] ?? 0)
    if (!(valor > 0)) continue
    const pct = pctDoRisco(valor)
    const tetoValor = m.lastro ? lim.LASTRO_CRITICO_VALOR : lim.MANIFESTO_CRITICO_VALOR
    const critico = valor >= tetoValor || (pct !== null && pct >= lim.MANIFESTO_CRITICO_PERC)
    add(critico ? 'CRITICO' : 'ATENCAO', 'MANIFESTO', `Manifesto: ${m.motivo} ${reais(valor)}`)
  }

  // Tranche excedida: sempre crítica.
  if (s.trancheConsolidada > 0 && s.valorEmAndamento > s.trancheConsolidada) {
    const pct = (s.valorEmAndamento / s.trancheConsolidada) * 100
    add('CRITICO', 'TRANCHE_EXCEDIDA', pct > 1000 ? 'Tranche excedida (acima de 1.000%)' : `Tranche excedida (${perc1(pct)})`)
  }

  if (s.statusProposta === 'VENCIDA') add('ATENCAO', 'PROPOSTA_VENCIDA', 'Proposta vencida')

  if (status === 'JURIDICO') add('CRITICO', 'SITUACAO', 'Situação do cliente: JURÍDICO')
  else if (status === 'SAIDA_DE_RISCO') add('CRITICO', 'SITUACAO', 'Situação do cliente: SAÍDA DE RISCO')
  else if (status === 'MONITORAMENTO') add('ATENCAO', 'SITUACAO', 'Cliente em monitoramento')

  if (s.vencidoOficial > 0) {
    const pct = pctDoRisco(s.vencidoOficial) ?? 100
    const critico = pct >= lim.VENCIDO_CRITICO_PERC || s.vencidoOficial >= lim.VENCIDO_CRITICO_VALOR
    add(critico ? 'CRITICO' : 'ATENCAO', 'VENCIDO', `Vencido ${reais(s.vencidoOficial)} (${perc1(pct)})`)
  }

  if (s.limiteGlobal > 0 && risco > s.limiteGlobal) add('ATENCAO', 'LIMITE', 'Risco acima do limite global')

  if (!anterior) naoAvaliados.push('Variação de risco (sem posição anterior)')
  if (anterior) {
    const riscoAnterior = riscoDaUnidade(anterior)
    const delta = risco - riscoAnterior
    if (riscoAnterior > 0 && delta > 0) {
      const pct = (delta / riscoAnterior) * 100
      if (pct >= lim.RISCO_ATENCAO_PERC && delta >= lim.RISCO_ATENCAO_VALOR) {
        const critico = pct >= lim.RISCO_CRITICO_PERC || delta >= lim.RISCO_CRITICO_VALOR
        add(critico ? 'CRITICO' : 'ATENCAO', 'AUMENTO_RISCO', `${critico ? 'Aumento relevante do risco' : 'Aumento do risco'}: ${reais(delta)} (${perc1(pct)})`)
      }
    }
  }

  if (s.prorrogacoesAcima60d === null || s.prorrogacoesAcima60d === undefined) naoAvaliados.push('Prorrogações acima de 60 dias (não informadas)')
  const prorrogacoes = s.prorrogacoesAcima60d ?? 0
  if (prorrogacoes > 0) {
    const pct = pctDoRisco(prorrogacoes)
    const critico = prorrogacoes >= lim.PRORROGACAO_CRITICO_VALOR && (pct === null || pct >= lim.PRORROGACAO_CRITICO_PERC)
    add(critico ? 'CRITICO' : 'ATENCAO', 'PRORROGACOES', `Prorrogações acima de 60d: ${reais(prorrogacoes)}`)
  }

  // Liquidez: IL30 baixo é crítico; faixa intermediária é atenção; queda é atenção.
  if (s.il30 === null || s.il30 === undefined) naoAvaliados.push('Liquidez 30 dias (sem base)')
  if (s.il30 !== null && s.il30 !== undefined) {
    if (s.il30 < lim.IL30_CRITICO) add('CRITICO', 'LIQUIDEZ', `Liquidez 30d baixa: ${perc1(s.il30)}`)
    else if (s.il30 < lim.IL30_ATENCAO) add('ATENCAO', 'LIQUIDEZ', `Liquidez 30d em atenção: ${perc1(s.il30)}`)
  }
  const tendencia = tendenciaDaLiquidez(s, lim.QUEDA_LIQUIDEZ_PP)
  if (tendencia === 'QUEDA_CONTINUA') {
    add('ATENCAO', 'QUEDA_LIQUIDEZ', `Liquidez em queda: 90d ${perc1(s.il90 as number)} → 60d ${perc1(s.il60 as number)} → 30d ${perc1(s.il30 as number)}`)
  } else if (tendencia === 'QUEDA_SIGNIFICATIVA') {
    add('ATENCAO', 'QUEDA_LIQUIDEZ', `Queda de liquidez de ${perc1((s.il60 as number) - (s.il30 as number))} entre 60d e 30d`)
  }

  if (s.recompras > 0) add('ATENCAO', 'RECOMPRAS', `Recompras ${reais(s.recompras)}`)

  const opAnt = s.operacoesMesAnterior ?? null
  const opMes = s.operacoesMes ?? null
  if (opAnt === null || opMes === null) naoAvaliados.push('Queda nas operações (operações não informadas)')
  if (opAnt !== null && opMes !== null && opAnt > 0 && opMes < opAnt) {
    const queda = ((opAnt - opMes) / opAnt) * 100
    if (queda >= lim.QUEDA_OPERACOES_PERC) {
      const { mes, mesAnterior } = mesesDaPosicao(s.semanaRef)
      add('ATENCAO', 'QUEDA_OPERACOES', `Queda nas operações: ${reais(opAnt)} em ${mesAnterior} → ${reais(opMes)} em ${mes} (${perc1(queda)})`)
    }
  }

  // Restritivos estruturados (quando houver): piora de quantidade ou valor.
  if (!entrada.restritivos || !entrada.restritivos.anterior) naoAvaliados.push('Piora de restritivos por tipo (sem posição atual e anterior por tipo)')
  if (entrada.restritivos && entrada.restritivos.anterior) {
    const pioras = compararRestritivos(entrada.restritivos.atual, entrada.restritivos.anterior).filter((v) => v.piorou)
    if (pioras.length > 0) add('ATENCAO', 'RESTRITIVOS', `Piora de restritivos: ${pioras.map(descreverVariacao).join('; ')}`)
  }

  // Prioridade pela situação do cliente.
  const prioridadeOrdem: PrioridadeOrdem = status === 'JURIDICO' ? 1 : status === 'SAIDA_DE_RISCO' ? 2 : status === 'MONITORAMENTO' ? 3 : 4

  // Enquadramento: proposta vencida, risco acima do limite ou limite no teto.
  const motivos: string[] = []
  if (s.statusProposta === 'VENCIDA') motivos.push('Proposta vencida')
  if (s.limiteGlobal > 0 && risco > s.limiteGlobal) motivos.push('Risco acima do limite global')
  else if (s.limiteGlobal > 0 && (risco / s.limiteGlobal) * 100 >= lim.LIMITE_DESENQUADRAMENTO_PERC) {
    motivos.push(`Consumo do limite ≥ ${inteiro(lim.LIMITE_DESENQUADRAMENTO_PERC)}%`)
  }

  const criticidade: CriticidadeClassificada = alertas.some((a) => a.nivel === 'CRITICO') ? 'CRITICO' : alertas.length > 0 ? 'ATENCAO' : 'REGULAR'

  return {
    prioridadeOrdem,
    enquadramento: motivos.length > 0 ? 'DESENQUADRADO' : 'ENQUADRADO',
    motivosEnquadramento: motivos,
    criticidade,
    tendenciaLiquidez: tendencia,
    alertas,
    qtdAlertas: alertas.length,
    naoAvaliados,
  }
}

/** Texto da coluna "Alertas" da base: "[CRÍTICO] … | [ATENÇÃO] …". */
export function textoAlertas(c: Pick<ClassificacaoCliente, 'alertas' | 'criticidade' | 'motivosEnquadramento'>): string {
  if (c.criticidade === 'APARTADO') return c.motivosEnquadramento[0] ?? 'Carteira apartada'
  if (c.alertas.length === 0) return 'Sem alerta relevante'
  return c.alertas.map((a) => `[${a.nivel === 'CRITICO' ? 'CRÍTICO' : 'ATENÇÃO'}] ${a.texto}`).join(' | ')
}

/** Criticidade do cadastro do cliente (NORMAL/ATENCAO/CRITICA) a partir da classificação. */
export function criticidadeDoCadastro(c: CriticidadeClassificada): 'NORMAL' | 'ATENCAO' | 'CRITICA' {
  return c === 'CRITICO' ? 'CRITICA' : c === 'ATENCAO' ? 'ATENCAO' : 'NORMAL'
}

/** Prioridade do cadastro (ALTA/MEDIA/BAIXA) a partir da ordem da base. */
export function prioridadeDoCadastro(ordem: PrioridadeOrdem): 'ALTA' | 'MEDIA' | 'BAIXA' {
  return ordem <= 2 ? 'ALTA' : ordem === 3 ? 'MEDIA' : 'BAIXA'
}
