import { format } from 'date-fns'
import type { StatusCliente, StatusProposta } from '../models/types'

const STATUS_CLIENTE_VALIDOS: StatusCliente[] = ['NORMAL', 'MONITORAMENTO', 'SAIDA_DE_RISCO', 'JURIDICO']
const STATUS_PROPOSTA_VALIDOS: StatusProposta[] = ['EM_ANALISE', 'APROVADA', 'VENCIDA', 'REPROVADA']

type TipoCampo = 'texto' | 'numero' | 'numeroOpcional' | 'data' | 'dataOpcional' | 'status' | 'statusProposta' | 'produtos'

interface CampoImportacao {
  coluna: string
  chave: string
  tipo: TipoCampo
}

/** Precisa bater exatamente com os cabeçalhos gerados por
 * scripts/gerarModeloPlanilha.cjs — é o contrato entre a planilha modelo e
 * este parser. Mudou uma coluna lá, muda aqui também. */
export const CAMPOS_IMPORTACAO: CampoImportacao[] = [
  { coluna: 'Cliente', chave: 'nome', tipo: 'texto' },
  { coluna: 'CNPJ', chave: 'cnpj', tipo: 'texto' },
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
  { coluna: 'IL 30 dias (%)', chave: 'il30', tipo: 'numero' },
  { coluna: 'IL 60 dias (%)', chave: 'il60', tipo: 'numero' },
  { coluna: 'IL 90 dias (%)', chave: 'il90', tipo: 'numero' },
  { coluna: 'IL 120 dias (%)', chave: 'il120', tipo: 'numero' },
  { coluna: 'IL 150 dias (%)', chave: 'il150', tipo: 'numero' },
  { coluna: 'IL 180 dias (%)', chave: 'il180', tipo: 'numero' },
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
]

export interface LinhaValidada {
  linha: number
  nome: string
  cnpj: string
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
  il30: number
  il60: number
  il90: number
  il120: number
  il150: number
  il180: number
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

function parseNumero(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null
  const texto = String(valor).trim().replace(/[R$%\s]/g, '')
  if (texto === '') return null
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

/** Valida as linhas já lidas da primeira aba da planilha (ou do CSV) — a
 * primeira linha é o cabeçalho. Função pura: a leitura do arquivo fica na
 * API, que é o único lugar onde o conteúdo enviado é confiável o bastante
 * para virar dado. Nada é persistido aqui. */
export function validarLinhasPlanilha(linhas: unknown[][]): ResultadoParse {
  if (linhas.length === 0) {
    return { colunasFaltando: CAMPOS_IMPORTACAO.map((c) => c.coluna), validas: [], comErro: [] }
  }

  const cabecalho = linhas[0].map((c) => String(c ?? '').trim())
  const indicePorColuna = new Map(cabecalho.map((nome, i) => [nome, i]))
  const colunasFaltando = CAMPOS_IMPORTACAO.filter((c) => !indicePorColuna.has(c.coluna)).map((c) => c.coluna)
  if (colunasFaltando.length > 0) {
    return { colunasFaltando, validas: [], comErro: [] }
  }

  const validas: LinhaValidada[] = []
  const comErro: LinhaComErro[] = []

  for (let i = 1; i < linhas.length; i++) {
    const linha = linhas[i]
    const vazia = linha.every((v) => v === '' || v === null || v === undefined)
    if (vazia) continue

    const numeroLinha = i + 1
    const erros: string[] = []
    const dados: Record<string, unknown> = {}

    for (const campo of CAMPOS_IMPORTACAO) {
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
        case 'numero': {
          const n = parseNumero(bruto)
          if (n === null) erros.push(`"${campo.coluna}" é obrigatório e precisa ser numérico.`)
          dados[campo.chave] = n ?? 0
          break
        }
        case 'numeroOpcional': {
          dados[campo.chave] = parseNumero(bruto) ?? 0
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
          const s = String(bruto ?? '').trim().toUpperCase()
          if (!STATUS_CLIENTE_VALIDOS.includes(s as StatusCliente)) erros.push(`"${campo.coluna}" inválido: "${String(bruto ?? "")}". Use um de ${STATUS_CLIENTE_VALIDOS.join(', ')}.`)
          dados[campo.chave] = s
          break
        }
        case 'statusProposta': {
          const s = String(bruto ?? '').trim().toUpperCase()
          if (!STATUS_PROPOSTA_VALIDOS.includes(s as StatusProposta)) erros.push(`"${campo.coluna}" inválido: "${String(bruto ?? "")}". Use um de ${STATUS_PROPOSTA_VALIDOS.join(', ')}.`)
          dados[campo.chave] = s
          break
        }
      }
    }

    if (!dados.nome) erros.push('"Cliente" é obrigatório.')
    if (!dados.cnpj) erros.push('"CNPJ" é obrigatório.')

    if (erros.length > 0) {
      comErro.push({ linha: numeroLinha, erros })
      continue
    }

    validas.push({ linha: numeroLinha, ...dados } as LinhaValidada)
  }

  return { colunasFaltando: [], validas, comErro }
}
