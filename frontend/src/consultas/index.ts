/**
 * Estado de servidor da interface (TanStack Query) — skill Everblue, Front-end
 * React: cache, deduplicação de pedidos iguais, retentativa controlada e
 * invalidação depois de cada alteração. As telas usam estas definições; o
 * acesso HTTP continua só nos repositórios (`src/repositories`).
 *
 * Chaves por domínio (o primeiro elemento) para invalidar por prefixo.
 */
import { QueryClient, queryOptions, type QueryKey } from '@tanstack/react-query'
import type { DimensaoRisco, FiltroArquivos, FiltrosGlobais } from '@monitoramento/dominio'
import { ErroApi } from '../api/cliente'
import {
  alertaRepository,
  arquivoRepository,
  cadastrosRepository,
  checklistRepository,
  classificacaoRepository,
  clienteRepository,
  comiteAtaRepository,
  configRepository,
  dashboardRepository,
  eventoRepository,
  fotoBitfinRepository,
  iasrRepository,
  juridicoRepository,
  mapaGarantiasRepository,
  movimentoContaRepository,
  planoAcaoRepository,
  restritivoRepository,
  saidaDeRiscoRepository,
  saudeRepository,
  sessaoRepository,
  snapshotRepository,
} from '../repositories'

/**
 * Retentativa controlada: só GET e só falha de rede ou 5xx, uma vez. 4xx
 * (validação, autorização, não encontrado) nunca se repete — e nada aqui
 * chega ao Bitfin: o servidor decide quando consultá-lo (ADR-020).
 */
export function criarClienteConsultas(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: (tentativas, erro) => tentativas < 1 && (!(erro instanceof ErroApi) || erro.status === 0 || erro.status >= 500),
      },
      mutations: { retry: false },
    },
  })
}

const filtrosChave = (f: Partial<FiltrosGlobais>) => JSON.stringify(f)

