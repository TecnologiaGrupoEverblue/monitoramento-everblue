/**
 * ARQUIVO ÚNICO DE TEMA — EverBlue Monitoramento
 * -------------------------------------------------
 * Padrão visual da Intranet Everblue (tema escuro institucional). As cores de
 * verdade vivem como variáveis CSS em `src/index.css`; aqui ficam só os
 * mapeamentos usados pelos componentes. Nenhum outro arquivo deve conter cor
 * fixa.
 *
 * As cores de RISCO (verde/amarelo/vermelho/cinza) são semânticas e não
 * devem ser usadas para nenhum outro propósito — em especial, nunca
 * reaproveitar o dourado da marca perto de um badge de status.
 */

const v = (nome: string) => `var(--${nome})`

export const marca = {
  primaria: '#001751',
  secundaria: '#1B1489',
  violeta: '#7C3AED',
  dourado: '#DFBF7D',
} as const

export const risco = {
  normal: v('cor-normal'),
  normalFundo: v('cor-normal-fundo'),
  atencao: v('cor-atencao'),
  atencaoFundo: v('cor-atencao-fundo'),
  critico: v('cor-critico'),
  criticoFundo: v('cor-critico-fundo'),
  saida: v('cor-saida'),
  saidaFundo: v('cor-saida-fundo'),
  inativo: v('cor-inativo'),
  inativoFundo: v('cor-inativo-fundo'),
} as const

export const statusCor: Record<string, { texto: string; fundo: string }> = {
  NORMAL: { texto: risco.normal, fundo: risco.normalFundo },
  MONITORAMENTO: { texto: risco.atencao, fundo: risco.atencaoFundo },
  SAIDA_DE_RISCO: { texto: risco.saida, fundo: risco.saidaFundo },
  JURIDICO: { texto: risco.critico, fundo: risco.criticoFundo },
}

export const criticidadeCor: Record<string, { texto: string; fundo: string }> = {
  NORMAL: { texto: risco.normal, fundo: risco.normalFundo },
  ATENCAO: { texto: risco.atencao, fundo: risco.atencaoFundo },
  CRITICA: { texto: risco.critico, fundo: risco.criticoFundo },
}

export const gravidadeCor: Record<string, { texto: string; fundo: string }> = {
  VERDE: { texto: risco.normal, fundo: risco.normalFundo },
  AMARELO: { texto: risco.atencao, fundo: risco.atencaoFundo },
  VERMELHO: { texto: risco.critico, fundo: risco.criticoFundo },
}

export const prioridadeCor: Record<string, { texto: string; fundo: string }> = {
  ALTA: { texto: risco.critico, fundo: risco.criticoFundo },
  MEDIA: { texto: risco.atencao, fundo: risco.atencaoFundo },
  BAIXA: { texto: risco.inativo, fundo: risco.inativoFundo },
}

export const statusPlanoCor: Record<string, { texto: string; fundo: string }> = {
  ATRASADO: { texto: risco.critico, fundo: risco.criticoFundo },
  EM_DIA: { texto: risco.atencao, fundo: risco.atencaoFundo },
  CONCLUIDO: { texto: risco.normal, fundo: risco.normalFundo },
}

// Paleta neutra para gráficos sem significado de risco (gerente, plataforma,
// produto, setor, grupo) — tons da marca, nunca as cores semânticas acima.
export const graficoPaleta = ['#7C3AED', '#DFBF7D', '#60A5FA', '#A78BFA', '#2DD4BF', '#818CF8', '#F0ABFC', '#94A3B8']
