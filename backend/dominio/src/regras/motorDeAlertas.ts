import type { ConfiguracaoAlerta, Gravidade, PlanoAcao, SnapshotSemanal } from '../models/types'
import { formatarData } from '../utils/formatters'

/**
 * Motor de alertas — as regras comparam o snapshot atual com o anterior e
 * decidem se um alerta deve ser disparado. Os LIMIARES vêm sempre de
 * `ConfiguracaoAlerta` (tela Cadastros e Configurações), nunca fixos aqui.
 * Se o desvio observado for pelo menos o dobro do limiar configurado, a
 * gravidade é escalada em um nível (ex.: configurado como AMARELO vira
 * VERMELHO quando o problema é muito mais grave que o limiar mínimo).
 */

export const TIPOS_ALERTA = {
  AUMENTO_VENCIDO: 'Aumento relevante do vencido',
  AUMENTO_RISCO: 'Aumento de risco',
  CONSUMO_LIMITE: 'Consumo excessivo do limite',
  TRANCHE_EXCEDIDA: 'Tranche excedida',
  QUEDA_LIQUIDEZ: 'Queda da liquidez',
  AUMENTO_ATRASO_MEDIO: 'Aumento de atraso médio',
  AUMENTO_MANIFESTOS: 'Aumento de manifestos',
  PROBLEMAS_LASTRO: 'Problemas de lastro',
  RECOMPRAS_RELEVANTES: 'Recompras relevantes',
  ALTERACAO_RESTRITIVOS: 'Alteração de restritivos',
  PROPOSTA_VENCIDA: 'Proposta vencida',
  PRAZO_REGULARIZACAO_VENCIDO: 'Prazo para regularização vencido',
  PLANO_ACAO_NAO_EXECUTADO: 'Plano de ação não executado',
} as const

export type TipoAlertaChave = keyof typeof TIPOS_ALERTA

export const CONFIGURACOES_ALERTA_PADRAO: ConfiguracaoAlerta[] = [
  { id: 'cfg_aumento_vencido', tipo: 'AUMENTO_VENCIDO', descricao: TIPOS_ALERTA.AUMENTO_VENCIDO, limiar: 10, unidade: '%', gravidadeSugerida: 'AMARELO', ativo: true },
  { id: 'cfg_aumento_risco', tipo: 'AUMENTO_RISCO', descricao: TIPOS_ALERTA.AUMENTO_RISCO, limiar: 8, unidade: '%', gravidadeSugerida: 'AMARELO', ativo: true },
  { id: 'cfg_consumo_limite', tipo: 'CONSUMO_LIMITE', descricao: TIPOS_ALERTA.CONSUMO_LIMITE, limiar: 85, unidade: '%', gravidadeSugerida: 'AMARELO', ativo: true },
  { id: 'cfg_tranche_excedida', tipo: 'TRANCHE_EXCEDIDA', descricao: TIPOS_ALERTA.TRANCHE_EXCEDIDA, limiar: 100, unidade: '%', gravidadeSugerida: 'VERMELHO', ativo: true },
  { id: 'cfg_queda_liquidez', tipo: 'QUEDA_LIQUIDEZ', descricao: TIPOS_ALERTA.QUEDA_LIQUIDEZ, limiar: 6, unidade: '%', gravidadeSugerida: 'AMARELO', ativo: true },
  { id: 'cfg_aumento_atraso_medio', tipo: 'AUMENTO_ATRASO_MEDIO', descricao: TIPOS_ALERTA.AUMENTO_ATRASO_MEDIO, limiar: 5, unidade: 'dias', gravidadeSugerida: 'AMARELO', ativo: true },
  { id: 'cfg_aumento_manifestos', tipo: 'AUMENTO_MANIFESTOS', descricao: TIPOS_ALERTA.AUMENTO_MANIFESTOS, limiar: 20, unidade: '%', gravidadeSugerida: 'AMARELO', ativo: true },
  { id: 'cfg_problemas_lastro', tipo: 'PROBLEMAS_LASTRO', descricao: TIPOS_ALERTA.PROBLEMAS_LASTRO, limiar: 15000, unidade: 'R$', gravidadeSugerida: 'VERMELHO', ativo: true },
  { id: 'cfg_recompras_relevantes', tipo: 'RECOMPRAS_RELEVANTES', descricao: TIPOS_ALERTA.RECOMPRAS_RELEVANTES, limiar: 30000, unidade: 'R$', gravidadeSugerida: 'AMARELO', ativo: true },
  { id: 'cfg_alteracao_restritivos', tipo: 'ALTERACAO_RESTRITIVOS', descricao: TIPOS_ALERTA.ALTERACAO_RESTRITIVOS, limiar: 1, unidade: 'dias', gravidadeSugerida: 'VERMELHO', ativo: true },
  { id: 'cfg_proposta_vencida', tipo: 'PROPOSTA_VENCIDA', descricao: TIPOS_ALERTA.PROPOSTA_VENCIDA, limiar: 0, unidade: 'dias', gravidadeSugerida: 'AMARELO', ativo: true },
  { id: 'cfg_prazo_regularizacao_vencido', tipo: 'PRAZO_REGULARIZACAO_VENCIDO', descricao: TIPOS_ALERTA.PRAZO_REGULARIZACAO_VENCIDO, limiar: 0, unidade: 'dias', gravidadeSugerida: 'VERMELHO', ativo: true },
  { id: 'cfg_plano_acao_nao_executado', tipo: 'PLANO_ACAO_NAO_EXECUTADO', descricao: TIPOS_ALERTA.PLANO_ACAO_NAO_EXECUTADO, limiar: 0, unidade: 'dias', gravidadeSugerida: 'VERMELHO', ativo: true },
]

