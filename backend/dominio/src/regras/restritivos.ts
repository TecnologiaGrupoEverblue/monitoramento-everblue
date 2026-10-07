/**
 * Restritivos estruturados — quantidade e valor por tipo, por cliente e semana.
 * Substitui o número solto de "restritivos" por algo que o comitê consegue
 * comparar: "Pefin 13 (R$ 35 mil) → 15 (R$ 229 mil)".
 */
import { formatarMoedaCompacta } from '../utils/formatters'

export type TipoRestritivo =
  | 'PEFIN'
  | 'REFIN'
  | 'PROTESTO'
  | 'ACAO_JUDICIAL'
  | 'DIVIDA_VENCIDA'
  | 'CHEQUE_SEM_FUNDO'
  | 'RECUPERACAO_FALENCIA'
  | 'OUTRO'

export const TIPOS_RESTRITIVO: { tipo: TipoRestritivo; label: string; colunaImportacao: string | null }[] = [
  { tipo: 'PEFIN', label: 'Pefin', colunaImportacao: 'Pefin' },
  { tipo: 'REFIN', label: 'Refin', colunaImportacao: 'Refin' },
  { tipo: 'PROTESTO', label: 'Protesto', colunaImportacao: 'Protestos' },
  { tipo: 'ACAO_JUDICIAL', label: 'Ação judicial', colunaImportacao: 'Ações Judiciais' },
  { tipo: 'DIVIDA_VENCIDA', label: 'Dívida vencida', colunaImportacao: 'Dívida Vencida' },
  { tipo: 'CHEQUE_SEM_FUNDO', label: 'Cheque sem fundo', colunaImportacao: null },
  { tipo: 'RECUPERACAO_FALENCIA', label: 'Recuperação judicial / falência', colunaImportacao: null },
  { tipo: 'OUTRO', label: 'Outro', colunaImportacao: null },
]

export const ROTULO_RESTRITIVO: Record<TipoRestritivo, string> = Object.fromEntries(TIPOS_RESTRITIVO.map((t) => [t.tipo, t.label])) as Record<TipoRestritivo, string>

export interface RestritivoSemanal {
  id: string
  clienteId: string
  semanaRef: string
  tipo: TipoRestritivo
  quantidade: number
  valor: number
  origem: 'IMPORTACAO' | 'MANUAL'
  observacao: string | null
  registradoPor: string
  registradoEm: string
}

export interface LinhaRestritivo {
  tipo: TipoRestritivo
  quantidade: number
  valor: number
}

export interface VariacaoRestritivo {
  tipo: TipoRestritivo
  label: string
  quantidadeAnterior: number
  quantidadeAtual: number
  valorAnterior: number
  valorAtual: number
  piorou: boolean
}

/** Compara a posição atual com a anterior, tipo a tipo. Um tipo que não
 * aparece numa das posições conta como zero. "Piorou" = mais ocorrências ou
 * mais valor (redução de um e aumento do outro também conta como piora: o
 * comitê precisa olhar). */
export function compararRestritivos(atual: LinhaRestritivo[], anterior: LinhaRestritivo[] | null): VariacaoRestritivo[] {
  const tipos = new Set<TipoRestritivo>([...atual.map((r) => r.tipo), ...(anterior ?? []).map((r) => r.tipo)])
  const variacoes: VariacaoRestritivo[] = []
  for (const { tipo, label } of TIPOS_RESTRITIVO) {
    if (!tipos.has(tipo)) continue
    const a = atual.find((r) => r.tipo === tipo)
    const p = anterior?.find((r) => r.tipo === tipo)
    const v: VariacaoRestritivo = {
      tipo,
      label,
      quantidadeAnterior: p?.quantidade ?? 0,
      quantidadeAtual: a?.quantidade ?? 0,
      valorAnterior: p?.valor ?? 0,
      valorAtual: a?.valor ?? 0,
      piorou: false,
    }
    v.piorou = anterior !== null && (v.quantidadeAtual > v.quantidadeAnterior || v.valorAtual > v.valorAnterior + 0.005)
    variacoes.push(v)
  }
  return variacoes
}

export function descreverVariacao(v: VariacaoRestritivo): string {
  return `${v.label} ${v.quantidadeAnterior} (${formatarMoedaCompacta(v.valorAnterior)}) → ${v.quantidadeAtual} (${formatarMoedaCompacta(v.valorAtual)})`
}

export function totalRestritivos(linhas: LinhaRestritivo[]): { quantidade: number; valor: number } {
  return linhas.reduce((t, r) => ({ quantidade: t.quantidade + r.quantidade, valor: t.valor + r.valor }), { quantidade: 0, valor: 0 })
}
