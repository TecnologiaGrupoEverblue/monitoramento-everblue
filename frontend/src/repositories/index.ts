/**
 * Repositórios da interface — mesma assinatura que o protótipo expunha, agora
 * sobre a API. As telas continuam falando só com esta camada.
 */
import {
  GRUPOS_CHECKLIST,
  ITENS_CHECKLIST,
  semanaAnteriorRef,
  semanaMesAnteriorRef,
  type Alerta,
  type AnaliseTransacional,
  type Ata,
  type ArquivoResumo,
  type ChaveItemChecklist,
  type EventoArquivo,
  type FiltroArquivos,
  type FinalidadeArquivo,
  type PaginaArquivos,
  type TotaisArquivos,
  type VersaoArquivo,
  type Cliente,
  type ClienteEnriquecido,
  type Comite,
  type ConfiguracaoAlerta,
  type DimensaoRisco,
  type EventoHistorico,
  type FiltrosGlobais,
  type Gerente,
  type Gravidade,
  type GrupoEconomico,
  type IndicadoresIASR,
  type ItemChecklistView,
  type Juridico,
  type KPIsDashboard,
  type ModoAutenticacao,
  type PlanoAcao,
  type Plataforma,
  type PreviewImportacao,
  type RankingDimensao,
  type RegistroIasrComEventos,
  type ResultadoConfirmacaoImportacao,
  type ResumoChecklist,
  type RiscoPorDimensaoItem,
  type SaidaDeRisco,
  type SessaoUsuario,
  type SnapshotSemanal,
} from '@monitoramento/dominio'
import { addDays, format } from 'date-fns'
import { api, enviarComProgresso, requisitar } from '../api/cliente'

export { FILTROS_VAZIOS } from '@monitoramento/dominio'
export { GRUPOS_CHECKLIST, ITENS_CHECKLIST, semanaAnteriorRef, semanaMesAnteriorRef }
export type { IndicadoresIASR, ItemChecklistView, KPIsDashboard, PreviewImportacao, RankingDimensao, RegistroIasrComEventos }

const V1 = '/api/v1'
type Consulta = Record<string, string | null | undefined>
const consultaDe = (filtros: Partial<FiltrosGlobais>): Consulta => ({ ...(filtros as Consulta) })
const cod = encodeURIComponent

// ------------------------------------------------------------------ sessão

export const sessaoRepository = {
  obter: () => requisitar<SessaoUsuario>('GET', `${V1}/sessao`, { tratarSessao: false }),
  modo: () => api.get<ModoAutenticacao>(`${V1}/autenticacao/modo`),
  sair: () => api.post<void>(`${V1}/sessao/sair`),
  urlFoto: `${V1}/sessao/foto`,
  entrarEmergencia: (email: string, senha: string, destino: string) =>
    requisitar<{ destino: string }>('POST', `${V1}/autenticacao/emergencia`, { corpo: { email, senha, destino }, tratarSessao: false }),
}

// ------------------------------------------------------------------ cadastros

async function comoMapa<T extends { id: string }>(lista: Promise<T[]>): Promise<Map<string, T>> {
  return new Map((await lista).map((item) => [item.id, item]))
}

export const cadastrosRepository = {
  listarGrupos: () => api.get<GrupoEconomico[]>(`${V1}/cadastros/grupos`),
  listarGerentes: () => api.get<Gerente[]>(`${V1}/cadastros/gerentes`),
  listarPlataformas: () => api.get<Plataforma[]>(`${V1}/cadastros/plataformas`),
  mapaGrupos: () => comoMapa(cadastrosRepository.listarGrupos()),
  mapaGerentes: () => comoMapa(cadastrosRepository.listarGerentes()),
  mapaPlataformas: () => comoMapa(cadastrosRepository.listarPlataformas()),
}

// ------------------------------------------------------------------ clientes e snapshots

export const clienteRepository = {
  listarTodos: () => api.get<Cliente[]>(`${V1}/clientes`),
  porId: (id: string) => api.get<Cliente>(`${V1}/clientes/${cod(id)}`).catch(() => null),
  listarEnriquecidos: (filtros: FiltrosGlobais) => api.get<ClienteEnriquecido[]>(`${V1}/clientes/enriquecidos`, consultaDe(filtros)),
  valoresDistintos: () => api.get<{ setores: string[]; ramos: string[]; produtos: string[] }>(`${V1}/clientes/valores-distintos`),
}

