import { format } from 'date-fns'
import type { StatusCliente, StatusProposta } from '../models/types'
import { TIPOS_RESTRITIVO, type LinhaRestritivo, type TipoRestritivo } from '../regras/restritivos'

const STATUS_CLIENTE_VALIDOS: StatusCliente[] = ['NORMAL', 'MONITORAMENTO', 'SAIDA_DE_RISCO', 'JURIDICO']
const STATUS_PROPOSTA_VALIDOS: StatusProposta[] = ['EM_ANALISE', 'APROVADA', 'VENCIDA', 'REPROVADA', 'SEM_PROPOSTA']

/** Como a base do comitê escreve, aceito sem pedir que o usuário converta. */
const SINONIMOS_STATUS_CLIENTE: Record<string, StatusCliente> = { SAIDA_DE_RISCO: 'SAIDA_DE_RISCO', 'SAIDA DE RISCO': 'SAIDA_DE_RISCO', JURIDICO: 'JURIDICO' }
const SINONIMOS_STATUS_PROPOSTA: Record<string, StatusProposta> = { VIGENTE: 'APROVADA', 'SEM PROPOSTA': 'SEM_PROPOSTA', 'EM ANALISE': 'EM_ANALISE' }

type TipoCampo =
  | 'texto'
  | 'numero'
  | 'numeroOpcional' // vazio = 0
  | 'numeroOuNulo' // vazio = não informado
  | 'percentualOuNulo' // vazio ou "SEM BASE" = não informado
  | 'data'
  | 'dataOpcional'
  | 'status'
  | 'statusProposta'
  | 'produtos'
  | 'documentos'

interface CampoImportacao {
  coluna: string
  chave: string
  tipo: TipoCampo
  /** Coluna que a planilha pode não ter (modelos anteriores continuam valendo). */
  opcional?: boolean
}

const COLUNAS_RESTRITIVO: { tipo: TipoRestritivo; qtd: string; valor: string }[] = TIPOS_RESTRITIVO.filter((t) => t.colunaImportacao).map((t) => ({
  tipo: t.tipo,
  qtd: `${t.colunaImportacao} (qtd)`,
  valor: `${t.colunaImportacao} (R$)`,
}))

/** Contrato entre a planilha modelo (frontend/public/modelos) e este parser.
 * Mudou uma coluna lá, muda aqui também. Colunas `opcional` podem faltar. */
