import type { Gravidade, MovimentoContaMensal } from '../models/types'
import { formatarMoeda } from '../utils/formatters'

/**
 * Motor de Análise Transacional — cruza os últimos 6 meses de movimento da
 * conta do cliente para responder ao que o item "Dados transacionais da
 * conta movimento" do checklist pede: o cliente ainda movimenta a conta com
 * frequência normal? O volume dos últimos 3 meses destoa dos 3 meses
 * anteriores? Houve algum pagamento muito fora do padrão histórico?
 *
 * Desvio de padrão = comparar a MÉDIA RECENTE (últimos 3 meses) contra a
 * MÉDIA DE REFERÊNCIA (3 meses anteriores a esses) — tanto em volume
 * (entradas + saídas) quanto em frequência (quantidade de transações) — e
 * marcar como atípico qualquer mês cujo maior pagamento único destoe muito
 * da mediana dos demais meses.
 */

export interface MesAnalisado extends MovimentoContaMensal {
  volume: number
  atipico: boolean
}

export interface CruzamentoTransacional {
  titulo: string
  gravidade: Gravidade
  resumo: string
}

/** Dados da carteira do cliente (fora da conta movimento) usados para
 * cruzar a movimentação bancária com o que foi declarado ao fundo. */
export interface ContextoCruzamentoTransacional {
  riscoCliente: number
  vencidoOficial: number
  liquidadoUltimoMes: number
}

export interface AnaliseTransacional {
  gravidade: Gravidade
  resumo: string
  alertasAtipicos: string[]
  meses: MesAnalisado[]
  mediaVolumeRecente: number
  mediaVolumeReferencia: number
  variacaoVolumePerc: number | null
  mediaFrequenciaRecente: number
  mediaFrequenciaReferencia: number
  variacaoFrequenciaPerc: number | null
  cruzamentos: CruzamentoTransacional[]
}

function media(valores: number[]): number {
  return valores.length > 0 ? valores.reduce((a, b) => a + b, 0) / valores.length : 0
}

function mediana(valores: number[]): number {
  if (valores.length === 0) return 0
  const ordenado = [...valores].sort((a, b) => a - b)
  const meio = Math.floor(ordenado.length / 2)
  return ordenado.length % 2 === 0 ? (ordenado[meio - 1] + ordenado[meio]) / 2 : ordenado[meio]
}

