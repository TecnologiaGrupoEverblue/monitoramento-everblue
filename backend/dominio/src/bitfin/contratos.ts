/** Contratos da foto do Bitfin trafegados entre a API e a interface (1.2). */
import type { DetalheClienteFoto, DivergenciaFoto } from './foto'
import type { ConfigMapaCliente, LinhaMapaGarantia } from './mapaGarantias'
import type { LinhaValidada } from '../utils/planilhaImportacao'

export type OrigemFoto = 'MANUAL' | 'AGENDADA'
export type StatusFoto = 'EXECUTANDO' | 'CONCLUIDA' | 'RECUSADA' | 'FALHOU'
export type PosicaoSemanalFoto = 'GRAVADA' | 'JA_EXISTIA' | 'NAO_SOLICITADA' | 'NAO_GRAVADA'

export interface ExecucaoFoto {
  id: string
  origem: OrigemFoto
  solicitadoPor: string
  solicitadoPorNome: string | null
  iniciadoEm: string
  concluidoEm: string | null
  status: StatusFoto
  gravarPosicao: boolean
  semanaRef: string | null
  posicaoSemanal: PosicaoSemanalFoto | null
  importacaoId: string | null
  arquivoId: string | null
  versaoRegras: string
  bitfinLidoEm: string | null
  bitfinApuradoEm: string | null
  clientes: number | null
  totais: { clientes: number; risco: number; vencido: number; eventos: number; snapshots?: number; alertas?: number } | null
  divergencias: DivergenciaFoto[]
  recusas: string[]
  temposMs: Record<string, number> | null
  mensagem: string | null
  fotoAnteriorId: string | null
}

export interface AgendamentoFoto {
  ativo: boolean
  horario: string
  /** 0 = domingo … 6 = sábado (fuso America/Sao_Paulo). */
  diasSemana: number[]
  /** Dia em que a foto agendada também grava a posição do comitê. */
  diaPosicaoSemanal: number | null
  ultimaExecucaoEm: string | null
  atualizadoPor: string | null
  atualizadoPorNome: string | null
  atualizadoEm: string
}

export interface SituacaoFoto {
  configurado: boolean
  planilhaHabilitada: boolean
  /** Fotos sem posição do comitê e sem Mapa enviado são apagadas depois destes dias (ADR-021). */
  retencaoTesteDias: number
  emAndamento: ExecucaoFoto | null
  ultima: ExecucaoFoto | null
  ultimaConcluida: ExecucaoFoto | null
  agendamento: AgendamentoFoto
  proximoComite: string | null
}

export interface ComparacaoClienteFoto {
  clienteId: string | null
  documento: string
  nome: string
  status: string
  statusAnterior: string | null
  risco: number
  riscoAnterior: number | null
  vencido: number
  vencidoAnterior: number | null
  il30: number | null
  il30Anterior: number | null
  limite: number
  emAndamento: number
  prazoMedio: number | null
  eventos: number
  situacao: 'NOVO' | 'MANTIDO' | 'SAIU'
}

export interface ComparacaoFoto {
  foto: ExecucaoFoto
  anterior: ExecucaoFoto | null
  clientes: ComparacaoClienteFoto[]
}

/** Último detalhe do Bitfin de um cliente do Monitoramento (checklist, ficha). */
export interface DetalheBitfinDoCliente {
  fotoId: string
  tiradaEm: string
  detalhe: DetalheClienteFoto
  linha: LinhaValidada
}

// ------------------------------------------------------------------ Mapa de Garantias

export interface ClienteMapa {
  /** Só dígitos. */
  documento: string
  nome: string | null
  incluidoPor: string | null
  incluidoEm: string
}

export interface CopiaMapa {
  email: string
  incluidoPor: string | null
  incluidoEm: string
}

export interface EnvioMapa {
  id: string
  loteId: string
  fotoId: string
  origem: 'AGENDADO' | 'MANUAL'
  solicitadoPorNome: string | null
  destinatario: string
  papeis: string[]
  clientes: string[]
  status: 'ENVIADO' | 'FALHOU' | 'NAO_ENVIADO'
  mensagem: string | null
  arquivoId: string | null
  em: string
}

export interface MapaCalculado {
  fotoId: string
  tiradaEm: string
  apuradoEm: string | null
  linhas: LinhaMapaGarantia[]
  /** Documentos do mapa que não existem como cliente no Bitfin. */
  naoEncontrados: string[]
  /** Documentos incluídos depois desta foto (entram na próxima). */
  aguardandoFoto: string[]
}

export interface TelaMapaGarantias {
  calculado: MapaCalculado | null
  clientes: ClienteMapa[]
  copias: CopiaMapa[]
  configs: Record<string, ConfigMapaCliente>
  envioLigado: boolean
  envioDiarioAtivo: boolean
}
