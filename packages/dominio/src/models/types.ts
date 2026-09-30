/**
 * MODELO DE DOMÍNIO — EverBlue Monitoramento
 * -------------------------------------------------
 * Tipos usados em toda a aplicação. Mantidos independentes da camada de
 * persistência (Dexie/IndexedDB hoje, Postgres/Supabase amanhã) — as telas
 * e regras de negócio dependem apenas destes tipos e dos repositórios,
 * nunca do Dexie diretamente.
 */

export type StatusCliente = 'NORMAL' | 'MONITORAMENTO' | 'SAIDA_DE_RISCO' | 'JURIDICO'

export type Prioridade = 'BAIXA' | 'MEDIA' | 'ALTA'

export type Criticidade = 'NORMAL' | 'ATENCAO' | 'CRITICA'

export type Gravidade = 'VERDE' | 'AMARELO' | 'VERMELHO'

export type StatusAlerta = 'ABERTO' | 'EM_TRATATIVA' | 'RESOLVIDO'

export type StatusPlano = 'EM_DIA' | 'ATRASADO' | 'CONCLUIDO'

export type StatusProposta = 'EM_ANALISE' | 'APROVADA' | 'VENCIDA' | 'REPROVADA'

export type StatusTranche = 'DENTRO_DO_LIMITE' | 'PROXIMA_DO_LIMITE' | 'EXCEDIDA'

export type TipoEvento =
  | 'MUDANCA_STATUS'
  | 'DECISAO_COMITE'
  | 'PLANO_ACAO'
  | 'ALERTA'
  | 'IMPORTACAO'
  | 'OUTRO'

export interface GrupoEconomico {
  id: string
  nome: string
}

export interface Gerente {
  id: string
  nome: string
  email?: string
}

export interface Plataforma {
  id: string
  nome: string
}

export interface Cliente {
  id: string
  nome: string
  cnpj: string
  grupoEconomicoId: string
  gerenteId: string
  plataformaId: string
  setor: string
  ramoAtividade: string
  produtos: string[]
  status: StatusCliente
  prioridade: Prioridade
  criticidade: Criticidade
  responsavel: string
  criadoEm: string
}

/** Snapshot semanal — imutável, nunca é editado ou apagado após criado. */
export interface SnapshotSemanal {
  id: string
  clienteId: string
  semanaRef: string // data (segunda-feira) representando a posição da semana, ISO yyyy-MM-dd
  criadoEm: string

  // Exposição
  riscoCliente: number
  riscoGrupo: number
  limiteGlobal: number
  percConsumoLimite: number
  statusProposta: StatusProposta
  validadeProposta: string | null
  trancheConsolidada: number
  valorEmAndamento: number
  percConsumoTranche: number
  statusTranche: StatusTranche

  // Inadimplência
  vencidoOficial: number
  vencidoDesde: string | null
  agingCarteiraDias: number
  prazoMedioCarteiraDias: number

  // Liquidez (IL = índice de liquidez, % da carteira liquidada dentro do prazo)
  il30: number
  il60: number
  il90: number
  il120: number
  il150: number
  il180: number

  // Manifestos / qualidade do recebível (R$)
  manifestoPercSemAtuacao: number
  manifestoInacessivel: number
  manifestoNaoConfirma: number
  manifestoTransacaoDesconhecida: number
  manifestoLastroInconsistente: number
  manifestoTransacaoNaoConcluida: number

  // Performance da carteira
  liquidadoNoPeriodo: number
  recompras: number
  motivoRecompra: string | null
  percLiquidadoNoPrazo: number
  atrasoMedioDias: number

  // Restritivos
  restritivos: number
}

/** Evento histórico — append-only. Nunca editar/apagar um evento existente. */
export interface EventoHistorico {
  id: string
  clienteId: string
  data: string
  usuario: string
  tipo: TipoEvento
  valorAnterior: string | null
  valorNovo: string | null
  justificativa: string
  decisaoComiteId: string | null
}

export interface Alerta {
  id: string
  clienteId: string
  tipo: string
  gravidade: Gravidade
  data: string
  descricao: string
  status: StatusAlerta
  responsavel: string
}

export interface PlanoAcao {
  id: string
  clienteId: string
  comiteOrigemId: string | null
  decisaoAnterior: string | null
  dataDecisaoAnterior: string | null
  decisaoAtual: string
  dataDecisaoAtual: string
  prazoRegularizacao: string
  plano: string
  responsavel: string
  oQueFoiFeito: string | null
  oQueNaoFoiFeito: string | null
  status: StatusPlano
  dataLimite: string
  evidencias: string[]
}

/** Dados específicos de quando um cliente está em Saída de Risco. */
export interface SaidaDeRisco {
  id: string
  clienteId: string
  dataEntrada: string
  motivo: string
  riscoNaEntrada: number
  planoSaida: string
  prazoEsperado: string
  responsavel: string
  liquidadoIntegralmente: boolean
}

export type TipoEventoIASR =
  | 'INADIMPLENCIA_RELEVANTE'
  | 'PROTESTO'
  | 'RECUPERACAO_JUDICIAL'
  | 'FALENCIA'
  | 'DETERIORACAO_FINANCEIRA'
  | 'RESTRITIVO_RELEVANTE'
  | 'PROBLEMA_PUBLICO_CREDITO'
  | 'OUTRO'

export interface EventoIASR {
  id: string
  registroIasrId: string
  tipo: TipoEventoIASR
  data: string
  descricao: string
}