export const CAMPOS_IMPORTACAO: CampoImportacao[] = [
  { coluna: 'Cliente', chave: 'nome', tipo: 'texto' },
  { coluna: 'CNPJ', chave: 'documentos', tipo: 'documentos' },
  { coluna: 'Carteira', chave: 'carteira', tipo: 'texto', opcional: true },
  { coluna: 'Grupo Econômico', chave: 'grupoEconomico', tipo: 'texto' },
  { coluna: 'Gerente', chave: 'gerente', tipo: 'texto' },
  { coluna: 'Plataforma Comercial', chave: 'plataforma', tipo: 'texto' },
  { coluna: 'Setor', chave: 'setor', tipo: 'texto' },
  { coluna: 'Ramo de Atividade', chave: 'ramoAtividade', tipo: 'texto' },
  { coluna: 'Produtos (separados por ;)', chave: 'produtos', tipo: 'produtos' },
  { coluna: 'Status (NORMAL, MONITORAMENTO, SAIDA_DE_RISCO, JURIDICO)', chave: 'status', tipo: 'status' },
  { coluna: 'Risco do Cliente (R$)', chave: 'riscoCliente', tipo: 'numero' },
  { coluna: 'Limite Global (R$)', chave: 'limiteGlobal', tipo: 'numero' },
  { coluna: 'Status da Proposta (EM_ANALISE, APROVADA, VENCIDA, REPROVADA)', chave: 'statusProposta', tipo: 'statusProposta' },
  { coluna: 'Validade da Proposta (dd/mm/aaaa)', chave: 'validadeProposta', tipo: 'dataOpcional' },
  { coluna: 'Tranche Consolidada (R$)', chave: 'trancheConsolidada', tipo: 'numero' },
  { coluna: 'Valor em Andamento (R$)', chave: 'valorEmAndamento', tipo: 'numero' },
  { coluna: 'Vencido Oficial (R$)', chave: 'vencidoOficial', tipo: 'numero' },
  { coluna: 'Vencido Desde (dd/mm/aaaa)', chave: 'vencidoDesde', tipo: 'dataOpcional' },
  { coluna: 'Aging da Carteira (dias)', chave: 'agingCarteiraDias', tipo: 'numero' },
  { coluna: 'Prazo Médio da Carteira (dias)', chave: 'prazoMedioCarteiraDias', tipo: 'numero' },
  { coluna: 'IL 30 dias (%)', chave: 'il30', tipo: 'percentualOuNulo' },
  { coluna: 'IL 60 dias (%)', chave: 'il60', tipo: 'percentualOuNulo' },
  { coluna: 'IL 90 dias (%)', chave: 'il90', tipo: 'percentualOuNulo' },
  { coluna: 'IL 120 dias (%)', chave: 'il120', tipo: 'percentualOuNulo' },
  { coluna: 'IL 150 dias (%)', chave: 'il150', tipo: 'percentualOuNulo' },
  { coluna: 'IL 180 dias (%)', chave: 'il180', tipo: 'percentualOuNulo' },
  { coluna: '% Sem Atuação de Manifesto', chave: 'manifestoPercSemAtuacao', tipo: 'numero' },
  { coluna: 'Manifesto Inacessível (R$)', chave: 'manifestoInacessivel', tipo: 'numeroOpcional' },
  { coluna: 'Manifesto Não Confirma (R$)', chave: 'manifestoNaoConfirma', tipo: 'numeroOpcional' },
  { coluna: 'Manifesto Transação Desconhecida (R$)', chave: 'manifestoTransacaoDesconhecida', tipo: 'numeroOpcional' },
  { coluna: 'Manifesto Lastro Inconsistente (R$)', chave: 'manifestoLastroInconsistente', tipo: 'numeroOpcional' },
  { coluna: 'Manifesto Transação Não Concluída (R$)', chave: 'manifestoTransacaoNaoConcluida', tipo: 'numeroOpcional' },
  { coluna: 'Liquidado no Período (R$)', chave: 'liquidadoNoPeriodo', tipo: 'numero' },
  { coluna: 'Recompras (R$)', chave: 'recompras', tipo: 'numeroOpcional' },
  { coluna: 'Motivo da Recompra', chave: 'motivoRecompra', tipo: 'texto' },
  { coluna: '% Liquidado no Prazo', chave: 'percLiquidadoNoPrazo', tipo: 'numero' },
  { coluna: 'Atraso Médio (dias)', chave: 'atrasoMedioDias', tipo: 'numero' },
  { coluna: 'Restritivos (quantidade)', chave: 'restritivos', tipo: 'numeroOpcional' },
  { coluna: 'Prorrogações acima de 60 dias (R$)', chave: 'prorrogacoesAcima60d', tipo: 'numeroOuNulo', opcional: true },
  { coluna: 'Operações no Mês Anterior (R$)', chave: 'operacoesMesAnterior', tipo: 'numeroOuNulo', opcional: true },
  { coluna: 'Operações no Mês (R$)', chave: 'operacoesMes', tipo: 'numeroOuNulo', opcional: true },
  ...COLUNAS_RESTRITIVO.flatMap((c) => [
    { coluna: c.qtd, chave: `rest_qtd_${c.tipo}`, tipo: 'numeroOuNulo' as const, opcional: true },
    { coluna: c.valor, chave: `rest_valor_${c.tipo}`, tipo: 'numeroOuNulo' as const, opcional: true },
  ]),
]