export const snapshotRepository = {
  listarSemanasDisponiveis: () => api.get<string[]>(`${V1}/snapshots/semanas`),
  async ultimaSemanaDisponivel(): Promise<string | null> {
    const semanas = await snapshotRepository.listarSemanasDisponiveis()
    return semanas.length > 0 ? semanas[semanas.length - 1] : null
  },
  porCliente: (clienteId: string) => api.get<SnapshotSemanal[]>(`${V1}/snapshots/cliente/${cod(clienteId)}`),
  porClienteESemana: (clienteId: string, semanaRef: string) =>
    api.get<SnapshotSemanal | null>(`${V1}/snapshots/cliente/${cod(clienteId)}/semana/${cod(semanaRef)}`),
}

// ------------------------------------------------------------------ alertas, eventos, planos

export const alertaRepository = {
  listarTodos: () => api.get<Alerta[]>(`${V1}/alertas`),
  porCliente: (clienteId: string) => api.get<Alerta[]>(`${V1}/alertas/cliente/${cod(clienteId)}`),
}

export const eventoRepository = {
  porCliente: (clienteId: string) => api.get<EventoHistorico[]>(`${V1}/eventos/cliente/${cod(clienteId)}`),
  recentes: (limite = 50) => api.get<EventoHistorico[]>(`${V1}/eventos/recentes`, { limite: String(limite) }),
}

export const planoAcaoRepository = {
  listarTodos: () => api.get<PlanoAcao[]>(`${V1}/planos`),
  porCliente: (clienteId: string) => api.get<PlanoAcao[]>(`${V1}/planos/cliente/${cod(clienteId)}`),
}

// ------------------------------------------------------------------ carteira

export const saidaDeRiscoRepository = {
  listarTodos: () => api.get<SaidaDeRisco[]>(`${V1}/saidas-de-risco`),
  porCliente: (clienteId: string) => api.get<SaidaDeRisco | null>(`${V1}/saidas-de-risco/cliente/${cod(clienteId)}`),
}

export const juridicoRepository = {
  listarTodos: () => api.get<Juridico[]>(`${V1}/juridico`),
  porCliente: (clienteId: string) => api.get<Juridico | null>(`${V1}/juridico/cliente/${cod(clienteId)}`),
}

export const iasrRepository = {
  listarComEventos: () => api.get<RegistroIasrComEventos[]>(`${V1}/iasr/registros`),
  calcularIndicadores: () => api.get<IndicadoresIASR>(`${V1}/iasr/indicadores`),
}

export const movimentoContaRepository = {
  analise: (clienteId: string) => api.get<AnaliseTransacional | null>(`${V1}/movimentos/cliente/${cod(clienteId)}/analise`),
}

// ------------------------------------------------------------------ dashboard

export const dashboardRepository = {
  obterKPIs: (filtros: FiltrosGlobais) => api.get<KPIsDashboard>(`${V1}/dashboard/kpis`, consultaDe(filtros)),
  serieEvolucaoSemanal: (filtros: FiltrosGlobais) => api.get<{ semana: string; risco: number; vencido: number }[]>(`${V1}/dashboard/serie-semanal`, consultaDe(filtros)),
  riscoPorDimensao: (filtros: FiltrosGlobais, dimensao: DimensaoRisco) =>
    api.get<RiscoPorDimensaoItem[]>(`${V1}/dashboard/risco-por-dimensao`, { ...consultaDe(filtros), dimensao }),
  rankingPorDimensao: (filtros: FiltrosGlobais, dimensao: 'gerenteId' | 'plataformaId') =>
    api.get<RankingDimensao[]>(`${V1}/dashboard/ranking`, { ...consultaDe(filtros), dimensao }),
  clientesPorCriticidade: (filtros: FiltrosGlobais) => api.get<{ criticidade: string; qtd: number; clienteIds: string[] }[]>(`${V1}/dashboard/criticidade`, consultaDe(filtros)),
  evolucaoEntradasSaidasMonitoramento: (filtros: FiltrosGlobais) =>
    api.get<{ semana: string; entradas: number; saidas: number }[]>(`${V1}/dashboard/entradas-saidas`, consultaDe(filtros)),
}

