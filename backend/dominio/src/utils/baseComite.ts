/**
 * Segundo layout de importação: a "Base Carteira - Monitoramento" trabalhada
 * pelo comitê (aba "Análise da Carteira"), aceita como ela é.
 *
 * Não existe uma segunda regra de negócio: a base é CONVERTIDA para o layout
 * do modelo oficial e segue pela mesma validação (`validarLinhasPlanilha`),
 * classificação e gravação. Este arquivo só sabe ler a base:
 *
 *   - acha o cabeçalho (não precisa estar na linha 1) e lê as colunas PELO
 *     NOME, com as variações conhecidas — colunas novas ou fora de ordem não
 *     quebram a carga; coluna essencial ausente recusa a carga;
 *   - converte o que a base escreve diferente do modelo (percentuais em
 *     fração, produtos por vírgula, status QUATTUOR, prorrogações e operações
 *     que só existem no texto dos Alertas, número com observação na célula);
 *   - não importa o que o sistema calcula (enquadramento, criticidade,
 *     alertas) nem o que o comitê registra nas telas (decisões, planos,
 *     responsáveis) — o sistema é a fonte desses dados;
 *   - cada conversão relevante vira AVISO na prévia, nunca silêncio.
 */
import { CAMPOS_IMPORTACAO, chaveTexto } from './planilhaImportacao'

export type FormatoImportacao = 'MODELO' | 'BASE_COMITE'

/** Nome da aba da base do comitê (a API procura por ele). */
export const ABA_BASE_COMITE = 'Análise da Carteira'

/** Colunas do modelo oficial — o resultado da conversão tem exatamente este cabeçalho. */
const COL = Object.fromEntries(CAMPOS_IMPORTACAO.map((c) => [c.chave, c.coluna])) as Record<string, string>

type Conversao = 'texto' | 'documentos' | 'produtos' | 'status' | 'proposta' | 'data' | 'moeda' | 'moedaObrigatoria' | 'fracao' | 'fracaoOuSemBase' | 'dias' | 'diasDecimal'

interface ColunaBase {
  /** Chave do campo no modelo (CAMPOS_IMPORTACAO). */
  chave: string
  /** Nomes aceitos na base (comparados sem acento, maiúsculas, espaços simples). */
  nomes: string[]
  conversao: Conversao
  /** Ausente na base = carga recusada. */
  essencial: boolean
}