export const consultas = {
  sessao: () => queryOptions({ queryKey: ['sessao'], queryFn: sessaoRepository.obter, retry: false, staleTime: Infinity }),
  modoAutenticacao: () => queryOptions({ queryKey: ['sessao', 'modo'], queryFn: sessaoRepository.modo, retry: false }),
  saudeIntranet: () => queryOptions({ queryKey: ['saude', 'intranet'], queryFn: saudeRepository.intranet, staleTime: 0, retry: false }),

  grupos: () => queryOptions({ queryKey: ['cadastros', 'grupos'], queryFn: cadastrosRepository.listarGrupos }),
  gerentes: () => queryOptions({ queryKey: ['cadastros', 'gerentes'], queryFn: cadastrosRepository.listarGerentes }),
  plataformas: () => queryOptions({ queryKey: ['cadastros', 'plataformas'], queryFn: cadastrosRepository.listarPlataformas }),
  carteiras: () => queryOptions({ queryKey: ['cadastros', 'carteiras'], queryFn: cadastrosRepository.listarCarteiras }),

  clientes: () => queryOptions({ queryKey: ['clientes', 'todos'], queryFn: clienteRepository.listarTodos }),
  cliente: (id: string) => queryOptions({ queryKey: ['clientes', 'id', id], queryFn: () => clienteRepository.porId(id) }),
  clientesEnriquecidos: (f: FiltrosGlobais) => queryOptions({ queryKey: ['clientes', 'enriquecidos', filtrosChave(f)], queryFn: () => clienteRepository.listarEnriquecidos(f) }),
  valoresDistintos: () => queryOptions({ queryKey: ['clientes', 'valores-distintos'], queryFn: clienteRepository.valoresDistintos }),
  documentosCliente: (id: string) => queryOptions({ queryKey: ['clientes', 'documentos', id], queryFn: () => clienteRepository.documentos(id) }),

  restritivos: (clienteId: string) => queryOptions({ queryKey: ['restritivos', clienteId], queryFn: () => restritivoRepository.porCliente(clienteId) }),
  classificacoesCliente: (clienteId: string) => queryOptions({ queryKey: ['classificacoes', 'cliente', clienteId], queryFn: () => classificacaoRepository.porCliente(clienteId) }),

  semanas: () => queryOptions({ queryKey: ['snapshots', 'semanas'], queryFn: snapshotRepository.listarSemanasDisponiveis }),
  snapshotsCliente: (clienteId: string) => queryOptions({ queryKey: ['snapshots', 'cliente', clienteId], queryFn: () => snapshotRepository.porCliente(clienteId) }),
  snapshotClienteSemana: (clienteId: string, semanaRef: string) =>
    queryOptions({ queryKey: ['snapshots', 'cliente', clienteId, semanaRef], queryFn: () => snapshotRepository.porClienteESemana(clienteId, semanaRef) }),

  alertas: () => queryOptions({ queryKey: ['alertas', 'todos'], queryFn: alertaRepository.listarTodos }),
  alertasCliente: (clienteId: string) => queryOptions({ queryKey: ['alertas', 'cliente', clienteId], queryFn: () => alertaRepository.porCliente(clienteId) }),
  eventosCliente: (clienteId: string) => queryOptions({ queryKey: ['eventos', 'cliente', clienteId], queryFn: () => eventoRepository.porCliente(clienteId) }),
  eventosRecentes: (limite = 50) => queryOptions({ queryKey: ['eventos', 'recentes', limite], queryFn: () => eventoRepository.recentes(limite) }),
  planos: () => queryOptions({ queryKey: ['planos', 'todos'], queryFn: planoAcaoRepository.listarTodos }),
  planosCliente: (clienteId: string) => queryOptions({ queryKey: ['planos', 'cliente', clienteId], queryFn: () => planoAcaoRepository.porCliente(clienteId) }),
  saidas: () => queryOptions({ queryKey: ['saidas', 'todos'], queryFn: saidaDeRiscoRepository.listarTodos }),
  saidaCliente: (clienteId: string) => queryOptions({ queryKey: ['saidas', 'cliente', clienteId], queryFn: () => saidaDeRiscoRepository.porCliente(clienteId) }),
  juridico: () => queryOptions({ queryKey: ['juridico', 'todos'], queryFn: juridicoRepository.listarTodos }),
  juridicoCliente: (clienteId: string) => queryOptions({ queryKey: ['juridico', 'cliente', clienteId], queryFn: () => juridicoRepository.porCliente(clienteId) }),
  iasrRegistros: () => queryOptions({ queryKey: ['iasr', 'registros'], queryFn: iasrRepository.listarComEventos }),
  iasrIndicadores: () => queryOptions({ queryKey: ['iasr', 'indicadores'], queryFn: iasrRepository.calcularIndicadores }),
  movimentos: (clienteId: string) => queryOptions({ queryKey: ['movimentos', clienteId], queryFn: () => movimentoContaRepository.analise(clienteId) }),

  kpis: (f: FiltrosGlobais) => queryOptions({ queryKey: ['dashboard', 'kpis', filtrosChave(f)], queryFn: () => dashboardRepository.obterKPIs(f) }),
  serieSemanal: (f: FiltrosGlobais) => queryOptions({ queryKey: ['dashboard', 'serie', filtrosChave(f)], queryFn: () => dashboardRepository.serieEvolucaoSemanal(f) }),
  riscoPorDimensao: (f: FiltrosGlobais, d: DimensaoRisco) =>
    queryOptions({ queryKey: ['dashboard', 'dimensao', d, filtrosChave(f)], queryFn: () => dashboardRepository.riscoPorDimensao(f, d) }),
  ranking: (f: FiltrosGlobais, d: 'gerenteId' | 'plataformaId') => queryOptions({ queryKey: ['dashboard', 'ranking', d, filtrosChave(f)], queryFn: () => dashboardRepository.rankingPorDimensao(f, d) }),
  criticidade: (f: FiltrosGlobais) => queryOptions({ queryKey: ['dashboard', 'criticidade', filtrosChave(f)], queryFn: () => dashboardRepository.clientesPorCriticidade(f) }),
  painelSemanal: (f: FiltrosGlobais) => queryOptions({ queryKey: ['dashboard', 'painel', filtrosChave(f)], queryFn: () => dashboardRepository.painelSemanal(f) }),
  entradasSaidas: (f: FiltrosGlobais) => queryOptions({ queryKey: ['dashboard', 'entradas-saidas', filtrosChave(f)], queryFn: () => dashboardRepository.evolucaoEntradasSaidasMonitoramento(f) }),

  checklist: (clienteId: string, semanaRef: string) => queryOptions({ queryKey: ['checklist', clienteId, semanaRef], queryFn: () => checklistRepository.obterChecklist(clienteId, semanaRef) }),
  /** Selo por linha: o repositório junta os pedidos do mesmo ciclo numa chamada só. */
  resumoChecklist: (clienteId: string, semanaRef: string) =>
    queryOptions({ queryKey: ['checklist', 'resumo', semanaRef, clienteId], queryFn: () => checklistRepository.resumo(clienteId, semanaRef) }),

  comites: () => queryOptions({ queryKey: ['comites', 'todos'], queryFn: comiteAtaRepository.listarComites }),
  proximoComite: () => queryOptions({ queryKey: ['comites', 'proximo'], queryFn: comiteAtaRepository.proximoComitePlanejado }),
  pauta: () => queryOptions({ queryKey: ['comites', 'pauta'], queryFn: comiteAtaRepository.pauta }),
  ultimaAta: () => queryOptions({ queryKey: ['comites', 'ultima-ata'], queryFn: comiteAtaRepository.ultimaAtaRealizada }),
  decisoesRegistradas: (comiteId: string) => queryOptions({ queryKey: ['comites', 'decisoes', comiteId], queryFn: () => comiteAtaRepository.decisoesRegistradas(comiteId) }),

  configuracoesAlerta: () => queryOptions({ queryKey: ['config', 'alertas'], queryFn: configRepository.listarConfiguracoesAlerta }),
  regras: () => queryOptions({ queryKey: ['config', 'regras'], queryFn: configRepository.listarRegras }),

  situacaoFoto: () => queryOptions({ queryKey: ['foto', 'situacao'], queryFn: fotoBitfinRepository.situacao }),
  execucoesFoto: () => queryOptions({ queryKey: ['foto', 'execucoes'], queryFn: () => fotoBitfinRepository.execucoes() }),
  comparacaoFoto: (id: string) => queryOptions({ queryKey: ['foto', 'comparacao', id], queryFn: () => fotoBitfinRepository.comparacao(id), staleTime: Infinity }),
  bitfinDoCliente: (clienteId: string, ate?: string) => queryOptions({ queryKey: ['foto', 'cliente', clienteId, ate ?? null], queryFn: () => fotoBitfinRepository.doCliente(clienteId, ate) }),

  telaMapa: () => queryOptions({ queryKey: ['mapa', 'tela'], queryFn: mapaGarantiasRepository.tela }),
  enviosMapa: () => queryOptions({ queryKey: ['mapa', 'envios'], queryFn: mapaGarantiasRepository.envios }),

  arquivos: (f: FiltroArquivos) => queryOptions({ queryKey: ['arquivos', 'lista', JSON.stringify(f)], queryFn: () => arquivoRepository.listar(f) }),
  arquivo: (id: string) => queryOptions({ queryKey: ['arquivos', 'id', id], queryFn: () => arquivoRepository.obter(id) }),
  versoesArquivo: (id: string) => queryOptions({ queryKey: ['arquivos', 'versoes', id], queryFn: () => arquivoRepository.versoes(id) }),
  eventosArquivo: (id: string) => queryOptions({ queryKey: ['arquivos', 'eventos', id], queryFn: () => arquivoRepository.eventos(id) }),
  categoriasArquivo: () => queryOptions({ queryKey: ['arquivos', 'categorias'], queryFn: arquivoRepository.categorias }),
  politicaArquivos: () => queryOptions({ queryKey: ['arquivos', 'politica'], queryFn: arquivoRepository.politica, staleTime: Infinity }),
  totaisArquivos: () => queryOptions({ queryKey: ['arquivos', 'totais'], queryFn: arquivoRepository.totais }),
}

/** Grupos de dados afetados por cada tipo de alteração (invalidação por prefixo). */
export const AFETADOS = {
  /** Decisão de comitê, plano, checklist, restritivo, posição nova: muda a carteira. */
  carteira: [['clientes'], ['snapshots'], ['alertas'], ['eventos'], ['planos'], ['saidas'], ['juridico'], ['iasr'], ['dashboard'], ['checklist'], ['classificacoes'], ['restritivos'], ['comites']],
  foto: [['foto']],
  mapa: [['mapa']],
  arquivos: [['arquivos']],
  config: [['config'], ['cadastros']],
} satisfies Record<string, QueryKey[]>

export function invalidar(cliente: QueryClient, ...grupos: (keyof typeof AFETADOS)[]): Promise<void> {
  return Promise.all(grupos.flatMap((g) => AFETADOS[g].map((queryKey) => cliente.invalidateQueries({ queryKey })))).then(() => undefined)
}
