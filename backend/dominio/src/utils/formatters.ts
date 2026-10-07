/** Formatação padrão brasileira usada em toda a aplicação. */

/** A partir de R$ 1 milhão o valor é apresentado em milhões com 3 casas
 * decimais (regra do comitê): R$ 4.307.763 → "R$ 4,308 mi". */
export const LIMITE_MILHOES = 1_000_000

/** Milhões com exatamente 3 casas: "R$ 14,665 mi" (negativo: "-R$ 1,250 mi"). */
export function formatarMilhoes(valor: number): string {
  const texto = (Math.abs(valor) / 1_000_000).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
  // Espaços inseparáveis: o valor nunca quebra em "R$ 3,229" / "mi" em coluna estreita ou eixo de gráfico.
  return `${valor < 0 ? '-' : ''}R$\u00a0${texto}\u00a0mi`
}

export function formatarMoeda(valor: number): string {
  // Arredonda antes de comparar: 999.999,60 vira "R$ 1,000 mi", não "R$ 1.000.000".
  if (Math.abs(Math.round(valor)) >= LIMITE_MILHOES) return formatarMilhoes(valor)
  return valor.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  })
}

export function formatarMoedaCompacta(valor: number): string {
  const abs = Math.abs(valor)
  if (Math.round(abs) >= LIMITE_MILHOES) return formatarMilhoes(valor)
  if (abs >= 1_000) {
    return `R$\u00a0${(valor / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}\u00a0mil`
  }
  return formatarMoeda(valor)
}

export function formatarPercentual(valor: number, casasDecimais = 1): string {
  return `${valor.toLocaleString('pt-BR', { minimumFractionDigits: casasDecimais, maximumFractionDigits: casasDecimais })}%`
}

/** Percentual que pode faltar (ex.: janela de liquidez sem base). */
export function formatarPercentualOpcional(valor: number | null | undefined, casasDecimais = 1, ausente = 'Sem base'): string {
  return valor === null || valor === undefined ? ausente : formatarPercentual(valor, casasDecimais)
}

export function formatarData(isoDate: string | null | undefined): string {
  if (!isoDate) return '—'
  const d = new Date(isoDate + (isoDate.length === 10 ? 'T00:00:00' : ''))
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('pt-BR')
}

export function formatarDataHora(isoDate: string | null | undefined): string {
  if (!isoDate) return '—'
  const d = new Date(isoDate)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}

export function formatarVariacao(valorAtual: number, valorAnterior: number): { texto: string; positivo: boolean; percentual: number } {
  const diferenca = valorAtual - valorAnterior
  const percentual = valorAnterior !== 0 ? (diferenca / Math.abs(valorAnterior)) * 100 : 0
  const sinal = diferenca >= 0 ? '+' : '−'
  return {
    texto: `${sinal} ${formatarMoeda(Math.abs(diferenca))} (${sinal} ${Math.abs(percentual).toFixed(1)}%)`,
    positivo: diferenca >= 0,
    percentual,
  }
}

export function diasEntre(dataInicial: string, dataFinal: string = new Date().toISOString()): number {
  const inicio = new Date(dataInicial).getTime()
  const fim = new Date(dataFinal).getTime()
  return Math.floor((fim - inicio) / (1000 * 60 * 60 * 24))
}

export const STATUS_LABEL: Record<string, string> = {
  NORMAL: 'Normal',
  MONITORAMENTO: 'Monitoramento',
  SAIDA_DE_RISCO: 'Saída de Risco',
  JURIDICO: 'Jurídico',
}

export const CRITICIDADE_LABEL: Record<string, string> = {
  NORMAL: 'Normal',
  ATENCAO: 'Atenção',
  CRITICA: 'Crítica',
}

export const PRIORIDADE_LABEL: Record<string, string> = {
  BAIXA: 'Baixa',
  MEDIA: 'Média',
  ALTA: 'Alta',
}

export const GRAVIDADE_LABEL: Record<string, string> = {
  VERDE: 'Verde',
  AMARELO: 'Amarelo',
  VERMELHO: 'Vermelho',
}

export const STATUS_PROPOSTA_LABEL: Record<string, string> = {
  EM_ANALISE: 'Em análise',
  APROVADA: 'Aprovada / vigente',
  VENCIDA: 'Vencida',
  REPROVADA: 'Reprovada',
  SEM_PROPOSTA: 'Sem proposta',
}

export const STATUS_PLANO_LABEL: Record<string, string> = {
  EM_DIA: 'Em dia',
  ATRASADO: 'Atrasado',
  CONCLUIDO: 'Concluído',
}

/** Tamanho legível em pt-BR (1.024 base): 0 B, 12,4 KB, 3,1 MB, 1,02 GB. */
export function formatarBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  const unidades = ['B', 'KB', 'MB', 'GB', 'TB']
  let valor = bytes
  let i = 0
  while (valor >= 1024 && i < unidades.length - 1) {
    valor /= 1024
    i++
  }
  const casas = i === 0 ? 0 : valor < 10 ? 2 : 1
  return `${valor.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })} ${unidades[i]}`
}