const COLUNAS: ColunaBase[] = [
  { chave: 'nome', nomes: ['Cliente'], conversao: 'texto', essencial: true },
  { chave: 'documentos', nomes: ['Documento(s)', 'Documentos', 'Documento', 'CNPJ'], conversao: 'documentos', essencial: true },
  { chave: 'carteira', nomes: ['Carteira'], conversao: 'texto', essencial: true },
  { chave: 'grupoEconomico', nomes: ['Grupo Econômico / Unidade de análise', 'Grupo Econômico', 'Unidade de análise'], conversao: 'texto', essencial: true },
  { chave: 'gerente', nomes: ['Gerente'], conversao: 'texto', essencial: true },
  { chave: 'plataforma', nomes: ['Plataforma Comercial', 'Plataforma'], conversao: 'texto', essencial: false },
  { chave: 'setor', nomes: ['Setor'], conversao: 'texto', essencial: true },
  { chave: 'ramoAtividade', nomes: ['Ramo de atividade'], conversao: 'texto', essencial: true },
  { chave: 'produtos', nomes: ['Produtos'], conversao: 'produtos', essencial: true },
  { chave: 'status', nomes: ['Status do cliente'], conversao: 'status', essencial: true },
  { chave: 'riscoCliente', nomes: ['Risco do cliente'], conversao: 'moedaObrigatoria', essencial: true },
  { chave: 'limiteGlobal', nomes: ['Limite global'], conversao: 'moedaObrigatoria', essencial: true },
  { chave: 'statusProposta', nomes: ['Status da proposta'], conversao: 'proposta', essencial: true },
  { chave: 'validadeProposta', nomes: ['Validade', 'Validade da proposta'], conversao: 'data', essencial: true },
  { chave: 'trancheConsolidada', nomes: ['Tranche consolidada'], conversao: 'moeda', essencial: true },
  { chave: 'valorEmAndamento', nomes: ['Em andamento', 'Valor em andamento'], conversao: 'moeda', essencial: true },
  { chave: 'vencidoOficial', nomes: ['Vencido oficial'], conversao: 'moeda', essencial: true },
  { chave: 'vencidoDesde', nomes: ['Vencido desde'], conversao: 'data', essencial: true },
  { chave: 'prazoMedioCarteiraDias', nomes: ['Prazo médio carteira (dias)', 'Prazo médio da carteira (dias)'], conversao: 'dias', essencial: true },
  { chave: 'il30', nomes: ['IL 30d', 'IL 30 dias'], conversao: 'fracaoOuSemBase', essencial: true },
  { chave: 'il60', nomes: ['IL 60d', 'IL 60 dias'], conversao: 'fracaoOuSemBase', essencial: true },
  { chave: 'il90', nomes: ['IL 90d', 'IL 90 dias'], conversao: 'fracaoOuSemBase', essencial: true },
  { chave: 'il120', nomes: ['IL 120d', 'IL 120 dias'], conversao: 'fracaoOuSemBase', essencial: true },
  { chave: 'il150', nomes: ['IL 150d', 'IL 150 dias'], conversao: 'fracaoOuSemBase', essencial: true },
  { chave: 'il180', nomes: ['IL 180d', 'IL 180 dias'], conversao: 'fracaoOuSemBase', essencial: true },
  { chave: 'manifestoPercSemAtuacao', nomes: ['Sem atuação manifesto %', '% sem atuação de manifesto'], conversao: 'fracao', essencial: true },
  { chave: 'manifestoInacessivel', nomes: ['Inacessível R$'], conversao: 'moeda', essencial: true },
  { chave: 'manifestoNaoConfirma', nomes: ['Não confirma R$'], conversao: 'moeda', essencial: true },
  { chave: 'manifestoTransacaoDesconhecida', nomes: ['Transação desconhecida R$'], conversao: 'moeda', essencial: true },
  { chave: 'manifestoLastroInconsistente', nomes: ['Lastro inconsistente R$'], conversao: 'moeda', essencial: true },
  { chave: 'manifestoTransacaoNaoConcluida', nomes: ['Transação não concluída R$'], conversao: 'moeda', essencial: true },
  { chave: 'liquidadoNoPeriodo', nomes: ['Liquidado no export', 'Liquidado no período'], conversao: 'moeda', essencial: true },
  { chave: 'recompras', nomes: ['Recompras R$', 'Recompras'], conversao: 'moeda', essencial: true },
  { chave: 'percLiquidadoNoPrazo', nomes: ['% liquidado no prazo'], conversao: 'fracao', essencial: true },
  { chave: 'atrasoMedioDias', nomes: ['Atraso médio (dias)'], conversao: 'diasDecimal', essencial: true },
]
const COLUNA_ALERTAS = ['Alertas']

/** Calculadas pelo sistema ou registradas nas telas: lidas da base, nunca importadas. */
const NAO_IMPORTADAS = [
  'Prioridade', 'Satus Atual', 'Status Atual', 'Risco consolidado', 'Risco mês anterior', 'Variação de risco R$', 'Variação de risco %',
  'Consumo do limite %', 'Consumo da tranche %', 'Status da tranche', '% vencido', 'Aging resumido', 'IL médio', 'Tendência da liquidez',
  'Total problemas manifesto R$', 'Enquadramento', 'Criticidade', 'Quantidade de Alertas', 'Praça de Pagamento', 'Evolução do Quadro Restritivo',
  'Considerações sobre o Transacional', 'Decisão do comitê anterior + Data', 'Decisão do Comitê Atual + Data', 'Prazo para regularização',
  'Plano de Ação', 'Responsável por fazer acontecer', 'O que foi feito', 'O que não foi feito', 'Jurídico',
]

