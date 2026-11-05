import type { Alerta, ChaveItemChecklist, Cliente, Gravidade, Juridico, PlanoAcao, SnapshotSemanal, StatusPlano } from '../models/types'
import { diasEntre, formatarDias, formatarMoeda, formatarPercentual } from '../utils/formatters'
import type { AnaliseTransacional } from './motorTransacional'
import { compararRestritivos, descreverVariacao, totalRestritivos, type LinhaRestritivo } from './restritivos'
import type { BitfinAging, BitfinEvento, ManifestoContaFoto } from '../bitfin/foto'

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
  { chave: 'SITUACAO_ATUAL', label: 'Status atual do cliente (o que mudou na semana)' },
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
  { titulo: 'Governança', itens: ['SITUACAO_ATUAL', 'PLANO_ACAO_NOVA_DECISAO', 'EVENTOS', 'DADOS_TRANSACIONAIS_CONTA_MOVIMENTO', 'PARECER_JURIDICO'] },
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
  | { tipo: 'manifesto'; total: number; perc: number | null; baseRisco: number; tipos: CategoriaManifesto[]; todas: CategoriaManifesto[] }

/** Categoria do manifesto (mesma ordem e nomes da tela do Bitfin). */
export interface CategoriaManifesto {
  chave: keyof Omit<ManifestoContaFoto, 'contaOperacionalId' | 'produto' | 'noManifesto' | 'risco'>
  label: string
  descricao: string
  valor: number
  perc: number | null
}

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
  /** Restritivos por tipo da semana e da anterior (quando houver). */
  restritivos?: { atual: LinhaRestritivo[]; anterior: LinhaRestritivo[] | null }
  /** 1.2: dados da foto do Bitfin. `null` = cliente sem foto (fail-closed);
   * ausente = chamada anterior à 1.2 (mantém o comportamento antigo). */
  bitfin?: {
    tiradaEm: string
    eventos: BitfinEvento[]
    limite: { total: number; origem: 'PROPOSTA' | 'PRODUTOS' | 'SEM_LIMITE'; validade: string | null }
    /** Vencimentário do Bitfin (a vencer e vencido por faixa). `null` = não veio para este cliente. Ausente = foto antiga. */
    aging?: BitfinAging | null
    /** Manifesto por conta, da foto (contas fora do manifesto marcadas). */
    manifesto?: { baseRisco: number; contas: ManifestoContaFoto[] }
  } | null
}

const SEM_DADO: SugestaoChecklist['gravidade'] = 'AMARELO'

/** Categorias do manifesto, na ordem da tela do Bitfin. `problema`: entram na
 * soma do card (decisão de 05/11: os 4 tipos). */
export const CATEGORIAS_MANIFESTO: { chave: CategoriaManifesto['chave']; label: string; descricao: string; problema: boolean }[] = [
  { chave: 'semAtuacao', label: 'Sem Atuação', descricao: 'Título ainda sem nenhuma manifestação do sacado nem atuação da equipe.', problema: false },
  { chave: 'inacessivel', label: 'Inacessível', descricao: 'Não foi possível consultar a manifestação do título (documento sem acesso).', problema: false },
  { chave: 'naoConfirma', label: 'Sacado não Confirma', descricao: 'O sacado foi contatado e não confirmou a operação.', problema: false },
  { chave: 'promessa', label: 'Promessa de Pagamento', descricao: 'O sacado prometeu pagar o título.', problema: false },
  { chave: 'transacaoDesconhecida', label: 'Transação Desconhecida', descricao: 'O sacado declarou desconhecer a operação (não reconhece a nota/duplicata).', problema: true },
  { chave: 'lastroInconsistente', label: 'Lastro Inconsistente', descricao: 'O documento que dá lastro ao título não confere (divergente, cancelado ou inexistente).', problema: true },
  { chave: 'naoConcluida', label: 'Transação não Concluída', descricao: 'O sacado informou que a operação não foi realizada (mercadoria ou serviço não entregue).', problema: true },
  { chave: 'protestado', label: 'Protestado', descricao: 'Título enviado a protesto em cartório.', problema: true },
  { chave: 'ciencia', label: 'Ciência da Transação', descricao: 'O sacado declarou ciência da operação, sem confirmá-la ainda.', problema: false },
  { chave: 'emAndamento', label: 'Transação em Andamento', descricao: 'Manifestação em andamento (entrega ou serviço ainda em curso).', problema: false },
  { chave: 'concluida', label: 'Transação Concluída', descricao: 'O sacado confirmou a operação.', problema: false },
]

