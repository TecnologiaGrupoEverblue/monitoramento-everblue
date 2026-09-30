import type { Alerta, ChaveItemChecklist, Cliente, Gravidade, Juridico, PlanoAcao, SnapshotSemanal, StatusPlano } from '../models/types'
import { diasEntre, formatarMoeda, formatarPercentual } from '../utils/formatters'
import type { AnaliseTransacional } from './motorTransacional'

/**
 * Checklist de Análise Semanal — roteiro ponto a ponto que o executivo
 * percorre em cada cliente antes do comitê, baseado na "Raiz de Apresentação
 * Comitê Monitoramento" da EverBlue (mais o Parecer Jurídico, que a planilha
 * original não tinha e passou a ser exigido em todo cliente).
 *
 * A ordem e os rótulos abaixo seguem literalmente o documento da empresa.
 * Os itens são agrupados em 4 blocos temáticos só para leitura na tela —
 * a ordem "oficial" do roteiro continua em ITENS_CHECKLIST.
 */
export const ITENS_CHECKLIST: { chave: ChaveItemChecklist; label: string }[] = [
  { chave: 'RISCO_MENSAL', label: 'Risco Mensal' },
  { chave: 'LIMITE_CONSUMIDO', label: 'Limite Consumido' },
  { chave: 'TRANCHE_CONSUMIDA', label: 'Tranche Consumida' },
  { chave: 'RISCO_POR_PRODUTO', label: 'Risco Por Produto' },
  { chave: 'VENCIDOS', label: 'Vencidos' },
  { chave: 'VENCIDOS_DESDE_QUANDO', label: 'Vencidos desde Quando' },
  { chave: 'PRAZO_MEDIO_CARTEIRA', label: 'Prazo médio da Carteira' },
  { chave: 'LIQUIDEZ_15_30_60', label: 'Liquidez 15, 30, 60 — quanto foi liquidado, recomprado e causa' },
  { chave: 'MANIFESTOS', label: 'Manifestos' },
  { chave: 'COMPORTAMENTO_CALENDARIO', label: 'Comportamento no Calendário' },
  { chave: 'EVOLUCAO_RESTRITIVOS', label: 'Evolução de Restritivos' },
  { chave: 'AGING_CARTEIRA', label: 'Aging da Carteira (vencimentário)' },
  { chave: 'PRACA_PAGAMENTO', label: 'Praça de pagamento' },
  { chave: 'PLANO_ACAO_NOVA_DECISAO', label: 'Plano de Ação / Nova Decisão' },
  { chave: 'EVENTOS', label: 'Eventos' },
  { chave: 'DADOS_TRANSACIONAIS_CONTA_MOVIMENTO', label: 'Dados transacionais da conta movimento (volume de movimentação compatível)' },
  { chave: 'PARECER_JURIDICO', label: 'Parecer Jurídico' },
]

export const GRUPOS_CHECKLIST: { titulo: string; itens: ChaveItemChecklist[] }[] = [
  { titulo: 'Exposição & Limite', itens: ['RISCO_MENSAL', 'LIMITE_CONSUMIDO', 'TRANCHE_CONSUMIDA', 'RISCO_POR_PRODUTO'] },
  { titulo: 'Inadimplência', itens: ['VENCIDOS', 'VENCIDOS_DESDE_QUANDO', 'PRAZO_MEDIO_CARTEIRA', 'AGING_CARTEIRA', 'COMPORTAMENTO_CALENDARIO'] },
  { titulo: 'Liquidez & Performance', itens: ['LIQUIDEZ_15_30_60', 'MANIFESTOS', 'EVOLUCAO_RESTRITIVOS', 'PRACA_PAGAMENTO'] },
  { titulo: 'Governança', itens: ['PLANO_ACAO_NOVA_DECISAO', 'EVENTOS', 'DADOS_TRANSACIONAIS_CONTA_MOVIMENTO', 'PARECER_JURIDICO'] },
]

export type StatusJuridicoResumo = 'EM_ANDAMENTO' | 'ACORDO' | 'ENCERRADO' | 'ATENCAO_PREVENTIVA' | 'SEM_PROCESSO'