const norm = (v: unknown) => chaveTexto(String(v ?? '').replace(/[\u200b-\u200d\ufeff]/g, ''))

export interface ResultadoConversaoBase {
  /** Linhas no layout do modelo: cabeçalho + dados. */
  linhas: unknown[][]
  /** Linha do arquivo original de cada linha de dados. */
  linhasOrigem: number[]
  avisosPorLinha: string[][]
  colunasFaltando: string[]
  /** Resumo para a prévia (aba, cabeçalho, colunas não importadas, linhas descartadas). */
  observacoes: string[]
}

/** O conteúdo lido é o modelo oficial (cabeçalho na 1ª linha)? */
export function pareceModeloOficial(linhas: unknown[][]): boolean {
  const cab = new Set((linhas[0] ?? []).map((c) => String(c ?? '').trim()))
  return cab.has(COL.nome) && cab.has(COL.riscoCliente) && cab.has(COL.documentos)
}

/** Linha (0-based) do cabeçalho da base do comitê nas primeiras linhas, ou -1. */
export function localizarCabecalhoBase(linhas: unknown[][]): number {
  for (let i = 0; i < Math.min(linhas.length, 20); i++) {
    const cab = new Set((linhas[i] ?? []).map(norm))
    if (cab.has('CLIENTE') && cab.has('GERENTE') && ['DOCUMENTO(S)', 'DOCUMENTOS', 'DOCUMENTO', 'CNPJ'].some((n) => cab.has(n))) return i
  }
  return -1
}

const SEM_DADO = /^(SEM BASE|SEM HISTORICO|SEM DADOS?|N\/?A|-+)$/

/** Número no começo do texto ("55,6" ou "55,6\n\nobservação"). */
function numeroDoTexto(t: string): { valor: number; resto: string } | null {
  const m = t.match(/^\s*(-?[\d.]*\d(?:,\d+)?|-?\d+(?:\.\d+)?)(.*)$/s)
  if (!m) return null
  const bruto = m[1]
  // Vírgula = formato brasileiro; "10.000" (grupos de 3) = milhar; senão, ponto decimal.
  const brasileiro = bruto.includes(',') || /^-?\d{1,3}(\.\d{3})+$/.test(bruto)
  const valor = Number(brasileiro ? bruto.replace(/\./g, '').replace(',', '.') : bruto)
  return Number.isFinite(valor) ? { valor, resto: m[2].trim() } : null
}

const arred = (v: number, casas: number) => Math.round(v * 10 ** casas) / 10 ** casas
const brl = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })

function valorNumerico(bruto: unknown, rotulo: string, avisos: string[], opc: { semBase?: 'manter' | 'zero'; obrigatorio?: boolean }): number | string {
  if (typeof bruto === 'number') return bruto
  const t = String(bruto ?? '').replace(/[\u200b-\u200d\ufeff]/g, '').trim()
  if (t === '') {
    if (opc.semBase === 'manter') return ''
    if (opc.obrigatorio) return '' // a validação recusa: risco e limite vazios não viram 0
    return 0 // convenção da base: célula de valor vazia = sem movimento
  }
  if (SEM_DADO.test(chaveTexto(t))) {
    if (opc.semBase === 'manter') return 'SEM BASE'
    if (opc.obrigatorio) return t
    avisos.push(`"${rotulo}" está "${t}" na base: lançado 0.`)
    return 0
  }
  const n = numeroDoTexto(t)
  if (n && n.resto === '') return n.valor
  if (n) {
    avisos.push(`"${rotulo}" tem número com observação na célula: usado ${brl(n.valor)}; a observação não é importada.`)
    return n.valor
  }
  return t // texto sem número: a validação recusa a linha, com a mensagem do campo
}