// ------------------------------------------------------------------ checklist

/** Agrupa os pedidos de resumo feitos no mesmo ciclo de renderização (um selo
 * por linha de tabela) numa única chamada à API. */
const loteResumos = new Map<string, { ids: Set<string>; espera: Promise<Record<string, ResumoChecklist>> }>()
function resumoEmLote(clienteId: string, semanaRef: string): Promise<ResumoChecklist> {
  let lote = loteResumos.get(semanaRef)
  if (!lote) {
    const ids = new Set<string>()
    const espera = new Promise<Record<string, ResumoChecklist>>((resolver, rejeitar) => {
      setTimeout(() => {
        loteResumos.delete(semanaRef)
        const todos = [...ids]
        const partes: Promise<Record<string, ResumoChecklist>>[] = []
        for (let i = 0; i < todos.length; i += 300) {
          partes.push(api.post<Record<string, ResumoChecklist>>(`${V1}/checklist/resumos`, { semanaRef, clienteIds: todos.slice(i, i + 300) }))
        }
        Promise.all(partes)
          .then((r) => resolver(Object.assign({}, ...r)))
          .catch(rejeitar)
      }, 15)
    })
    lote = { ids, espera }
    loteResumos.set(semanaRef, lote)
  }
  lote.ids.add(clienteId)
  return lote.espera.then((mapa) => mapa[clienteId] ?? { vermelho: 0, amarelo: 0, verde: 0, semParecer: 0 })
}

export const checklistRepository = {
  obterChecklist: (clienteId: string, semanaRef: string) => api.get<ItemChecklistView[]>(`${V1}/checklist/${cod(clienteId)}/${cod(semanaRef)}`),
  /** `atualizadoPor` é ignorado: quem salvou é sempre a pessoa da sessão. */
  salvarItem: (
    clienteId: string,
    semanaRef: string,
    item: ChaveItemChecklist,
    alteracoes: { parecer?: string; gravidade?: Gravidade; gravidadeManual?: boolean; atualizadoPor?: string },
  ) => {
    const { atualizadoPor: _ignorado, ...corpo } = alteracoes
    void _ignorado
    return api.put<void>(`${V1}/checklist/${cod(clienteId)}/${cod(semanaRef)}/${cod(item)}`, corpo)
  },
  resumo: resumoEmLote,
}

// ------------------------------------------------------------------ comitês e atas

export const comiteAtaRepository = {
  listarComites: () => api.get<Comite[]>(`${V1}/comites`),
  proximoComitePlanejado: () => api.get<Comite | null>(`${V1}/comites/proximo`),
  ultimaAtaRealizada: () => api.get<Ata | null>(`${V1}/comites/ultima-ata`),
  decisoesRegistradas: async (comiteId: string) => (await api.get<{ quantidade: number }>(`${V1}/comites/${cod(comiteId)}/decisoes`)).quantidade,
  gerarAta: (comiteId: string) => api.post<Ata>(`${V1}/comites/${cod(comiteId)}/ata`),
  registrarDecisao: (dados: { clienteId: string; decisao: string; plano: string; prazo: string; responsavel: string }) =>
    api.post<PlanoAcao>(`${V1}/comites/decisoes`, dados),
  sugerirPrazo: (dias = 15) => format(addDays(new Date(), dias), 'yyyy-MM-dd'),
}

// ------------------------------------------------------------------ configurações

export const configRepository = {
  listarConfiguracoesAlerta: () => api.get<ConfiguracaoAlerta[]>(`${V1}/configuracoes/alertas`),
  atualizarConfiguracaoAlerta: (id: string, alteracoes: Pick<Partial<ConfiguracaoAlerta>, 'limiar' | 'ativo'>) =>
    api.patch<void>(`${V1}/configuracoes/alertas/${cod(id)}`, alteracoes),
}

// ------------------------------------------------------------------ importação semanal

export const importacaoRepository = {
  enviarArquivo(arquivo: File, semanaRef: string): Promise<PreviewImportacao> {
    const formulario = new FormData()
    formulario.set('semanaRef', semanaRef)
    formulario.set('arquivo', arquivo, arquivo.name)
    return api.enviar<PreviewImportacao>(`${V1}/importacoes`, formulario)
  },
  recalcularPreview: (importacaoId: string, semanaRef: string) => api.post<PreviewImportacao>(`${V1}/importacoes/${cod(importacaoId)}/previa`, { semanaRef }),
  confirmarImportacao: (importacaoId: string, semanaRef: string) =>
    api.post<ResultadoConfirmacaoImportacao>(`${V1}/importacoes/${cod(importacaoId)}/confirmar`, { semanaRef }),
}