export interface LinhaValidada {
  linha: number
  nome: string
  /** Documento principal (o primeiro informado). */
  cnpj: string
  /** Todos os documentos da linha, o principal primeiro. Ausente em prévias anteriores à 1.1. */
  documentos?: string[]
  /** Nome da carteira (coluna opcional); `null` = mantém a do cliente / EVERBLUE. */
  carteira?: string | null
  grupoEconomico: string
  gerente: string
  plataforma: string
  setor: string
  ramoAtividade: string
  produtos: string[]
  status: StatusCliente
  riscoCliente: number
  limiteGlobal: number
  statusProposta: StatusProposta
  validadeProposta: string | null
  trancheConsolidada: number
  valorEmAndamento: number
  vencidoOficial: number
  vencidoDesde: string | null
  agingCarteiraDias: number
  prazoMedioCarteiraDias: number
  il30: number | null
  il60: number | null
  il90: number | null
  il120: number | null
  il150: number | null
  il180: number | null
  manifestoPercSemAtuacao: number
  manifestoInacessivel: number
  manifestoNaoConfirma: number
  manifestoTransacaoDesconhecida: number
  manifestoLastroInconsistente: number
  manifestoTransacaoNaoConcluida: number
  liquidadoNoPeriodo: number
  recompras: number
  motivoRecompra: string | null
  percLiquidadoNoPrazo: number
  atrasoMedioDias: number
  restritivos: number
  prorrogacoesAcima60d?: number | null
  operacoesMesAnterior?: number | null
  operacoesMes?: number | null
  /** Restritivos por tipo; `null` quando a linha não trouxe nenhum. */
  restritivosPorTipo?: LinhaRestritivo[] | null
  /** Avisos de qualidade: não impedem a importação, mas aparecem na prévia. */
  avisos?: string[]
}

export interface LinhaComErro {
  linha: number
  erros: string[]
}

export interface ResultadoParse {
  colunasFaltando: string[]
  validas: LinhaValidada[]
  comErro: LinhaComErro[]
}

export interface OpcoesValidacao {
  /** Tranche ou limite até este valor (R$) é tratado como simbólico (aviso). */
  valorSimbolico?: number
}

/** `undefined` = célula vazia; `null` = havia texto que não é número. */
function parseNumero(valor: unknown): number | null | undefined {
  if (valor === null || valor === undefined || valor === '') return undefined
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null
  const texto = String(valor).trim().replace(/[R$%\s ]/g, '')
  if (texto === '' || texto === '-') return undefined
  // Formato brasileiro (1.234,56) só quando há vírgula; senão assume ponto decimal padrão.
  const normalizado = texto.includes(',') ? texto.replace(/\./g, '').replace(',', '.') : texto
  const num = Number(normalizado)
  return Number.isFinite(num) ? num : null
}

