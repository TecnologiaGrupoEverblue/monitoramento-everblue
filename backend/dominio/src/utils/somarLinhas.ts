/**
 * Duas ou mais linhas da mesma planilha que pertencem ao MESMO cliente do
 * sistema (ex.: matriz e filial com CNPJs diferentes, cadastradas como um
 * cliente só) viram uma única posição semanal — a soma delas.
 *
 * Regra decidida em 23/10/2026 (caso Mauro Siqueira de Moura Junior Ltda,
 * linhas 20 e 21): nenhum risco fica de fora da semana.
 *
 *   - valores em R$: somados;
 *   - percentuais: média ponderada (pelo risco; % liquidado no prazo pelo
 *     liquidado no período), só sobre as linhas que têm o dado;
 *   - status do cliente e da proposta: o pior prevalece;
 *   - datas de vencido e validade da proposta: a mais antiga;
 *   - aging e atraso médio: o maior (conservador);
 *   - restritivos por tipo: quantidades e valores somados;
 *   - cadastro (nome, grupo, gerente, plataforma, carteira, setor): da
 *     primeira linha, com aviso quando as linhas divergem.
 */
import type { StatusCliente, StatusProposta } from '../models/types'
import type { LinhaRestritivo } from '../regras/restritivos'
import { normalizarCnpj } from './cnpj'
import type { LinhaValidada } from './planilhaImportacao'

const PESO_STATUS: Record<StatusCliente, number> = { NORMAL: 0, MONITORAMENTO: 1, SAIDA_DE_RISCO: 2, RECUPERACAO_DE_CREDITO: 3, JURIDICO: 4 }
const PESO_PROPOSTA: Record<StatusProposta, number> = { APROVADA: 0, SEM_PROPOSTA: 1, EM_ANALISE: 2, VENCIDA: 3, REPROVADA: 4 }

const soma = (ls: LinhaValidada[], f: (l: LinhaValidada) => number) => ls.reduce((s, l) => s + (f(l) || 0), 0)

/** Soma de campo opcional: `null` só se nenhuma linha trouxe o dado. */
function somaOpcional(ls: LinhaValidada[], f: (l: LinhaValidada) => number | null | undefined): number | null {
  const vals = ls.map(f).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  return vals.length === 0 ? null : vals.reduce((s, v) => s + v, 0)
}

/** Média ponderada sobre as linhas com o dado; peso zero em todas → média simples. */
function ponderada(ls: LinhaValidada[], f: (l: LinhaValidada) => number | null | undefined, peso: (l: LinhaValidada) => number): number | null {
  const com = ls.filter((l) => {
    const v = f(l)
    return typeof v === 'number' && Number.isFinite(v)
  })
  if (com.length === 0) return null
  const pesoTotal = com.reduce((s, l) => s + Math.max(peso(l) || 0, 0), 0)
  if (pesoTotal <= 0) return com.reduce((s, l) => s + (f(l) as number), 0) / com.length
  return com.reduce((s, l) => s + (f(l) as number) * Math.max(peso(l) || 0, 0), 0) / pesoTotal
}

const maisAntiga = (datas: (string | null | undefined)[]) =>
  datas.filter((d): d is string => Boolean(d)).sort()[0] ?? null

function unicos<T>(itens: T[], chave: (t: T) => string = (t) => String(t)): T[] {
  const vistos = new Set<string>()
  return itens.filter((t) => {
    const k = chave(t)
    if (vistos.has(k)) return false
    vistos.add(k)
    return true
  })
}

function somarRestritivos(ls: LinhaValidada[]): LinhaRestritivo[] | null {
  const comDado = ls.filter((l) => l.restritivosPorTipo)
  if (comDado.length === 0) return null
  const porTipo = new Map<string, LinhaRestritivo>()
  for (const l of comDado) {
    for (const r of l.restritivosPorTipo!) {
      const atual = porTipo.get(r.tipo)
      porTipo.set(r.tipo, atual ? { ...atual, quantidade: atual.quantidade + r.quantidade, valor: atual.valor + r.valor } : { ...r })
    }
  }
  return [...porTipo.values()]
}