function converterCelula(col: ColunaBase, bruto: unknown, rotulo: string, avisos: string[]): unknown {
  switch (col.conversao) {
    case 'texto':
      return String(bruto ?? '').replace(/[\u200b-\u200d\ufeff]/g, '').trim()
    case 'documentos':
      return bruto
    case 'produtos':
      return String(bruto ?? '')
        .replace(/\r\n?/g, '\n')
        .split(/[,;]/)
        .map((p) => p.trim())
        .filter(Boolean)
        .join(';')
    case 'status': {
      const s = norm(bruto)
      if (s === 'QUATTUOR') return 'NORMAL' // carteira apartada: contada nas observações da carga
      return bruto
    }
    case 'proposta':
      return bruto
    case 'data': {
      if (bruto instanceof Date || bruto === null || bruto === undefined || bruto === '') return bruto ?? ''
      const t = String(bruto).trim()
      if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t) && !/^\d{4}-\d{2}-\d{2}/.test(t) && !SEM_DADO.test(chaveTexto(t))) {
        avisos.push(`"${rotulo}" com texto que não é data ("${t.slice(0, 40)}"): ficou sem data.`)
      }
      return SEM_DADO.test(chaveTexto(t)) ? '' : t
    }
    case 'moeda':
    case 'moedaObrigatoria': {
      const v = valorNumerico(bruto, rotulo, avisos, { obrigatorio: col.conversao === 'moedaObrigatoria' })
      return typeof v === 'number' ? arred(v, 2) : v
    }
    case 'fracao':
    case 'fracaoOuSemBase': {
      // A base guarda percentuais em fração (0,81); o modelo, em pontos (81).
      const v = valorNumerico(bruto, rotulo, avisos, { semBase: col.conversao === 'fracaoOuSemBase' ? 'manter' : undefined })
      return typeof v === 'number' ? arred(v * 100, 2) : v
    }
    case 'dias': {
      const v = valorNumerico(bruto, rotulo, avisos, {})
      return typeof v === 'number' ? Math.round(v) : v
    }
    case 'diasDecimal': {
      const v = valorNumerico(bruto, rotulo, avisos, {})
      return typeof v === 'number' ? arred(v, 1) : v
    }
  }
}

const numeroBr = (t: string) => Number(t.replace(/\./g, '').replace(',', '.'))

/**
 * Converte as linhas lidas da aba "Análise da Carteira" para o layout do
 * modelo oficial. Função pura (nada é gravado aqui).
 */