export function analisarMovimentoConta(mesesEntrada: MovimentoContaMensal[], contexto?: ContextoCruzamentoTransacional | null): AnaliseTransacional | null {
  if (mesesEntrada.length === 0) return null
  const ordenado = [...mesesEntrada].sort((a, b) => a.mesRef.localeCompare(b.mesRef))
  const n = ordenado.length
  const tamanhoJanela = Math.min(3, Math.floor(n / 2)) || 1

  const recentes = ordenado.slice(n - tamanhoJanela)
  const referencia = ordenado.slice(Math.max(0, n - tamanhoJanela * 2), n - tamanhoJanela)

  const mediaVolumeRecente = media(recentes.map((m) => m.entradas + m.saidas))
  const mediaVolumeReferencia = media(referencia.map((m) => m.entradas + m.saidas))
  const variacaoVolumePerc = referencia.length > 0 && mediaVolumeReferencia > 0 ? ((mediaVolumeRecente - mediaVolumeReferencia) / mediaVolumeReferencia) * 100 : null

  const mediaEntradasRecente = media(recentes.map((m) => m.entradas))
  const mediaSaidasRecente = media(recentes.map((m) => m.saidas))
  const mediaSaidasReferencia = media(referencia.map((m) => m.saidas))
  const variacaoSaidasPerc = referencia.length > 0 && mediaSaidasReferencia > 0 ? ((mediaSaidasRecente - mediaSaidasReferencia) / mediaSaidasReferencia) * 100 : null

  const mediaFrequenciaRecente = media(recentes.map((m) => m.qtdTransacoes))
  const mediaFrequenciaReferencia = media(referencia.map((m) => m.qtdTransacoes))
  const variacaoFrequenciaPerc = referencia.length > 0 && mediaFrequenciaReferencia > 0 ? ((mediaFrequenciaRecente - mediaFrequenciaReferencia) / mediaFrequenciaReferencia) * 100 : null

  // Pagamento atípico: mês cujo maior pagamento passa muito da mediana dos demais meses.
  const alertasAtipicos: string[] = []
  const meses: MesAnalisado[] = ordenado.map((mes, i) => {
    const outros = ordenado.filter((_, j) => j !== i).map((m) => m.maiorPagamento)
    const medianaOutros = mediana(outros)
    const atipico = medianaOutros > 0 && mes.maiorPagamento >= medianaOutros * 2.5
    if (atipico) {
      alertasAtipicos.push(`${mes.mesRef.slice(0, 7)}: pagamento de ${formatarMoeda(mes.maiorPagamento)}, muito acima do padrão histórico (mediana ${formatarMoeda(medianaOutros)}).`)
    }
    return { ...mes, volume: mes.entradas + mes.saidas, atipico }
  })

  const quedaVolumeForte = variacaoVolumePerc !== null && variacaoVolumePerc <= -50
  const quedaVolumeModerada = variacaoVolumePerc !== null && variacaoVolumePerc <= -20
  const quedaFrequenciaForte = variacaoFrequenciaPerc !== null && variacaoFrequenciaPerc <= -50
  const quedaFrequenciaModerada = variacaoFrequenciaPerc !== null && variacaoFrequenciaPerc <= -20
  const atipicoForte = meses.some((m) => m.atipico && m.maiorPagamento >= mediana(meses.map((x) => x.maiorPagamento)) * 4)

  // Cruzamentos com a carteira: a movimentação bancária isolada não diz muito
  // sem comparar com o que o cliente declarou ao fundo (risco assumido,
  // liquidação da carteira, vencido em aberto) — é aí que aparece o desvio
  // de padrão que interessa ao comitê (dinheiro saindo por fora, lastro que
  // não bate com o caixa, ou cliente gastando em vez de honrar a dívida).
  const cruzamentos: CruzamentoTransacional[] = []
  if (contexto) {
    const { riscoCliente, vencidoOficial, liquidadoUltimoMes } = contexto

    if (riscoCliente > 0) {
      const percRiscoGirado = (mediaVolumeRecente / riscoCliente) * 100
      if (percRiscoGirado < 10) {
        cruzamentos.push({
          titulo: 'Movimentação incompatível com o risco assumido',
          gravidade: 'VERMELHO',
          resumo: `A conta movimenta apenas ${formatarMoeda(mediaVolumeRecente)}/mês (${percRiscoGirado.toFixed(1)}% do risco de ${formatarMoeda(riscoCliente)}) — volume muito abaixo do esperado para o porte da operação financiada pelo fundo.`,
        })
      } else if (percRiscoGirado < 15) {
        cruzamentos.push({
          titulo: 'Movimentação abaixo do esperado para o risco',
          gravidade: 'AMARELO',
          resumo: `A conta movimenta ${formatarMoeda(mediaVolumeRecente)}/mês, equivalente a ${percRiscoGirado.toFixed(1)}% do risco assumido (${formatarMoeda(riscoCliente)}) — vale confirmar se o cliente movimenta parte da operação em outra conta.`,
        })
      }
    }

    if (liquidadoUltimoMes > 0) {
      const razaoLiquidadoEntradas = mediaEntradasRecente > 0 ? liquidadoUltimoMes / mediaEntradasRecente : Infinity
      if (razaoLiquidadoEntradas >= 2.2) {
        cruzamentos.push({
          titulo: 'Liquidação da carteira acima das entradas na conta',
          gravidade: 'VERMELHO',
          resumo: `A carteira registrou ${formatarMoeda(liquidadoUltimoMes)} liquidados no último mês, mas só ${formatarMoeda(mediaEntradasRecente)} entraram na conta monitorada no mesmo período — o lastro liquidado pode não estar caindo nesta conta.`,
        })
      } else if (razaoLiquidadoEntradas >= 1.6) {
        cruzamentos.push({
          titulo: 'Entradas um pouco abaixo do liquidado na carteira',
          gravidade: 'AMARELO',
          resumo: `Liquidado no último mês (${formatarMoeda(liquidadoUltimoMes)}) veio acima das entradas na conta (${formatarMoeda(mediaEntradasRecente)}) — diferença dentro do plausível, mas vale acompanhar.`,
        })
      }
    }

    const percVencido = riscoCliente > 0 ? (vencidoOficial / riscoCliente) * 100 : 0
    if (percVencido >= 15 && variacaoSaidasPerc !== null && variacaoSaidasPerc > -10) {
      cruzamentos.push({
        titulo: 'Saídas mantidas apesar do vencido elevado',
        gravidade: percVencido >= 25 ? 'VERMELHO' : 'AMARELO',
        resumo: `Com ${percVencido.toFixed(1)}% da carteira vencida, as saídas da conta ${variacaoSaidasPerc >= 0 ? 'subiram' : 'caíram apenas'} ${Math.abs(variacaoSaidasPerc).toFixed(0)}% — sem sinal de priorização do pagamento da dívida com o fundo.`,
      })
    }
  }

  let gravidade: Gravidade = 'VERDE'
  if (quedaVolumeForte || quedaFrequenciaForte || atipicoForte || cruzamentos.some((c) => c.gravidade === 'VERMELHO')) gravidade = 'VERMELHO'
  else if (quedaVolumeModerada || quedaFrequenciaModerada || alertasAtipicos.length > 0 || cruzamentos.some((c) => c.gravidade === 'AMARELO')) gravidade = 'AMARELO'

  const partes: string[] = []
  if (variacaoVolumePerc !== null) {
    partes.push(
      `Volume mensal (entradas+saídas) ${variacaoVolumePerc >= 0 ? 'subiu' : 'caiu'} ${Math.abs(variacaoVolumePerc).toFixed(0)}% nos últimos ${tamanhoJanela} meses frente aos ${tamanhoJanela} anteriores (${formatarMoeda(mediaVolumeReferencia)} → ${formatarMoeda(mediaVolumeRecente)}/mês).`,
    )
  }
  if (variacaoFrequenciaPerc !== null) {
    partes.push(
      `Frequência de transações ${variacaoFrequenciaPerc >= 0 ? 'subiu' : 'caiu'} ${Math.abs(variacaoFrequenciaPerc).toFixed(0)}% (${mediaFrequenciaReferencia.toFixed(0)} → ${mediaFrequenciaRecente.toFixed(0)}/mês).`,
    )
  }
  if (alertasAtipicos.length > 0) partes.push(`${alertasAtipicos.length} pagamento(s) atípico(s) identificado(s).`)
  if (cruzamentos.length > 0) partes.push(`${cruzamentos.length} ponto(s) de divergência com a carteira identificado(s) ao cruzar com risco/liquidação/vencido.`)
  if (partes.length === 0) partes.push('Sem histórico suficiente para comparação.')

  return {
    gravidade,
    resumo: partes.join(' '),
    alertasAtipicos,
    cruzamentos,
    meses,
    mediaVolumeRecente,
    mediaVolumeReferencia,
    variacaoVolumePerc,
    mediaFrequenciaRecente,
    mediaFrequenciaReferencia,
    variacaoFrequenciaPerc,
  }
}