/** Manifesto do cliente pela foto: soma das contas que entram no manifesto. */
export function resumirManifesto(m: { baseRisco: number; contas: ManifestoContaFoto[] }) {
  const contas = m.contas.filter((c) => c.noManifesto)
  const perc = (v: number) => (m.baseRisco > 0 ? Math.round((v / m.baseRisco) * 10000) / 100 : null)
  const todas: CategoriaManifesto[] = CATEGORIAS_MANIFESTO.map((cat) => {
    const valor = Math.round(contas.reduce((t, c) => t + (c[cat.chave] ?? 0), 0) * 100) / 100
    return { chave: cat.chave, label: cat.label, descricao: cat.descricao, valor, perc: perc(valor) }
  })
  const problemas = new Set(CATEGORIAS_MANIFESTO.filter((c) => c.problema).map((c) => c.chave))
  const tipos = todas.filter((c) => problemas.has(c.chave))
  const total = Math.round(tipos.reduce((t, c) => t + c.valor, 0) * 100) / 100
  return { total, perc: perc(total), baseRisco: m.baseRisco, tipos, todas }
}

export interface FaixaVencimentario {
  grupo: 'A_VENCER' | 'VENCIDO'
  faixa: string
  valor: number
  /** Vencido há mais de 90 dias (crítico). */
  acima90: boolean
}

/** Vencimentário (aging) do Bitfin em faixas, na ordem de leitura do comitê:
 * a vencer da mais curta à mais longa, depois o vencido do mais recente ao mais antigo. */
export function faixasVencimentario(a: BitfinAging): FaixaVencimentario[] {
  return [
    { grupo: 'A_VENCER', faixa: 'até 30 dias', valor: a.vencer.ate30, acima90: false },
    { grupo: 'A_VENCER', faixa: '31 a 60 dias', valor: a.vencer.de31a60, acima90: false },
    { grupo: 'A_VENCER', faixa: '61 a 90 dias', valor: a.vencer.de61a90, acima90: false },
    { grupo: 'A_VENCER', faixa: '91 a 180 dias', valor: a.vencer.de91a180, acima90: false },
    { grupo: 'A_VENCER', faixa: '181 a 360 dias', valor: a.vencer.de181a360, acima90: false },
    { grupo: 'A_VENCER', faixa: 'acima de 360 dias', valor: a.vencer.acima360, acima90: false },
    { grupo: 'VENCIDO', faixa: '6 a 30 dias', valor: a.vencido.de6a30, acima90: false },
    { grupo: 'VENCIDO', faixa: '31 a 60 dias', valor: a.vencido.de31a60, acima90: false },
    { grupo: 'VENCIDO', faixa: '61 a 90 dias', valor: a.vencido.de61a90, acima90: false },
    { grupo: 'VENCIDO', faixa: '91 a 180 dias', valor: a.vencido.de91a180, acima90: true },
    { grupo: 'VENCIDO', faixa: '181 a 360 dias', valor: a.vencido.de181a360, acima90: true },
    { grupo: 'VENCIDO', faixa: 'acima de 360 dias', valor: a.vencido.acima360, acima90: true },
  ]
}

/** Calcula, para um cliente, a sugestão automática (gravidade + resumo +
 * dado visual) de cada item do checklist — cruzando sempre dado real da
 * posição da semana. Itens sem uma fonte de dado estruturada no sistema
 * (praça de pagamento, dados transacionais) voltam com um aviso pedindo o
 * preenchimento manual, em vez de fingir um "verde" que não foi checado. */