/** Registro permanente criado no momento em que o cliente entra em Saída de Risco. */
export interface RegistroIASR {
  id: string
  clienteId: string
  dataDecisao: string
  motivo: string
  riscoExistente: number
  indicadoresNaData: {
    percVencido: number
    ilMedio: number
    aging: number
  }
  decisaoComiteId: string | null
  gerenteId: string
  plataformaId: string
  analista: string
  acompanharAte: string // dataDecisao + 12 meses
}

export interface Juridico {
  id: string
  clienteId: string
  dataEnvio: string
  motivo: string
  medidaAdotada: string
  responsavelJuridico: string
  status: 'EM_ANDAMENTO' | 'ACORDO' | 'ENCERRADO'
  valorRecuperado: number
  saldo: number
  proximoPasso: string
  prazo: string
  ultimaAtualizacao: string
}

export interface Comite {
  id: string
  data: string
  participantes: string[]
  status: 'PLANEJADO' | 'REALIZADO'
}

export interface AtaClienteDiscutido {
  clienteId: string
  riscoTomado: number
  valorVencido: number
  percVencido: number
  manifestosRelevantes: string | null
  principaisAlertas: string[]
  evolucaoDesdeUltimoComite: string
  decisaoAnterior: string | null
  oQueFoiRealizado: string | null
  oQueNaoFoiRealizado: string | null
  novaDecisao: string
  planoAcaoId: string | null
  responsavel: string
  prazo: string
}

export interface AtaPendencia {
  clienteId: string
  decisao: string
  acao: string
  responsavel: string
  prazo: string
  status: StatusPlano
}

export interface Ata {
  id: string
  comiteId: string
  dataGeracao: string
  dataComite: string
  participantes: string[]
  resumoExecutivo: {
    riscoTotal: number
    vencidoTotal: number
    percVencido: number
    principaisVariacoes: string[]
    qtdClientesDiscutidos: number
    qtdMonitoramento: number
    qtdSaidaDeRisco: number
    qtdJuridico: number
  }
  clientesDiscutidos: AtaClienteDiscutido[]
  pendencias: AtaPendencia[]
}

/**
 * Checklist de Análise Semanal — o roteiro ponto a ponto que o executivo
 * percorre em CADA cliente durante a semana, antes de apresentar no comitê
 * (baseado na "Raiz de Apresentação Comitê Monitoramento" da EverBlue).
 * Cada item cruza dado real (quando existe) para sugerir uma gravidade, e
 * guarda o parecer escrito pelo executivo — que pode confirmar ou substituir
 * a sugestão automática antes da apresentação.
 */
export type ChaveItemChecklist =
  | 'RISCO_MENSAL'
  | 'LIMITE_CONSUMIDO'
  | 'TRANCHE_CONSUMIDA'
  | 'RISCO_POR_PRODUTO'
  | 'VENCIDOS'
  | 'VENCIDOS_DESDE_QUANDO'
  | 'PRAZO_MEDIO_CARTEIRA'
  | 'LIQUIDEZ_15_30_60'
  | 'MANIFESTOS'
  | 'COMPORTAMENTO_CALENDARIO'
  | 'EVOLUCAO_RESTRITIVOS'
  | 'AGING_CARTEIRA'
  | 'PRACA_PAGAMENTO'
  | 'PLANO_ACAO_NOVA_DECISAO'
  | 'EVENTOS'
  | 'DADOS_TRANSACIONAIS_CONTA_MOVIMENTO'
  | 'PARECER_JURIDICO'

/** Registro persistido de um item do checklist para um cliente numa semana
 * (só existe depois que o executivo salva; até lá, a tela mostra a sugestão
 * automática calculada em memória). */
export interface ItemChecklistAnalise {
  id: string
  clienteId: string
  semanaRef: string
  item: ChaveItemChecklist
  gravidade: Gravidade
  gravidadeManual: boolean
  parecer: string
  atualizadoEm: string
  atualizadoPor: string
}

/**
 * Movimento mensal da conta do cliente — dado transacional (entradas, saídas,
 * maior pagamento, quantidade de transações) usado para checar se o cliente
 * ainda movimenta a conta com frequência normal ou se há desvio de padrão
 * (queda de volume/frequência, pagamento atípico) frente ao próprio
 * histórico dos últimos 6 meses.
 */
export interface MovimentoContaMensal {
  id: string
  clienteId: string
  mesRef: string // yyyy-MM-01, mês de referência
  entradas: number
  saidas: number
  qtdTransacoes: number
  maiorPagamento: number
}

export interface ConfiguracaoAlerta {
  id: string
  tipo: string
  descricao: string
  limiar: number
  unidade: '%' | 'R$' | 'dias'
  gravidadeSugerida: Gravidade
  ativo: boolean
}

/** Dados agregados/enriquecidos usados nas telas — calculados pela camada de repositórios. */
export interface ClienteEnriquecido extends Cliente {
  grupoEconomico: GrupoEconomico
  gerente: Gerente
  plataforma: Plataforma
  snapshotAtual: SnapshotSemanal | null
  snapshotAnterior: SnapshotSemanal | null
  alertasAbertos: Alerta[]
  planosPendentes: PlanoAcao[]
}

export interface FiltrosGlobais {
  semanaRef: string | null
  plataformaId: string | null
  gerenteId: string | null
  clienteId: string | null
  grupoEconomicoId: string | null
  status: StatusCliente | null
  prioridade: Prioridade | null
  setor: string | null
  ramoAtividade: string | null
  produto: string | null
}