export function somarLinhasDoMesmoCliente(linhas: LinhaValidada[]): LinhaValidada {
  if (linhas.length === 0) throw new Error('somarLinhasDoMesmoCliente: nenhuma linha')
  const ls = [...linhas].sort((a, b) => a.linha - b.linha)
  if (ls.length === 1) return ls[0]
  const base = ls[0]
  const risco = (l: LinhaValidada) => l.riscoCliente

  const documentos = unicos(
    ls.flatMap((l) => (l.documentos && l.documentos.length > 0 ? l.documentos : [l.cnpj])),
    normalizarCnpj,
  )
  const numeros = ls.map((l) => l.linha)
  const rotulo = `${numeros.slice(0, -1).join(', ')} e ${numeros[numeros.length - 1]}`
  const avisos = [
    ...ls.flatMap((l) => l.avisos ?? []),
    `Linhas ${rotulo} são do mesmo cliente no sistema (${documentos.join(', ')}) e foram somadas numa única posição.`,
  ]
  const divergentes = (
    [
      ['grupo econômico', (l: LinhaValidada) => l.grupoEconomico],
      ['gerente', (l: LinhaValidada) => l.gerente],
      ['plataforma', (l: LinhaValidada) => l.plataforma],
      ['carteira', (l: LinhaValidada) => l.carteira ?? ''],
    ] as const
  )
    .filter(([, f]) => new Set(ls.map((l) => f(l).trim().toLowerCase())).size > 1)
    .map(([nome]) => nome)
  if (divergentes.length > 0) {
    avisos.push(`As linhas ${rotulo} divergem em ${divergentes.join(', ')}; valeu o da linha ${base.linha}.`)
  }

  const motivos = unicos(ls.map((l) => l.motivoRecompra?.trim()).filter((m): m is string => Boolean(m)))

  return {
    ...base,
    documentos,
    cnpj: documentos[0],
    produtos: unicos(ls.flatMap((l) => l.produtos)),
    status: ls.reduce((pior, l) => (PESO_STATUS[l.status] > PESO_STATUS[pior] ? l.status : pior), base.status),
    riscoCliente: soma(ls, risco),
    limiteGlobal: soma(ls, (l) => l.limiteGlobal),
    statusProposta: ls.reduce((pior, l) => (PESO_PROPOSTA[l.statusProposta] > PESO_PROPOSTA[pior] ? l.statusProposta : pior), base.statusProposta),
    validadeProposta: maisAntiga(ls.map((l) => l.validadeProposta)),
    trancheConsolidada: soma(ls, (l) => l.trancheConsolidada),
    valorEmAndamento: soma(ls, (l) => l.valorEmAndamento),
    vencidoOficial: soma(ls, (l) => l.vencidoOficial),
    vencidoDesde: maisAntiga(ls.map((l) => l.vencidoDesde)),
    agingCarteiraDias: Math.max(...ls.map((l) => l.agingCarteiraDias || 0)),
    prazoMedioCarteiraDias: ponderada(ls, (l) => l.prazoMedioCarteiraDias, risco) ?? null,
    il30: ponderada(ls, (l) => l.il30, risco),
    il60: ponderada(ls, (l) => l.il60, risco),
    il90: ponderada(ls, (l) => l.il90, risco),
    il120: ponderada(ls, (l) => l.il120, risco),
    il150: ponderada(ls, (l) => l.il150, risco),
    il180: ponderada(ls, (l) => l.il180, risco),
    manifestoPercSemAtuacao: ponderada(ls, (l) => l.manifestoPercSemAtuacao, risco) ?? null,
    manifestoInacessivel: soma(ls, (l) => l.manifestoInacessivel),
    manifestoNaoConfirma: soma(ls, (l) => l.manifestoNaoConfirma),
    manifestoTransacaoDesconhecida: soma(ls, (l) => l.manifestoTransacaoDesconhecida),
    manifestoLastroInconsistente: soma(ls, (l) => l.manifestoLastroInconsistente),
    manifestoTransacaoNaoConcluida: soma(ls, (l) => l.manifestoTransacaoNaoConcluida),
    liquidadoNoPeriodo: ls.every((l) => l.liquidadoNoPeriodo === null) ? null : soma(ls, (l) => l.liquidadoNoPeriodo ?? 0),
    recompras: soma(ls, (l) => l.recompras),
    motivoRecompra: motivos.length > 0 ? motivos.join('; ') : null,
    percLiquidadoNoPrazo: ponderada(ls, (l) => l.percLiquidadoNoPrazo, (l) => l.liquidadoNoPeriodo ?? 0) ?? null,
    atrasoMedioDias: ls.every((l) => l.atrasoMedioDias === null) ? null : Math.max(...ls.map((l) => l.atrasoMedioDias ?? 0)),
    restritivos: soma(ls, (l) => l.restritivos),
    prorrogacoesAcima60d: somaOpcional(ls, (l) => l.prorrogacoesAcima60d),
    operacoesMesAnterior: somaOpcional(ls, (l) => l.operacoesMesAnterior),
    operacoesMes: somaOpcional(ls, (l) => l.operacoesMes),
    restritivosPorTipo: somarRestritivos(ls),
    avisos,
    agingDerivadoDoVencido: ls.some((l) => l.agingDerivadoDoVencido),
  }
}