function escalar(gravidade: Gravidade): Gravidade {
  if (gravidade === 'VERDE') return 'AMARELO'
  if (gravidade === 'AMARELO') return 'VERMELHO'
  return 'VERMELHO'
}

function gravidadePorDesvio(config: ConfiguracaoAlerta, valorObservado: number): Gravidade {
  if (config.limiar <= 0) return config.gravidadeSugerida
  return valorObservado >= config.limiar * 2 ? escalar(config.gravidadeSugerida) : config.gravidadeSugerida
}

export interface AlertaGerado {
  tipo: string
  gravidade: Gravidade
  descricao: string
}

function configAtiva(configs: ConfiguracaoAlerta[], tipo: TipoAlertaChave): ConfiguracaoAlerta | null {
  const cfg = configs.find((c) => c.tipo === tipo)
  return cfg && cfg.ativo ? cfg : null
}

/** Avalia deterioração entre dois snapshots consecutivos do mesmo cliente. */
export function avaliarAlertasSnapshot(
  atual: SnapshotSemanal,
  anterior: SnapshotSemanal | null,
  configs: ConfiguracaoAlerta[],
): AlertaGerado[] {
  const alertas: AlertaGerado[] = []

  const percVencidoAtual = atual.riscoCliente > 0 ? (atual.vencidoOficial / atual.riscoCliente) * 100 : 0
  const percVencidoAnterior = anterior && anterior.riscoCliente > 0 ? (anterior.vencidoOficial / anterior.riscoCliente) * 100 : null

  if (anterior) {
    const cfg = configAtiva(configs, 'AUMENTO_VENCIDO')
    if (cfg && percVencidoAnterior !== null) {
      const deltaPP = percVencidoAtual - percVencidoAnterior
      if (deltaPP >= cfg.limiar) {
        alertas.push({ tipo: cfg.descricao, gravidade: gravidadePorDesvio(cfg, deltaPP), descricao: `% vencido subiu ${deltaPP.toFixed(1)} p.p. em relação à semana anterior` })
      }
    }

    const cfgRisco = configAtiva(configs, 'AUMENTO_RISCO')
    if (cfgRisco && anterior.riscoCliente > 0) {
      const deltaPerc = ((atual.riscoCliente - anterior.riscoCliente) / anterior.riscoCliente) * 100
      if (deltaPerc >= cfgRisco.limiar) {
        alertas.push({ tipo: cfgRisco.descricao, gravidade: gravidadePorDesvio(cfgRisco, deltaPerc), descricao: `Risco do cliente aumentou ${deltaPerc.toFixed(1)}% na semana` })
      }
    }

    const cfgLiquidez = configAtiva(configs, 'QUEDA_LIQUIDEZ')
    if (cfgLiquidez) {
      const quedaIl30 = anterior.il30 - atual.il30
      if (quedaIl30 >= cfgLiquidez.limiar) {
        alertas.push({ tipo: cfgLiquidez.descricao, gravidade: gravidadePorDesvio(cfgLiquidez, quedaIl30), descricao: `IL 30 dias caiu ${quedaIl30.toFixed(1)} p.p.` })
      }
    }

    const cfgAtraso = configAtiva(configs, 'AUMENTO_ATRASO_MEDIO')
    if (cfgAtraso) {
      const deltaAtraso = atual.atrasoMedioDias - anterior.atrasoMedioDias
      if (deltaAtraso >= cfgAtraso.limiar) {
        alertas.push({ tipo: cfgAtraso.descricao, gravidade: gravidadePorDesvio(cfgAtraso, deltaAtraso), descricao: `Atraso médio subiu ${deltaAtraso.toFixed(0)} dias` })
      }
    }

    const cfgManifestos = configAtiva(configs, 'AUMENTO_MANIFESTOS')
    if (cfgManifestos) {
      const totalAtual = atual.manifestoInacessivel + atual.manifestoNaoConfirma + atual.manifestoTransacaoDesconhecida + atual.manifestoLastroInconsistente + atual.manifestoTransacaoNaoConcluida
      const totalAnterior = anterior.manifestoInacessivel + anterior.manifestoNaoConfirma + anterior.manifestoTransacaoDesconhecida + anterior.manifestoLastroInconsistente + anterior.manifestoTransacaoNaoConcluida
      if (totalAnterior > 0) {
        const deltaPerc = ((totalAtual - totalAnterior) / totalAnterior) * 100
        if (deltaPerc >= cfgManifestos.limiar) {
          alertas.push({ tipo: cfgManifestos.descricao, gravidade: gravidadePorDesvio(cfgManifestos, deltaPerc), descricao: `Problemas de manifesto aumentaram ${deltaPerc.toFixed(0)}%` })
        }
      }
    }

    const cfgRestritivos = configAtiva(configs, 'ALTERACAO_RESTRITIVOS')
    if (cfgRestritivos && atual.restritivos > anterior.restritivos) {
      alertas.push({ tipo: cfgRestritivos.descricao, gravidade: cfgRestritivos.gravidadeSugerida, descricao: `Novo(s) restritivo(s) identificado(s): ${atual.restritivos - anterior.restritivos}` })
    }

    const cfgRecompra = configAtiva(configs, 'RECOMPRAS_RELEVANTES')
    if (cfgRecompra && atual.recompras >= cfgRecompra.limiar) {
      alertas.push({ tipo: cfgRecompra.descricao, gravidade: gravidadePorDesvio(cfgRecompra, atual.recompras), descricao: `Recompras de R$ ${atual.recompras.toLocaleString('pt-BR')} na semana` })
    }
  }

  const cfgLastro = configAtiva(configs, 'PROBLEMAS_LASTRO')
  if (cfgLastro && atual.manifestoLastroInconsistente >= cfgLastro.limiar) {
    alertas.push({ tipo: cfgLastro.descricao, gravidade: gravidadePorDesvio(cfgLastro, atual.manifestoLastroInconsistente), descricao: `Lastro inconsistente de R$ ${atual.manifestoLastroInconsistente.toLocaleString('pt-BR')}` })
  }

  const cfgLimite = configAtiva(configs, 'CONSUMO_LIMITE')
  if (cfgLimite && atual.percConsumoLimite >= cfgLimite.limiar) {
    alertas.push({ tipo: cfgLimite.descricao, gravidade: gravidadePorDesvio(cfgLimite, atual.percConsumoLimite), descricao: `Consumo do limite em ${atual.percConsumoLimite.toFixed(1)}%` })
  }

  const cfgTranche = configAtiva(configs, 'TRANCHE_EXCEDIDA')
  if (cfgTranche && atual.statusTranche === 'EXCEDIDA') {
    alertas.push({ tipo: cfgTranche.descricao, gravidade: cfgTranche.gravidadeSugerida, descricao: `Tranche excedida (${atual.percConsumoTranche.toFixed(1)}% consumida)` })
  }

  const cfgProposta = configAtiva(configs, 'PROPOSTA_VENCIDA')
  if (cfgProposta && atual.statusProposta === 'VENCIDA') {
    alertas.push({ tipo: cfgProposta.descricao, gravidade: cfgProposta.gravidadeSugerida, descricao: 'Proposta de crédito vencida sem renovação' })
  }

  return alertas
}

/** Avalia planos de ação (prazo vencido / não executado). */
export function avaliarAlertasPlano(plano: PlanoAcao, configs: ConfiguracaoAlerta[], hoje: Date): AlertaGerado[] {
  const alertas: AlertaGerado[] = []
  const cfgPrazo = configAtiva(configs, 'PRAZO_REGULARIZACAO_VENCIDO')
  if (cfgPrazo && plano.status !== 'CONCLUIDO' && new Date(plano.dataLimite) < hoje) {
    alertas.push({ tipo: cfgPrazo.descricao, gravidade: cfgPrazo.gravidadeSugerida, descricao: `Plano de ação com prazo vencido em ${formatarData(plano.dataLimite)}` })
  }
  const cfgNaoExecutado = configAtiva(configs, 'PLANO_ACAO_NAO_EXECUTADO')
  if (cfgNaoExecutado && plano.status === 'ATRASADO' && plano.oQueNaoFoiFeito) {
    alertas.push({ tipo: cfgNaoExecutado.descricao, gravidade: cfgNaoExecutado.gravidadeSugerida, descricao: `Ação combinada não executada: ${plano.oQueNaoFoiFeito}` })
  }
  return alertas
}