export function converterBaseComite(linhas: unknown[][]): ResultadoConversaoBase {
  const iCab = localizarCabecalhoBase(linhas)
  if (iCab < 0) {
    return { linhas: [], linhasOrigem: [], avisosPorLinha: [], colunasFaltando: ['Cabeçalho da base do comitê (Cliente, Documento(s), Gerente)'], observacoes: [] }
  }
  const cabecalho = (linhas[iCab] ?? []).map(norm)
  const indice = (nomes: string[]) => {
    for (const n of nomes) {
      const i = cabecalho.indexOf(norm(n))
      if (i >= 0) return i
    }
    return -1
  }
  const posicao = new Map<string, number>()
  const faltando: string[] = []
  for (const c of COLUNAS) {
    const i = indice(c.nomes)
    if (i >= 0) posicao.set(c.chave, i)
    else if (c.essencial) faltando.push(c.nomes[0])
  }
  if (faltando.length > 0) {
    return { linhas: [], linhasOrigem: [], avisosPorLinha: [], colunasFaltando: faltando.map((n) => `${n} (base do comitê)`), observacoes: [] }
  }
  const iAlertas = indice(COLUNA_ALERTAS)
  const usadas = new Set([...posicao.values(), iAlertas])
  const conhecidasNaoImportadas = new Set(NAO_IMPORTADAS.map(norm))
  const naoImportadas: string[] = []
  const desconhecidas: string[] = []
  ;(linhas[iCab] ?? []).forEach((nome, i) => {
    const n = norm(nome)
    if (!n || usadas.has(i)) return
    if (conhecidasNaoImportadas.has(n)) naoImportadas.push(String(nome).trim())
    else desconhecidas.push(String(nome).trim())
  })

  const cabModelo = CAMPOS_IMPORTACAO.map((c) => c.coluna)
  const saida: unknown[][] = [cabModelo]
  const linhasOrigem: number[] = []
  const avisosPorLinha: string[][] = []
  let descartadas = 0
  let quattuor = 0

  for (let r = iCab + 1; r < linhas.length; r++) {
    const bruta = linhas[r] ?? []
    const celula = (chave: string) => bruta[posicao.get(chave)!]
    const cliente = String(celula('nome') ?? '').trim()
    const docs = String(celula('documentos') ?? '').replace(/[\u200b-\u200d\ufeff]/g, '').trim()
    if (!cliente && !docs) {
      if (bruta.some((v) => v !== null && v !== undefined && String(v).trim() !== '')) descartadas++
      continue
    }
    const avisos: string[] = []
    const valores: Record<string, unknown> = {}
    if (norm(celula('status')) === 'QUATTUOR') quattuor++
    for (const c of COLUNAS) {
      if (!posicao.has(c.chave)) continue
      valores[c.chave] = converterCelula(c, celula(c.chave), c.nomes[0], avisos)
    }
    // Plataforma comercial: a base não tem a coluna — vale a Carteira (como nas cargas anteriores).
    if (!posicao.has('plataforma')) valores.plataforma = valores.carteira
    // Só existem no texto dos Alertas da base.
    const alertas = iAlertas >= 0 ? String(bruta[iAlertas] ?? '') : ''
    const pr = alertas.match(/Prorroga[çc][õo]es acima de 60d:\s*R\$\s*([\d.]+(?:,\d+)?)/i)
    const op = alertas.match(/Queda nas opera[çc][õo]es:\s*R\$\s*([\d.]+(?:,\d+)?)\s*em\s+\S+\s*→\s*R\$\s*([\d.]+(?:,\d+)?)/i)
    valores.prorrogacoesAcima60d = pr ? numeroBr(pr[1]) : ''
    valores.operacoesMesAnterior = op ? numeroBr(op[1]) : ''
    valores.operacoesMes = op ? numeroBr(op[2]) : ''
    // Não existem na base em formato estruturado.
    valores.motivoRecompra = ''
    valores.restritivos = 0
    // Aging em dias: derivado do "Vencido desde" na gravação (depende da semana escolhida).
    valores.agingCarteiraDias = 0

    saida.push(CAMPOS_IMPORTACAO.map((c) => valores[c.chave] ?? ''))
    linhasOrigem.push(r + 1)
    avisosPorLinha.push(avisos)
  }

  const observacoes = [
    `Base do comitê convertida para o modelo: aba "${ABA_BASE_COMITE}", cabeçalho na linha ${iCab + 1}, ${saida.length - 1} linha(s) de cliente.`,
    'Aging da carteira calculado pelos dias entre "Vencido desde" e a semana de referência.',
    'Células de valor vazias na base valem 0 (risco e limite vazios recusam a linha).',
  ]
  if (naoImportadas.length) observacoes.push(`Não importadas (o sistema calcula ou registra nas telas): ${naoImportadas.join(', ')}.`)
  if (desconhecidas.length) observacoes.push(`Colunas novas na base, ignoradas: ${desconhecidas.join(', ')}.`)
  if (quattuor) observacoes.push(`${quattuor} cliente(s) com status "QUATTUOR" na base: carteira apartada, gravados com status NORMAL.`)
  if (descartadas) observacoes.push(`${descartadas} linha(s) sem cliente e sem documento ignoradas.`)
  return { linhas: saida, linhasOrigem, avisosPorLinha, colunasFaltando: [], observacoes }
}

/** Aging da carteira em dias na semana de referência (base do comitê). */
export function agingDoVencido(vencidoDesde: string | null, semanaRef: string): number {
  if (!vencidoDesde) return 0
  const dias = Math.round((Date.parse(`${semanaRef}T00:00:00Z`) - Date.parse(`${vencidoDesde}T00:00:00Z`)) / 86_400_000)
  return Number.isFinite(dias) && dias > 0 ? dias : 0
}