/** Dado estruturado por trás do item — o que dá para desenhar (barra,
 * sparkline, badge, chips) em vez de só descrever em texto. Cada item tem
 * no máximo um `tipo`; itens sem fonte de dado real (praça de pagamento,
 * dados transacionais) não têm `dado` — só o resumo em texto mesmo. */
export type DadoVisualChecklist =
  | { tipo: 'percentual'; valor: number }
  | { tipo: 'percentuais'; itens: { label: string; valor: number }[] }
  | { tipo: 'tendencia'; serie: number[]; variacaoPerc: number | null }
  | { tipo: 'statusPlano'; status: StatusPlano }
  | { tipo: 'statusJuridico'; status: StatusJuridicoResumo }
  | { tipo: 'categorias'; itens: { label: string; valor: number; exibicao: string; cor?: Gravidade }[] }

export interface SugestaoChecklist {
  item: ChaveItemChecklist
  gravidade: Gravidade
  resumo: string
  dado?: DadoVisualChecklist
}

interface ParametrosSugestao {
  cliente: Cliente
  snapshotAtual: SnapshotSemanal | null
  snapshotAnterior: SnapshotSemanal | null
  snapshotMesAnterior: SnapshotSemanal | null
  /** Últimas semanas (ordem cronológica, mais recente por último) para os sparklines. */
  serieRecente: SnapshotSemanal[]
  planos: PlanoAcao[]
  alertas: Alerta[]
  juridico: Juridico | null
  analiseTransacional: AnaliseTransacional | null
}

const SEM_DADO: SugestaoChecklist['gravidade'] = 'AMARELO'

/** Calcula, para um cliente, a sugestão automática (gravidade + resumo +
 * dado visual) de cada item do checklist — cruzando sempre dado real da
 * posição da semana. Itens sem uma fonte de dado estruturada no sistema
 * (praça de pagamento, dados transacionais) voltam com um aviso pedindo o
 * preenchimento manual, em vez de fingir um "verde" que não foi checado. */
