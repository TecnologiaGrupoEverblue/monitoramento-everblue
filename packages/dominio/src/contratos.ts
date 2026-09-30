/**
 * CONTRATOS DA API — formatos trafegados entre a API e a interface.
 *
 * Ficam no pacote de domínio para que as duas pontas compilem contra a mesma
 * definição: mudar um campo aqui quebra o build de quem ainda não acompanhou,
 * em vez de quebrar a tela em produção.
 */
import type {
  Alerta,
  EventoIASR,
  Gravidade,
  RegistroIASR,
  StatusCliente,
} from './models/types'
import type { SugestaoChecklist } from './regras/motorChecklist'
import type { AlertaGerado } from './regras/motorDeAlertas'
import type { LinhaComErro, LinhaValidada } from './utils/planilhaImportacao'

// ------------------------------------------------------------------ sessão

export type PerfilAcesso = 'leitor' | 'analista' | 'gestor' | 'admin'

/** Escala única de perfis. Um perfil herda tudo dos anteriores. */
export const NIVEL_PERFIL: Record<PerfilAcesso, number> = {
  leitor: 10,
  analista: 20,
  gestor: 30,
  admin: 40,
}

export function perfilValido(valor: string): valor is PerfilAcesso {
  return Object.prototype.hasOwnProperty.call(NIVEL_PERFIL, valor)
}

export interface SessaoUsuario {
  id: string
  nome: string
  email: string
  cargo: string | null
  perfil: PerfilAcesso
  departamento: string | null
  origem: 'entra' | 'local'
  temFoto: boolean
}

export interface ModoAutenticacao {
  entraDisponivel: boolean
}

// ------------------------------------------------------------------ dashboard

export interface AgregadosSemana {
  risco: number
  vencido: number
  percVencido: number
  limiteGlobal: number
  trancheConsolidada: number
  valorEmAndamento: number
  percLimiteConsumido: number
  percTrancheConsumida: number
  riscoMonitoramento: number
  riscoSaidaDeRisco: number
  riscoJuridico: number
  riscoCritico: number
  riscoAtencao: number
  qtdCriticos: number
  qtdAtencao: number
  qtdClientes: number
}

export interface KPIsDashboard {
  semanaRef: string | null
  semanaAnterior: string | null
  semanaMesAnterior: string | null
  atual: AgregadosSemana
  anterior: AgregadosSemana
  mesAnterior: AgregadosSemana | null
}

export type DimensaoRisco = 'status' | 'gerenteId' | 'plataformaId' | 'setor' | 'grupoEconomicoId' | 'produto'
export const DIMENSOES_RISCO: DimensaoRisco[] = ['status', 'gerenteId', 'plataformaId', 'setor', 'grupoEconomicoId', 'produto']

export interface RiscoPorDimensaoItem {
  chave: string
  label: string
  risco: number
  qtdClientes: number
  clienteIds: string[]
}

export interface RankingDimensao {
  id: string
  nome: string
  qtdClientes: number
  riscoTotal: number
  riscoMonitoramento: number
  qtdMonitoramento: number
  riscoSaidaDeRisco: number
  qtdSaidaDeRisco: number
  riscoJuridico: number
  qtdJuridico: number
  vencido: number
  percVencido: number
  planosPendentes: number
  planosAtrasados: number
  clienteIds: string[]
}

// ------------------------------------------------------------------ checklist

export interface ItemChecklistView extends SugestaoChecklist {
  parecer: string
  gravidadeManual: boolean
  persistido: boolean
  atualizadoEm: string | null
  atualizadoPor: string | null
}

export interface ResumoChecklist {
  vermelho: number
  amarelo: number
  verde: number
  semParecer: number
}

export interface AlteracaoItemChecklist {
  parecer?: string
  gravidade?: Gravidade
  gravidadeManual?: boolean
}

// ------------------------------------------------------------------ IASR

export interface RegistroIasrComEventos extends RegistroIASR {
  eventos: EventoIASR[]
}

export interface IndicadoresIASR {
  saidasRealizadas: number
  saidasAcompanhadas: number
  comEventosPosteriores: number
  percAssertividade: number
  tempoMedioDiasDecisaoEvento: number | null
  motivosQueMaisAntecipam: { motivo: string; ocorrencias: number }[]
}

