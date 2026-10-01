import type { FinalidadeArquivo, SituacaoArquivo } from '@monitoramento/dominio'

export const ROTULO_FINALIDADE: Record<FinalidadeArquivo, string> = {
  importado: 'Importado',
  processado: 'Processado',
  exportado: 'Exportado',
  anexo: 'Anexo',
}

export const ROTULO_SITUACAO: Record<SituacaoArquivo, string> = {
  ATIVO: 'Ativo',
  ARQUIVADO: 'Arquivado',
  EXCLUIDO: 'Excluído',
  EXPURGADO: 'Expurgado',
}

/** Cor semântica por situação (tokens do tema, nunca cor fixa). */
export const COR_SITUACAO: Record<SituacaoArquivo, { texto: string; fundo: string }> = {
  ATIVO: { texto: 'var(--cor-normal)', fundo: 'var(--cor-normal-fundo)' },
  ARQUIVADO: { texto: 'var(--cor-inativo)', fundo: 'var(--cor-inativo-fundo)' },
  EXCLUIDO: { texto: 'var(--cor-atencao)', fundo: 'var(--cor-atencao-fundo)' },
  EXPURGADO: { texto: 'var(--cor-critico)', fundo: 'var(--cor-critico-fundo)' },
}

export const ROTULO_EVENTO: Record<string, string> = {
  enviado: 'Enviado',
  nova_versao: 'Nova versão',
  versao_restaurada: 'Versão restaurada',
  baixado: 'Baixado',
  metadados_alterados: 'Dados alterados',
  arquivado: 'Arquivado',
  reativado: 'Reativado',
  excluido: 'Excluído',
  expurgado: 'Expurgado definitivamente',
}