export function sugerirChecklist(params: ParametrosSugestao): SugestaoChecklist[] {
  const { cliente, snapshotAtual: s, snapshotAnterior: ant, snapshotMesAnterior: mes, serieRecente, planos, alertas, juridico, analiseTransacional } = params

  if (!s) {
    return ITENS_CHECKLIST.map(({ chave }) => ({ item: chave, gravidade: 'AMARELO', resumo: 'Sem posição da carteira para esta semana ainda.' }))
  }

  const percVencido = s.riscoCliente > 0 ? (s.vencidoOficial / s.riscoCliente) * 100 : 0
  const resultado: SugestaoChecklist[] = []

  // 1. Risco Mensal
  const serieRisco = serieRecente.map((snap) => snap.riscoCliente)
  if (mes && mes.riscoCliente > 0) {
    const delta = ((s.riscoCliente - mes.riscoCliente) / mes.riscoCliente) * 100
    resultado.push({
      item: 'RISCO_MENSAL',
      gravidade: delta >= 15 ? 'VERMELHO' : delta >= 5 ? 'AMARELO' : 'VERDE',
      resumo: `Risco ${delta >= 0 ? 'subiu' : 'caiu'} ${Math.abs(delta).toFixed(1)}% frente ao mês anterior (${formatarMoeda(mes.riscoCliente)} → ${formatarMoeda(s.riscoCliente)}).`,
      dado: { tipo: 'tendencia', serie: serieRisco, variacaoPerc: delta },
    })
  } else {
    resultado.push({
      item: 'RISCO_MENSAL',
      gravidade: 'VERDE',
      resumo: `Risco atual: ${formatarMoeda(s.riscoCliente)}. Sem posição do mês anterior para comparar.`,
      dado: { tipo: 'tendencia', serie: serieRisco, variacaoPerc: null },
    })
  }

  // 2. Limite Consumido
  resultado.push({
    item: 'LIMITE_CONSUMIDO',
    gravidade: s.percConsumoLimite >= 100 ? 'VERMELHO' : s.percConsumoLimite >= 85 ? 'AMARELO' : 'VERDE',
    resumo: `${formatarPercentual(s.percConsumoLimite)} do limite global consumido.`,
    dado: { tipo: 'percentual', valor: s.percConsumoLimite },
  })

  // 3. Tranche Consumida
  resultado.push({
    item: 'TRANCHE_CONSUMIDA',
    gravidade: s.statusTranche === 'EXCEDIDA' ? 'VERMELHO' : s.statusTranche === 'PROXIMA_DO_LIMITE' ? 'AMARELO' : 'VERDE',
    resumo: `${formatarPercentual(s.percConsumoTranche)} da tranche consumida (${s.statusTranche === 'EXCEDIDA' ? 'excedida' : s.statusTranche === 'PROXIMA_DO_LIMITE' ? 'próxima do limite' : 'dentro do limite'}).`,
    dado: { tipo: 'percentual', valor: s.percConsumoTranche },
  })

  // 4. Risco Por Produto
  resultado.push({
    item: 'RISCO_POR_PRODUTO',
    gravidade: cliente.produtos.length <= 1 ? 'AMARELO' : 'VERDE',
    resumo:
      cliente.produtos.length <= 1
        ? `Exposição concentrada em um único produto (${cliente.produtos[0] ?? '—'}).`
        : `Exposição distribuída em ${cliente.produtos.length} produtos: ${cliente.produtos.join(', ')}.`,
    dado: { tipo: 'categorias', itens: cliente.produtos.map((p) => ({ label: p, valor: 1, exibicao: '' })) },
  })

  // 5. Vencidos — nível atual (barra) + tendência: compara com o início da
  // janela recente pra saber se o vencido vem subindo (piorando) ou mudou de
  // rota (estabilizou/caiu), não só o valor pontual desta semana.
  const seriePercVencido = serieRecente.map((snap) => (snap.riscoCliente > 0 ? (snap.vencidoOficial / snap.riscoCliente) * 100 : 0))
  const percVencidoBase = seriePercVencido.length > 1 ? seriePercVencido[0] : null
  const variacaoPercVencidoPP = percVencidoBase !== null ? percVencido - percVencidoBase : null
  const vencidoSubindoForte = variacaoPercVencidoPP !== null && variacaoPercVencidoPP >= 8
  resultado.push({
    item: 'VENCIDOS',
    gravidade: percVencido >= 20 || vencidoSubindoForte ? 'VERMELHO' : percVencido >= 8 || (variacaoPercVencidoPP !== null && variacaoPercVencidoPP >= 3) ? 'AMARELO' : 'VERDE',
    resumo:
      variacaoPercVencidoPP !== null
        ? `${formatarMoeda(s.vencidoOficial)} em vencido (${formatarPercentual(percVencido)} da carteira) — ${variacaoPercVencidoPP >= 0 ? 'subiu' : 'caiu'} ${Math.abs(variacaoPercVencidoPP).toFixed(1)} p.p. nas últimas semanas (${percVencidoBase!.toFixed(1)}% → ${percVencido.toFixed(1)}%).`
        : `${formatarMoeda(s.vencidoOficial)} em vencido (${formatarPercentual(percVencido)} da carteira do cliente).`,
    dado: { tipo: 'percentual', valor: percVencido },
  })

  // 6. Vencidos desde Quando
  if (s.vencidoOficial > 0 && s.vencidoDesde) {
    const dias = diasEntre(s.vencidoDesde)
    resultado.push({
      item: 'VENCIDOS_DESDE_QUANDO',
      gravidade: dias >= 90 ? 'VERMELHO' : dias >= 30 ? 'AMARELO' : 'VERDE',
      resumo: `Vencido há ${dias} dia(s) (desde ${s.vencidoDesde}).`,
    })
  } else {
    resultado.push({ item: 'VENCIDOS_DESDE_QUANDO', gravidade: 'VERDE', resumo: 'Sem vencido em aberto nesta posição.' })
  }

  // 7. Prazo médio da Carteira — compara com o início da janela recente (não
  // só a semana anterior) pra pegar aumento SUSTENTADO, não ruído de 1 semana.
  const seriePrazoMedio = serieRecente.map((snap) => snap.prazoMedioCarteiraDias)
  const prazoMedioBase = seriePrazoMedio.length > 1 ? seriePrazoMedio[0] : null
  const variacaoPrazoMedio = prazoMedioBase && prazoMedioBase > 0 ? ((s.prazoMedioCarteiraDias - prazoMedioBase) / prazoMedioBase) * 100 : null
  const prazoSubindoForte = variacaoPrazoMedio !== null && variacaoPrazoMedio >= 25
  const prazoSubindoModerado = variacaoPrazoMedio !== null && variacaoPrazoMedio >= 10
  resultado.push({
    item: 'PRAZO_MEDIO_CARTEIRA',
    gravidade: prazoSubindoForte || s.prazoMedioCarteiraDias > 90 ? 'VERMELHO' : prazoSubindoModerado || s.prazoMedioCarteiraDias > 75 ? 'AMARELO' : 'VERDE',
    resumo:
      variacaoPrazoMedio !== null
        ? `Prazo médio em ${s.prazoMedioCarteiraDias} dias — ${variacaoPrazoMedio >= 0 ? 'subiu' : 'caiu'} ${Math.abs(variacaoPrazoMedio).toFixed(0)}% nas últimas semanas (${prazoMedioBase!.toFixed(0)} → ${s.prazoMedioCarteiraDias} dias).`
        : `Prazo médio da carteira: ${s.prazoMedioCarteiraDias} dias.`,
    dado: { tipo: 'tendencia', serie: seriePrazoMedio, variacaoPerc: variacaoPrazoMedio },
  })

  // 8. Liquidez 15/30/60
  resultado.push({
    item: 'LIQUIDEZ_15_30_60',
    gravidade: s.il30 < 60 ? 'VERMELHO' : s.il30 < 80 ? 'AMARELO' : 'VERDE',
    resumo: `IL 30 dias em ${formatarPercentual(s.il30)} (IL 60: ${formatarPercentual(s.il60)}). Liquidado no período: ${formatarMoeda(s.liquidadoNoPeriodo)}${s.recompras > 0 ? ` · Recompras: ${formatarMoeda(s.recompras)} (${s.motivoRecompra ?? 'motivo não informado'})` : ''}.`,
    dado: {
      tipo: 'percentuais',
      itens: [
        { label: 'IL 30', valor: s.il30 },
        { label: 'IL 60', valor: s.il60 },
        { label: 'IL 90', valor: s.il90 },
      ],
    },
  })

  // 9. Manifestos
  const manifestos = [
    { label: 'Inacessível', valor: s.manifestoInacessivel },
    { label: 'Não confirma', valor: s.manifestoNaoConfirma },
    { label: 'Transação desconhecida', valor: s.manifestoTransacaoDesconhecida },
    { label: 'Lastro inconsistente', valor: s.manifestoLastroInconsistente },
    { label: 'Transação não concluída', valor: s.manifestoTransacaoNaoConcluida },
  ].filter((m) => m.valor > 0)
  const totalManifestos = manifestos.reduce((soma, m) => soma + m.valor, 0)
  resultado.push({
    item: 'MANIFESTOS',
    gravidade: s.manifestoLastroInconsistente > 0 ? 'VERMELHO' : totalManifestos > 0 ? 'AMARELO' : 'VERDE',
    resumo: totalManifestos > 0 ? `R$ ${totalManifestos.toLocaleString('pt-BR')} em problemas de manifesto (${formatarPercentual(s.manifestoPercSemAtuacao)} sem atuação).` : 'Sem problemas de manifesto na semana.',
    dado:
      manifestos.length > 0
        ? { tipo: 'categorias', itens: manifestos.map((m) => ({ ...m, exibicao: formatarMoeda(m.valor), cor: (m.label === 'Lastro inconsistente' ? 'VERMELHO' : 'AMARELO') as Gravidade })) }
        : undefined,
  })

  // 10. Comportamento no Calendário — mesma lógica: compara com o início da
  // janela recente pra ver se o atraso vem subindo (piorando) ou mudou de rota.
  const serieAtrasoMedio = serieRecente.map((snap) => snap.atrasoMedioDias)
  const atrasoMedioBase = serieAtrasoMedio.length > 1 ? serieAtrasoMedio[0] : null
  const variacaoAtrasoMedio = atrasoMedioBase && atrasoMedioBase > 0 ? ((s.atrasoMedioDias - atrasoMedioBase) / atrasoMedioBase) * 100 : null
  const atrasoSubindoForte = variacaoAtrasoMedio !== null && variacaoAtrasoMedio >= 25
  const atrasoSubindoModerado = variacaoAtrasoMedio !== null && variacaoAtrasoMedio >= 10
  resultado.push({
    item: 'COMPORTAMENTO_CALENDARIO',
    gravidade: s.atrasoMedioDias >= 20 || atrasoSubindoForte ? 'VERMELHO' : s.atrasoMedioDias >= 8 || atrasoSubindoModerado ? 'AMARELO' : 'VERDE',
    resumo:
      variacaoAtrasoMedio !== null
        ? `Atraso médio em ${s.atrasoMedioDias} dias — ${variacaoAtrasoMedio >= 0 ? 'subiu' : 'caiu'} ${Math.abs(variacaoAtrasoMedio).toFixed(0)}% nas últimas semanas (${atrasoMedioBase!.toFixed(0)} → ${s.atrasoMedioDias} dias).`
        : `Atraso médio de pagamento: ${s.atrasoMedioDias} dias.`,
    dado: { tipo: 'tendencia', serie: serieAtrasoMedio, variacaoPerc: variacaoAtrasoMedio },
  })

  // 11. Evolução de Restritivos
  const serieRestritivos = serieRecente.map((snap) => snap.restritivos)
  const restritivosNovos = ant ? s.restritivos - ant.restritivos : 0
  resultado.push({
    item: 'EVOLUCAO_RESTRITIVOS',
    gravidade: restritivosNovos > 0 ? 'VERMELHO' : s.restritivos > 0 ? 'AMARELO' : 'VERDE',
    resumo: restritivosNovos > 0 ? `${restritivosNovos} novo(s) restritivo(s) esta semana (total: ${s.restritivos}).` : s.restritivos > 0 ? `${s.restritivos} restritivo(s) em aberto, sem novidade na semana.` : 'Sem restritivos.',
    dado: { tipo: 'tendencia', serie: serieRestritivos, variacaoPerc: ant && ant.restritivos > 0 ? (restritivosNovos / ant.restritivos) * 100 : null },
  })

  // 12. Aging da Carteira
  resultado.push({
    item: 'AGING_CARTEIRA',
    gravidade: s.agingCarteiraDias > 120 ? 'VERMELHO' : s.agingCarteiraDias > 60 ? 'AMARELO' : 'VERDE',
    resumo: `Aging da carteira: ${s.agingCarteiraDias} dias.`,
  })

  // 13. Praça de pagamento — sem fonte de dado estruturada no sistema hoje.
  resultado.push({ item: 'PRACA_PAGAMENTO', gravidade: SEM_DADO, resumo: 'Sem dado estruturado no sistema — registrar parecer manualmente com base na carteira analisada.' })

  // 14. Plano de Ação / Nova Decisão
  const planoAtrasado = planos.find((p) => p.status === 'ATRASADO')
  const planoEmDia = planos.find((p) => p.status === 'EM_DIA')
  const planoConcluido = planos.find((p) => p.status === 'CONCLUIDO')
  const planoRelevante = planoAtrasado ?? planoEmDia ?? planoConcluido ?? null
  resultado.push({
    item: 'PLANO_ACAO_NOVA_DECISAO',
    gravidade: planoAtrasado ? 'VERMELHO' : planoEmDia ? 'AMARELO' : 'VERDE',
    resumo: planoAtrasado
      ? `Plano de ação atrasado: "${planoAtrasado.decisaoAtual}" (prazo ${planoAtrasado.dataLimite}).`
      : planoEmDia
        ? `Plano de ação em andamento: "${planoEmDia.decisaoAtual}" (prazo ${planoEmDia.dataLimite}).`
        : 'Sem plano de ação pendente no momento.',
    dado: planoRelevante ? { tipo: 'statusPlano', status: planoRelevante.status } : undefined,
  })

  // 15. Eventos (alertas abertos)
  const vermelhos = alertas.filter((a) => a.gravidade === 'VERMELHO')
  const amarelos = alertas.filter((a) => a.gravidade === 'AMARELO')
  const verdes = alertas.filter((a) => a.gravidade === 'VERDE')
  resultado.push({
    item: 'EVENTOS',
    gravidade: vermelhos.length > 0 ? 'VERMELHO' : amarelos.length > 0 ? 'AMARELO' : 'VERDE',
    resumo: alertas.length > 0 ? `${alertas.length} alerta(s) em aberto: ${alertas.slice(0, 3).map((a) => a.tipo).join('; ')}${alertas.length > 3 ? '…' : ''}.` : 'Sem alertas em aberto.',
    dado:
      alertas.length > 0
        ? {
            tipo: 'categorias',
            itens: [
              { label: 'Vermelho', valor: vermelhos.length, exibicao: String(vermelhos.length), cor: 'VERMELHO' as Gravidade },
              { label: 'Amarelo', valor: amarelos.length, exibicao: String(amarelos.length), cor: 'AMARELO' as Gravidade },
              { label: 'Verde', valor: verdes.length, exibicao: String(verdes.length), cor: 'VERDE' as Gravidade },
            ].filter((i) => i.valor > 0),
          }
        : undefined,
  })

  // 16. Dados transacionais da conta movimento — cruza os últimos 6 meses de
  // movimento (entradas, saídas, frequência, maior pagamento) pra checar se
  // o cliente ainda movimenta a conta com regularidade.
  if (analiseTransacional) {
    resultado.push({
      item: 'DADOS_TRANSACIONAIS_CONTA_MOVIMENTO',
      gravidade: analiseTransacional.gravidade,
      resumo: analiseTransacional.resumo,
      dado: { tipo: 'tendencia', serie: analiseTransacional.meses.map((m) => m.volume), variacaoPerc: analiseTransacional.variacaoVolumePerc },
    })
  } else {
    resultado.push({ item: 'DADOS_TRANSACIONAIS_CONTA_MOVIMENTO', gravidade: SEM_DADO, resumo: 'Sem histórico de movimento de conta disponível para este cliente ainda.' })
  }

  // 17. Parecer Jurídico
  if (cliente.status === 'JURIDICO' && juridico) {
    resultado.push({
      item: 'PARECER_JURIDICO',
      gravidade: juridico.status === 'EM_ANDAMENTO' ? 'VERMELHO' : juridico.status === 'ACORDO' ? 'AMARELO' : 'VERDE',
      resumo: `Caso em ${juridico.status === 'EM_ANDAMENTO' ? 'andamento' : juridico.status === 'ACORDO' ? 'acordo' : 'encerrado'} — saldo em aberto ${formatarMoeda(juridico.saldo)}. Próximo passo: ${juridico.proximoPasso}.`,
      dado: { tipo: 'statusJuridico', status: juridico.status },
    })
  } else {
    const precisaAtencao = s.restritivos > 0 || percVencido > 15
    resultado.push({
      item: 'PARECER_JURIDICO',
      gravidade: precisaAtencao ? 'AMARELO' : 'VERDE',
      resumo: precisaAtencao
        ? 'Sem processo aberto, mas restritivos e/ou vencido elevado indicam avaliação jurídica preventiva.'
        : 'Sem indícios que demandem parecer jurídico nesta semana.',
      dado: { tipo: 'statusJuridico', status: precisaAtencao ? 'ATENCAO_PREVENTIVA' : 'SEM_PROCESSO' },
    })
  }

  // Garante a ordem oficial do roteiro independentemente da ordem de push acima.
  const porChave = new Map(resultado.map((r) => [r.item, r]))
  return ITENS_CHECKLIST.map(({ chave }) => porChave.get(chave)!)
}