function parseData(valor: unknown): string | null {
  if (valor === null || valor === undefined || valor === '') return null
  if (valor instanceof Date) return format(valor, 'yyyy-MM-dd')
  const texto = String(valor).trim()
  const match = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (match) {
    const [, d, m, y] = match
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  const isoMatch = texto.match(/^\d{4}-\d{2}-\d{2}/)
  if (isoMatch) return texto.slice(0, 10)
  return null
}

/** Sem acento, maiúsculo, espaços simples — para comparar rótulos. */
function chaveTexto(valor: unknown): string {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ')
}

function formatarCnpj(d: string): string {
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}
function formatarCpf(d: string): string {
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}

/** Um documento como deve ser gravado: sem caracteres invisíveis, e CNPJ/CPF
 * formatados. Bases exportadas costumam trazer um zero a mais à esquerda
 * (15 dígitos) — ele é removido. */
export function canonizarDocumento(bruto: string): string {
  const limpo = bruto.replace(/[​-‍﻿ ]/g, '').trim()
  let digitos = limpo.replace(/\D/g, '')
  if (digitos.length === 15 && digitos.startsWith('0')) digitos = digitos.slice(1)
  if (digitos.length === 14) return formatarCnpj(digitos)
  if (digitos.length === 11) return formatarCpf(digitos)
  return limpo
}

/** Documentos de uma célula: separados por vírgula, ponto e vírgula ou quebra de linha. */
export function separarDocumentos(valor: unknown): string[] {
  const vistos = new Set<string>()
  const saida: string[] = []
  for (const parte of String(valor ?? '').split(/[;,\n\r]+/)) {
    const doc = canonizarDocumento(parte)
    const chave = doc.replace(/\D/g, '')
    if (!chave || vistos.has(chave)) continue
    vistos.add(chave)
    saida.push(doc)
  }
  return saida
}

/** Valida as linhas já lidas da primeira aba da planilha (ou do CSV) — a
 * primeira linha é o cabeçalho. Função pura: a leitura do arquivo fica na
 * API, que é o único lugar onde o conteúdo enviado é confiável o bastante
 * para virar dado. Nada é persistido aqui. */
export function validarLinhasPlanilha(linhas: unknown[][], opcoes: OpcoesValidacao = {}): ResultadoParse {
  const valorSimbolico = opcoes.valorSimbolico ?? 1000
  const obrigatorias = CAMPOS_IMPORTACAO.filter((c) => !c.opcional)
  if (linhas.length === 0) {
    return { colunasFaltando: obrigatorias.map((c) => c.coluna), validas: [], comErro: [] }
  }

  const cabecalho = linhas[0].map((c) => String(c ?? '').trim())
  const indicePorColuna = new Map(cabecalho.map((nome, i) => [nome, i]))
  const colunasFaltando = obrigatorias.filter((c) => !indicePorColuna.has(c.coluna)).map((c) => c.coluna)
  if (colunasFaltando.length > 0) {
    return { colunasFaltando, validas: [], comErro: [] }
  }
  const presentes = CAMPOS_IMPORTACAO.filter((c) => indicePorColuna.has(c.coluna))

  const validas: LinhaValidada[] = []
  const comErro: LinhaComErro[] = []

  for (let i = 1; i < linhas.length; i++) {
    const linha = linhas[i]
    const vazia = linha.every((v) => v === '' || v === null || v === undefined)
    if (vazia) continue

    const numeroLinha = i + 1
    const erros: string[] = []
    const avisos: string[] = []
    const dados: Record<string, unknown> = {}

    for (const campo of presentes) {
      const idx = indicePorColuna.get(campo.coluna)!
      const bruto = linha[idx]
      switch (campo.tipo) {
        case 'texto': {
          dados[campo.chave] = String(bruto ?? '').trim()
          break
        }
        case 'produtos': {
          dados[campo.chave] = String(bruto ?? '')
            .split(';')
            .map((p) => p.trim())
            .filter(Boolean)
          break
        }
        case 'documentos': {
          dados[campo.chave] = separarDocumentos(bruto)
          break
        }
        case 'numero': {
          const n = parseNumero(bruto)
          if (n === undefined) erros.push(`"${campo.coluna}" é obrigatório e precisa ser numérico.`)
          else if (n === null) erros.push(`"${campo.coluna}" tem texto em campo numérico: "${String(bruto).trim()}".`)
          dados[campo.chave] = n ?? 0
          break
        }
        case 'numeroOpcional': {
          const n = parseNumero(bruto)
          if (n === null) erros.push(`"${campo.coluna}" tem texto em campo numérico: "${String(bruto).trim()}". Deixe vazio ou informe só o número.`)
          dados[campo.chave] = n ?? 0
          break
        }
        case 'numeroOuNulo': {
          const n = parseNumero(bruto)
          if (n === null) erros.push(`"${campo.coluna}" tem texto em campo numérico: "${String(bruto).trim()}". Deixe vazio ou informe só o número.`)
          dados[campo.chave] = n ?? null
          break
        }
        case 'percentualOuNulo': {
          if (chaveTexto(bruto) === 'SEM BASE') {
            dados[campo.chave] = null
            break
          }
          const n = parseNumero(bruto)
          if (n === null) erros.push(`"${campo.coluna}" tem texto em campo numérico: "${String(bruto).trim()}". Use o número, ou deixe vazio / "SEM BASE" quando não há base.`)
          dados[campo.chave] = n ?? null
          break
        }
        case 'data': {
          const d = parseData(bruto)
          if (!d) erros.push(`"${campo.coluna}" é obrigatório no formato dd/mm/aaaa.`)
          dados[campo.chave] = d
          break
        }
        case 'dataOpcional': {
          dados[campo.chave] = parseData(bruto)
          break
        }
        case 'status': {
          const k = chaveTexto(bruto)
          const s = SINONIMOS_STATUS_CLIENTE[k] ?? k
          if (!STATUS_CLIENTE_VALIDOS.includes(s as StatusCliente)) erros.push(`"${campo.coluna}" inválido: "${String(bruto ?? '')}". Use um de ${STATUS_CLIENTE_VALIDOS.join(', ')}.`)
          dados[campo.chave] = s
          break
        }
        case 'statusProposta': {
          const k = chaveTexto(bruto)
          const s = SINONIMOS_STATUS_PROPOSTA[k] ?? k
          if (!STATUS_PROPOSTA_VALIDOS.includes(s as StatusProposta)) erros.push(`"${campo.coluna}" inválido: "${String(bruto ?? '')}". Use um de ${STATUS_PROPOSTA_VALIDOS.join(', ')}.`)
          dados[campo.chave] = s
          break
        }
      }
    }

    const documentos = (dados.documentos as string[] | undefined) ?? []
    if (!dados.nome) erros.push('"Cliente" é obrigatório.')
    if (documentos.length === 0) erros.push('"CNPJ" é obrigatório.')
    for (const doc of documentos) {
      const n = doc.replace(/\D/g, '').length
      if (n !== 14 && n !== 11) avisos.push(`Documento "${doc}" tem ${n} dígitos (CNPJ tem 14; CPF, 11).`)
    }

    // Restritivos por tipo: só existem se a linha trouxe ao menos um valor.
    const porTipo: LinhaRestritivo[] = []
    for (const c of COLUNAS_RESTRITIVO) {
      const qtd = dados[`rest_qtd_${c.tipo}`] as number | null | undefined
      const valor = dados[`rest_valor_${c.tipo}`] as number | null | undefined
      delete dados[`rest_qtd_${c.tipo}`]
      delete dados[`rest_valor_${c.tipo}`]
      if ((qtd === null || qtd === undefined) && (valor === null || valor === undefined)) continue
      if ((qtd ?? 0) < 0 || (valor ?? 0) < 0) erros.push(`Restritivos de ${c.qtd.replace(' (qtd)', '')} não podem ser negativos.`)
      porTipo.push({ tipo: c.tipo, quantidade: Math.round(qtd ?? 0), valor: valor ?? 0 })
    }

    if (erros.length > 0) {
      comErro.push({ linha: numeroLinha, erros })
      continue
    }

    // Avisos de qualidade (não bloqueiam).
    const tranche = dados.trancheConsolidada as number
    const limite = dados.limiteGlobal as number
    if (tranche > 0 && tranche <= valorSimbolico) {
      avisos.push(`Tranche simbólica (R$ ${tranche.toLocaleString('pt-BR')}): o consumo da tranche não é representativo.`)
    }
    if (limite > 0 && limite <= valorSimbolico) {
      avisos.push(`Limite global simbólico (R$ ${limite.toLocaleString('pt-BR')}): o consumo do limite não é representativo.`)
    }
    const ilVazios = ['il30', 'il60', 'il90', 'il120', 'il150', 'il180'].filter((k) => dados[k] === null || dados[k] === undefined)
    if (ilVazios.length === 6) avisos.push('Liquidez sem base em todas as janelas: gravada como ausente (não como 0).')

    let restritivos = dados.restritivos as number
    if (porTipo.length > 0) {
      const soma = porTipo.reduce((t, r) => t + r.quantidade, 0)
      if (restritivos > 0 && restritivos !== soma) {
        avisos.push(`"Restritivos (quantidade)" (${restritivos}) difere da soma por tipo (${soma}); vale a soma por tipo.`)
      }
      restritivos = soma
    }

    for (const k of ['il30', 'il60', 'il90', 'il120', 'il150', 'il180', 'prorrogacoesAcima60d', 'operacoesMesAnterior', 'operacoesMes']) {
      if (dados[k] === undefined) dados[k] = null
    }

    validas.push({
      ...(dados as Omit<LinhaValidada, 'linha' | 'cnpj'>),
      linha: numeroLinha,
      cnpj: documentos[0],
      documentos,
      carteira: (dados.carteira as string | undefined)?.trim() || null,
      restritivos,
      restritivosPorTipo: porTipo.length > 0 ? porTipo : null,
      avisos,
    } as LinhaValidada)
  }

  return { colunasFaltando: [], validas, comErro }
}