export function sugerirChecklist(params: ParametrosSugestao): SugestaoChecklist[] {
  const { cliente, snapshotAtual: s, snapshotAnterior: ant, snapshotMesAnterior: mes, serieRecente, planos, alertas, juridico, analiseTransacional, restritivos } = params

  if (!s) {
    return ITENS_CHECKLIST.map(({ chave }) => ({ item: chave, gravidade: 'AMARELO', resumo: 'Sem posição da carteira para esta semana ainda.' }))
  }

  const percVencido = s.riscoCliente > 0 ? (s.vencidoOficial / s.riscoCliente) * 100 : 0
  const resultado: SugestaoChecklist[] = []

  // 0. Status atual — sempre texto do executivo (o "Satus Atual" da base do comitê).
  resultado.push({ item: 'SITUACAO_ATUAL', gravidade: SEM_DADO, resumo: 'Registrar o status atual do cliente: o que mudou na semana, contatos feitos e providências.' })

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

  // 2. Limite Consumido — 1.2: mostra o limite do cliente vindo do Bitfin.
  // Risco sem limite vigente nunca aparece como "0% consumido" (fail-closed).
  const limiteBitfin = params.bitfin?.limite
  const semLimite = s.limiteGlobal <= 0 && s.riscoCliente > 0
  resultado.push({
    item: 'LIMITE_CONSUMIDO',
    gravidade: semLimite || s.percConsumoLimite >= 100 ? 'VERMELHO' : s.percConsumoLimite >= 85 ? 'AMARELO' : 'VERDE',
    resumo: semLimite
      ? `Sem limite vigente${limiteBitfin ? ' no Bitfin' : ''} para um risco de ${formatarMoeda(s.riscoCliente)}.`
      : `Limite do cliente${limiteBitfin ? ' (Bitfin' + (limiteBitfin.origem === 'PROPOSTA' ? `, proposta vigente${limiteBitfin.validade ? ` até ${limiteBitfin.validade.split('-').reverse().join('/')}` : ''}` : ', soma dos produtos') + ')' : ''}: ${formatarMoeda(s.limiteGlobal)} · ${formatarPercentual(s.percConsumoLimite)} consumido (risco ${formatarMoeda(s.riscoCliente)}).`,
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
  // 1.2: prazo ausente (cliente sem operação de duplicata nem de Nota
  // Comercial) é "não informado", nunca 0 dias verde.
  const seriePrazoMedio = serieRecente.map((snap) => snap.prazoMedioCarteiraDias).filter((v): v is number => v !== null)
  if (s.prazoMedioCarteiraDias === null) {
    resultado.push({ item: 'PRAZO_MEDIO_CARTEIRA', gravidade: SEM_DADO, resumo: 'Prazo médio não informado: sem operação de duplicata, cheque, contrato ou Nota Comercial.' })
  } else {
    const prazoAtual = s.prazoMedioCarteiraDias
    const prazoMedioBase = seriePrazoMedio.length > 1 ? seriePrazoMedio[0] : null
    const variacaoPrazoMedio = prazoMedioBase && prazoMedioBase > 0 ? ((prazoAtual - prazoMedioBase) / prazoMedioBase) * 100 : null
    const prazoSubindoForte = variacaoPrazoMedio !== null && variacaoPrazoMedio >= 25
    const prazoSubindoModerado = variacaoPrazoMedio !== null && variacaoPrazoMedio >= 10
    resultado.push({
      item: 'PRAZO_MEDIO_CARTEIRA',
      gravidade: prazoSubindoForte || prazoAtual > 90 ? 'VERMELHO' : prazoSubindoModerado || prazoAtual > 75 ? 'AMARELO' : 'VERDE',
      resumo:
        variacaoPrazoMedio !== null
          ? `Prazo médio em ${formatarDias(prazoAtual)} — ${variacaoPrazoMedio >= 0 ? 'subiu' : 'caiu'} ${Math.abs(variacaoPrazoMedio).toFixed(0)}% nas últimas semanas (${prazoMedioBase!.toFixed(0)} → ${formatarDias(prazoAtual)}).`
          : `Prazo médio da carteira: ${formatarDias(prazoAtual)}.`,
      dado: { tipo: 'tendencia', serie: seriePrazoMedio, variacaoPerc: variacaoPrazoMedio },
    })
  }

  // 8. Liquidez 15/30/60
  resultado.push({
    item: 'LIQUIDEZ_15_30_60',
    gravidade: s.il30 === null ? 'AMARELO' : s.il30 < 60 ? 'VERMELHO' : s.il30 < 80 ? 'AMARELO' : 'VERDE',
    resumo: `${s.il30 === null ? 'IL 30 dias sem base' : `IL 30 dias em ${formatarPercentual(s.il30)}`} (IL 60: ${s.il60 === null ? 'sem base' : formatarPercentual(s.il60)}). Liquidado no período: ${s.liquidadoNoPeriodo === null ? 'não informado' : formatarMoeda(s.liquidadoNoPeriodo)}${s.recompras > 0 ? ` · Recompras: ${formatarMoeda(s.recompras)} (${s.motivoRecompra ?? 'motivo não informado'})` : ''}.`,
    dado: {
      tipo: 'percentuais',
      itens: [
        { label: 'IL 30', valor: s.il30 },
        { label: 'IL 60', valor: s.il60 },
        { label: 'IL 90', valor: s.il90 },
      ].filter((i): i is { label: string; valor: number } => i.valor !== null && i.valor !== undefined),
    },
  })

  // 9. Manifestos — 1.4.3: soma dos 4 tipos (transação desconhecida, lastro
  // inconsistente, transação não concluída e protestado), pela foto do Bitfin,
  // com cada categoria no card. Sem a foto: posição semanal (sem protestado).
  if (params.bitfin?.manifesto) {
    const r = resumirManifesto(params.bitfin.manifesto)
    const lastro = r.tipos.find((t) => t.chave === 'lastroInconsistente')!.valor
    const desconhecida = r.tipos.find((t) => t.chave === 'transacaoDesconhecida')!.valor
    resultado.push({
      item: 'MANIFESTOS',
      gravidade: lastro > 0 || desconhecida > 0 || (r.perc ?? 0) >= 5 ? 'VERMELHO' : r.total > 0 ? 'AMARELO' : 'VERDE',
      resumo:
        r.baseRisco <= 0
          ? 'Sem carteira com manifesto (só Nota Comercial, Confissão de Dívida ou Cobrança Simples).'
          : r.total > 0
            ? `${formatarMoeda(r.total)} em problemas de manifesto (${formatarPercentual(r.perc ?? 0)} do risco).`
            : 'Sem transação desconhecida, lastro inconsistente, transação não concluída ou protesto.',
      dado: r.baseRisco > 0 ? { tipo: 'manifesto', ...r } : undefined,
    })
  } else {
  const manifestos = [
    { label: 'Transação desconhecida', valor: s.manifestoTransacaoDesconhecida },
    { label: 'Lastro inconsistente', valor: s.manifestoLastroInconsistente },
    { label: 'Transação não concluída', valor: s.manifestoTransacaoNaoConcluida },
  ].filter((m) => m.valor > 0)
  const totalManifestos = manifestos.reduce((soma, m) => soma + m.valor, 0)
  resultado.push({
    item: 'MANIFESTOS',
    gravidade: s.manifestoLastroInconsistente > 0 || s.manifestoTransacaoDesconhecida > 0 ? 'VERMELHO' : totalManifestos > 0 ? 'AMARELO' : 'VERDE',
    resumo: totalManifestos > 0 ? `${formatarMoeda(totalManifestos)} em problemas de manifesto (protestado não informado: sem foto do Bitfin).` : 'Sem problemas de manifesto na semana (protestado não informado: sem foto do Bitfin).',
    dado:
      manifestos.length > 0
        ? { tipo: 'categorias', itens: manifestos.map((m) => ({ ...m, exibicao: formatarMoeda(m.valor), cor: 'VERMELHO' as Gravidade })) }
        : undefined,
  })
  }

  // 10. Comportamento no Calendário — mesma lógica: compara com o início da
  // janela recente pra ver se o atraso vem subindo (piorando) ou mudou de rota.
  // 1.2: sem título liquidado na janela de 30 dias o atraso é "não informado".
  const serieAtrasoMedio = serieRecente.map((snap) => snap.atrasoMedioDias).filter((v): v is number => v !== null)
  if (s.atrasoMedioDias === null) {
    resultado.push({ item: 'COMPORTAMENTO_CALENDARIO', gravidade: SEM_DADO, resumo: 'Atraso médio não informado: nenhum título liquidado na janela de 30 dias.' })
  } else {
    const atrasoAtual = s.atrasoMedioDias
    const atrasoMedioBase = serieAtrasoMedio.length > 1 ? serieAtrasoMedio[0] : null
    const variacaoAtrasoMedio = atrasoMedioBase && atrasoMedioBase > 0 ? ((atrasoAtual - atrasoMedioBase) / atrasoMedioBase) * 100 : null
    const atrasoSubindoForte = variacaoAtrasoMedio !== null && variacaoAtrasoMedio >= 25
    const atrasoSubindoModerado = variacaoAtrasoMedio !== null && variacaoAtrasoMedio >= 10
    resultado.push({
      item: 'COMPORTAMENTO_CALENDARIO',
      gravidade: atrasoAtual >= 20 || atrasoSubindoForte ? 'VERMELHO' : atrasoAtual >= 8 || atrasoSubindoModerado ? 'AMARELO' : 'VERDE',
      resumo:
        variacaoAtrasoMedio !== null
          ? `Atraso médio em ${formatarDias(atrasoAtual)} — ${variacaoAtrasoMedio >= 0 ? 'subiu' : 'caiu'} ${Math.abs(variacaoAtrasoMedio).toFixed(0)}% nas últimas semanas (${atrasoMedioBase!.toFixed(0)} → ${formatarDias(atrasoAtual)}).`
          : `Atraso médio de pagamento: ${formatarDias(atrasoAtual)}.`,
      dado: { tipo: 'tendencia', serie: serieAtrasoMedio, variacaoPerc: variacaoAtrasoMedio },
    })
  }

  // 11. Evolução de Restritivos
  const serieRestritivos = serieRecente.map((snap) => snap.restritivos)
  const restritivosNovos = ant ? s.restritivos - ant.restritivos : 0
  if (restritivos && restritivos.atual.length > 0) {
    const variacoes = compararRestritivos(restritivos.atual, restritivos.anterior)
    const pioras = variacoes.filter((v) => v.piorou)
    const total = totalRestritivos(restritivos.atual)
    resultado.push({
      item: 'EVOLUCAO_RESTRITIVOS',
      gravidade: pioras.length > 0 ? 'VERMELHO' : total.quantidade > 0 ? 'AMARELO' : 'VERDE',
      resumo:
        pioras.length > 0
          ? `Piora no quadro restritivo: ${pioras.map(descreverVariacao).join('; ')}.`
          : `${total.quantidade} ocorrência(s), ${formatarMoeda(total.valor)}${restritivos.anterior ? ' — sem piora frente à semana anterior' : ''}.`,
      dado: {
        tipo: 'categorias',
        itens: variacoes.map((v) => ({ label: v.label, valor: v.valorAtual, exibicao: `${v.quantidadeAtual} · ${formatarMoeda(v.valorAtual)}`, ...(v.piorou ? { cor: 'VERMELHO' as const } : {}) })),
      },
    })
  } else {
    resultado.push({
      item: 'EVOLUCAO_RESTRITIVOS',
      gravidade: restritivosNovos > 0 ? 'VERMELHO' : s.restritivos > 0 ? 'AMARELO' : 'VERDE',
      resumo: restritivosNovos > 0 ? `${restritivosNovos} novo(s) restritivo(s) esta semana (total: ${s.restritivos}).` : s.restritivos > 0 ? `${s.restritivos} restritivo(s) em aberto, sem novidade na semana.` : 'Sem restritivos.',
      dado: { tipo: 'tendencia', serie: serieRestritivos, variacaoPerc: ant && ant.restritivos > 0 ? (restritivosNovos / ant.restritivos) * 100 : null },
    })
  }

  // 12. Aging da Carteira — 1.4.1: o vencimentário do Bitfin (a vencer e vencido
  // por faixa). Sem foto ou sem vencimentário: "não conferido", nunca "0 dias".
  if (params.bitfin !== undefined && (params.bitfin === null || params.bitfin.aging !== undefined)) {
    const aging = params.bitfin?.aging ?? null
    if (!aging) {
      resultado.push({
        item: 'AGING_CARTEIRA',
        gravidade: SEM_DADO,
        resumo: params.bitfin === null ? 'Sem foto do Bitfin para este cliente: vencimentário não conferido.' : 'O Bitfin não trouxe o vencimentário deste cliente: conferir no Bitfin.',
      })
    } else {
      const faixas = faixasVencimentario(aging)
      const aVencer = faixas.filter((f) => f.grupo === 'A_VENCER').reduce((t, f) => t + f.valor, 0)
      const vencido = faixas.filter((f) => f.grupo === 'VENCIDO').reduce((t, f) => t + f.valor, 0)
      const vencidoAcima90 = faixas.filter((f) => f.acima90).reduce((t, f) => t + f.valor, 0)
      const total = aVencer + vencido
      const comValor = faixas.filter((f) => f.valor > 0)
      resultado.push({
        item: 'AGING_CARTEIRA',
        gravidade: vencidoAcima90 > 0 ? 'VERMELHO' : vencido > 0 ? 'AMARELO' : 'VERDE',
        resumo:
          total === 0
            ? 'Sem títulos a vencer ou vencidos no vencimentário do Bitfin.'
            : `A vencer ${formatarMoeda(aVencer)} · Vencido ${formatarMoeda(vencido)}${vencidoAcima90 > 0 ? ` (${formatarMoeda(vencidoAcima90)} há mais de 90 dias)` : ''}.`,
        dado:
          comValor.length > 0
            ? {
                tipo: 'categorias',
                itens: comValor.map((f) => ({
                  label: `${f.grupo === 'A_VENCER' ? 'A vencer' : 'Vencido'} ${f.faixa}`,
                  valor: f.valor,
                  exibicao: formatarMoeda(f.valor),
                  cor: f.grupo === 'A_VENCER' ? 'VERDE' : f.acima90 ? 'VERMELHO' : 'AMARELO',
                })),
              }
            : undefined,
      })
    }
  } else {
    resultado.push({
      item: 'AGING_CARTEIRA',
      gravidade: s.agingCarteiraDias > 120 ? 'VERMELHO' : s.agingCarteiraDias > 60 ? 'AMARELO' : 'VERDE',
      resumo: `Aging da carteira: ${s.agingCarteiraDias} dias.`,
    })
  }

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

  // 15. Eventos — 1.2: só os eventos do Bitfin da última semana.
  if (params.bitfin !== undefined) {
    const eventos = params.bitfin?.eventos ?? []
    const porCategoria = new Map<string, number>()
    for (const e of eventos) porCategoria.set(e.categoria ?? 'Sem categoria', (porCategoria.get(e.categoria ?? 'Sem categoria') ?? 0) + 1)
    resultado.push({
      item: 'EVENTOS',
      gravidade: params.bitfin === null ? 'AMARELO' : eventos.length > 0 ? 'AMARELO' : 'VERDE',
      resumo:
        params.bitfin === null
          ? 'Sem foto do Bitfin para este cliente: eventos da semana não conferidos.'
          : eventos.length > 0
            ? `${eventos.length} evento(s) no Bitfin na última semana: ${eventos.slice(0, 3).map((e) => e.titulo).join('; ')}${eventos.length > 3 ? '…' : ''}.`
            : 'Nenhum evento no Bitfin na última semana.',
      dado:
        eventos.length > 0
          ? { tipo: 'categorias', itens: [...porCategoria].map(([label, valor]) => ({ label, valor, exibicao: String(valor) })) }
          : undefined,
    })
  } else {
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
  }

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