// ------------------------------------------------------------------ importação

export interface ItemPreviewImportacao {
  linha: number
  novo: boolean
  jaImportadoNestaSemana: boolean
  clienteId: string
  nome: string
  cnpj: string
  statusAnterior: StatusCliente | null
  statusNovo: StatusCliente
  mudouStatus: boolean
  riscoAnterior: number | null
  riscoNovo: number
  deltaRisco: number | null
  percVencidoAnterior: number | null
  percVencidoNovo: number
  aumentoVencido: boolean
  alertasGerados: AlertaGerado[]
  linhaValidada: LinhaValidada
}

export interface PreviewImportacao {
  /** Identificador da importação no servidor. A confirmação referencia este
   * id — o conteúdo da prévia nunca volta do navegador para ser gravado. */
  importacaoId: string
  nomeArquivo: string
  semanaRef: string
  itens: ItemPreviewImportacao[]
  colunasFaltando: string[]
  linhasComErro: LinhaComErro[]
  totais: {
    totalLinhasValidas: number
    linhasProntas: number
    linhasJaImportadas: number
    clientesNovos: number
    clientesAtualizados: number
    deltaRiscoTotal: number
    clientesComAumentoDeVencido: number
    totalNovosAlertas: number
    planosAtrasadosExistentes: number
    clientesComMudancaDeStatus: number
  }
}

export interface ResultadoConfirmacaoImportacao {
  importacaoId: string
  semanaRef: string
  snapshotsGravados: number
  clientesCriados: number
  alertasGerados: number
}

// ------------------------------------------------------------------ erros

/** Corpo de erro padronizado (RFC 9457 — Problem Details). */
export interface ProblemaApi {
  type: string
  title: string
  status: number
  detail?: string
  codigo?: string
}

export type { Alerta }

// ------------------------------------------------------------ arquivos (MinIO)

/** Todo arquivo que entra ou sai do Monitoramento. */
export type FinalidadeArquivo = 'importado' | 'processado' | 'exportado' | 'anexo'
export const FINALIDADES_ARQUIVO: FinalidadeArquivo[] = ['importado', 'processado', 'exportado', 'anexo']

/** Ciclo de vida: ATIVO ⇄ ARQUIVADO; ATIVO/ARQUIVADO ⇄ EXCLUIDO (lógico,
 * recuperável); EXCLUIDO → EXPURGADO (conteúdo apagado do MinIO, só metadados). */
export type SituacaoArquivo = 'ATIVO' | 'ARQUIVADO' | 'EXCLUIDO' | 'EXPURGADO'
export const SITUACOES_ARQUIVO: SituacaoArquivo[] = ['ATIVO', 'ARQUIVADO', 'EXCLUIDO', 'EXPURGADO']

export interface ArquivoResumo {
  id: string
  finalidade: FinalidadeArquivo
  categoria: string
  situacao: SituacaoArquivo
  nomeOriginal: string
  mime: string
  tamanhoBytes: number
  sha256: string
  versaoAtual: number
  descricao: string | null
  tags: Record<string, string>
  recursoTipo: string | null
  recursoId: string | null
  arquivoOrigemId: string | null
  retencaoAte: string | null
  criadoPor: string | null
  criadoPorNome: string | null
  criadoEm: string
  atualizadoEm: string
  excluidoEm: string | null
  motivoExclusao: string | null
}

export interface VersaoArquivo {
  numero: number
  nomeOriginal: string
  mime: string
  tamanhoBytes: number
  sha256: string
  comentario: string | null
  criadoPorNome: string | null
  criadoEm: string
}

export interface EventoArquivo {
  id: string
  acao: string
  versao: number | null
  atorNome: string | null
  detalhes: Record<string, unknown>
  criadoEm: string
}

export interface FiltroArquivos {
  finalidade?: FinalidadeArquivo
  situacao?: SituacaoArquivo
  categoria?: string
  recursoTipo?: string
  recursoId?: string
  busca?: string
  pagina?: number
  porPagina?: number
}

export interface PaginaArquivos {
  itens: ArquivoResumo[]
  total: number
  pagina: number
  porPagina: number
}

export interface TotaisArquivos {
  porFinalidade: Record<FinalidadeArquivo, { quantidade: number; bytes: number }>
  porSituacao: Record<SituacaoArquivo, number>
}