// ------------------------------------------------------------------ Central de Arquivos (MinIO)

export interface DadosEnvioArquivo {
  finalidade: FinalidadeArquivo
  categoria: string
  descricao?: string
  retencaoAte?: string
  recursoTipo?: string
  recursoId?: string
  tags?: Record<string, string>
}

/** Campos ANTES do arquivo: a API lê o multipart em fluxo, na ordem. */
function formularioArquivo(campos: Record<string, string | undefined>, arquivo: File): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(campos)) if (v) f.append(k, v)
  f.append('arquivo', arquivo, arquivo.name)
  return f
}

/** Remove vazios: a API valida cada filtro presente. */
function semVazios<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== '')) as Partial<T>
}

export const arquivoRepository = {
  listar: (filtro: FiltroArquivos) => api.get<PaginaArquivos>(`${V1}/arquivos`, filtro as Record<string, string | number | undefined>),
  obter: (id: string) => api.get<ArquivoResumo>(`${V1}/arquivos/${cod(id)}`),
  versoes: (id: string) => api.get<VersaoArquivo[]>(`${V1}/arquivos/${cod(id)}/versoes`),
  eventos: (id: string) => api.get<EventoArquivo[]>(`${V1}/arquivos/${cod(id)}/eventos`),
  categorias: () => api.get<string[]>(`${V1}/arquivos/categorias`),
  totais: () => api.get<TotaisArquivos>(`${V1}/arquivos/totais`),
  /** URL de download direto (o navegador baixa em fluxo, sem passar pela memória da página). */
  urlConteudo: (id: string, versao?: number, visualizar = false) =>
    `${V1}/arquivos/${cod(id)}/conteudo${versao || visualizar ? '?' : ''}${[versao ? `versao=${versao}` : '', visualizar ? 'visualizar=1' : ''].filter(Boolean).join('&')}`,
  enviar: (arquivo: File, dados: DadosEnvioArquivo, aoProgredir: (f: number) => void, sinal?: AbortSignal) =>
    enviarComProgresso<ArquivoResumo>(
      `${V1}/arquivos`,
      formularioArquivo({ ...dados, tags: dados.tags && Object.keys(dados.tags).length ? JSON.stringify(dados.tags) : undefined }, arquivo),
      aoProgredir,
      sinal,
    ),
  novaVersao: (id: string, arquivo: File, comentario: string, aoProgredir: (f: number) => void, sinal?: AbortSignal) =>
    enviarComProgresso<ArquivoResumo>(`${V1}/arquivos/${cod(id)}/versoes`, formularioArquivo({ comentario }, arquivo), aoProgredir, sinal),
  restaurarVersao: (id: string, numero: number) => api.post<ArquivoResumo>(`${V1}/arquivos/${cod(id)}/versoes/${numero}/restaurar`),
  atualizar: (id: string, dados: { descricao?: string | null; categoria?: string; tags?: Record<string, string>; retencaoAte?: string | null }) =>
    api.patch<ArquivoResumo>(`${V1}/arquivos/${cod(id)}`, dados),
  arquivar: (id: string) => api.post<ArquivoResumo>(`${V1}/arquivos/${cod(id)}/arquivar`),
  reativar: (id: string) => api.post<ArquivoResumo>(`${V1}/arquivos/${cod(id)}/reativar`),
  excluir: (id: string, motivo: string) => api.post<ArquivoResumo>(`${V1}/arquivos/${cod(id)}/excluir`, { motivo }),
  expurgar: (id: string, motivo: string) => api.post<ArquivoResumo>(`${V1}/arquivos/${cod(id)}/expurgar`, { motivo }),
}

export const exportacaoRepository = {
  /** Gera no servidor, guarda no MinIO e devolve o arquivo já registrado. */
  exportar: (chave: 'carteira' | 'planos-de-acao', filtros: Partial<FiltrosGlobais>) => api.post<ArquivoResumo>(`${V1}/exportacoes/${cod(chave)}`, semVazios(filtros)),
}
