/**
 * Raiz de composição: o ÚNICO lugar onde implementações concretas são
 * instanciadas e ligadas. Casos de uso e rotas recebem dependências prontas.
 */
import type { Configuracao } from './config/configuracao'
import { ArmazenamentoS3, type ArmazenamentoArquivos } from './infra/armazenamento'
import { criarBanco, type Banco } from './infra/banco'
import { AutenticadorEntra } from './identidade/entra'
import { FonteFotoEmCache, FonteFotoGraph, FonteFotoIntranet, FonteFotoNenhuma, type FonteFoto } from './identidade/fontesFoto'
import { ClienteGraph } from './identidade/graph'
import { ClienteIntranet } from './identidade/intranet'
import { MonitorIntranet } from './identidade/monitorIntranet'
import { ServicoAutorizacao } from './identidade/servicoAutorizacao'
import { ServicoLogin } from './identidade/servicoLogin'
import { AlertaRepositorio } from './repositorios/alertaRepositorio'
import { ArquivoRepositorio } from './repositorios/arquivoRepositorio'
import { AuditoriaRepositorio } from './repositorios/auditoriaRepositorio'
import { CadastrosRepositorio } from './repositorios/cadastrosRepositorio'
import { CarteiraRepositorio } from './repositorios/carteiraRepositorio'
import { ChecklistRepositorio } from './repositorios/checklistRepositorio'
import { ClienteRepositorio } from './repositorios/clienteRepositorio'
import { ComiteRepositorio } from './repositorios/comiteRepositorio'
import { ConfiguracaoRepositorio } from './repositorios/configuracaoRepositorio'
import { EventoRepositorio } from './repositorios/eventoRepositorio'
import { ImportacaoRepositorio } from './repositorios/importacaoRepositorio'
import { PlanoAcaoRepositorio } from './repositorios/planoAcaoRepositorio'
import { RestritivoRepositorio } from './repositorios/restritivoRepositorio'
import { ClassificacaoRepositorio } from './repositorios/classificacaoRepositorio'
import { ServicoPlanos } from './servicos/servicoPlanos'
import { ServicoRestritivos } from './servicos/servicoRestritivos'
import { SnapshotRepositorio } from './repositorios/snapshotRepositorio'
import { UsuarioRepositorio } from './repositorios/usuarioRepositorio'
import { Cofre } from './seguranca/cofre'
import { EmissorSessao } from './seguranca/sessao'
import { EstadoAssinado } from './seguranca/estadoAssinado'
import { ServicoCarteira } from './servicos/servicoCarteira'
import { ServicoChecklist } from './servicos/servicoChecklist'
import { ServicoComite } from './servicos/servicoComite'
import { ServicoDecisao } from './servicos/servicoDecisao'
import { ServicoArquivos } from './servicos/servicoArquivos'
import { ServicoExpurgoFotos } from './servicos/servicoExpurgoFotos'
import { exportadorCarteira, exportadorPlanos, ServicoExportacao } from './servicos/servicoExportacao'
import { ServicoImportacao } from './servicos/servicoImportacao'
import { LeitorBitfinSqlServer, type LeitorBitfin } from './infra/bitfin'
import { FotoRepositorio } from './repositorios/fotoRepositorio'
import { AgendadorFoto, ServicoFotoBitfin } from './servicos/servicoFotoBitfin'
import { IntegracaoRepositorio } from './repositorios/integracaoRepositorio'
import type { GatewayLegado } from './infra/gatewayLegado'
import { MapaRepositorio } from './repositorios/mapaRepositorio'
import { ServicoMapaGarantias } from './servicos/servicoMapaGarantias'
import { criarEnviadorEmail, type EnviadorEmail } from './infra/email'

export interface Dependencias {
  cfg: Configuracao
  banco: Banco
  armazenamento: ArmazenamentoArquivos
  sessao: EmissorSessao
  estadoOidc: EstadoAssinado
  entra: AutenticadorEntra
  intranet: ClienteIntranet
  monitorIntranet: MonitorIntranet
  fonteFoto: FonteFoto
  login: ServicoLogin
  autorizacao: ServicoAutorizacao
  cofre: Cofre
  repos: {
    usuarios: UsuarioRepositorio
    auditoria: AuditoriaRepositorio
    cadastros: CadastrosRepositorio
    clientes: ClienteRepositorio
    snapshots: SnapshotRepositorio
    alertas: AlertaRepositorio
    eventos: EventoRepositorio
    planos: PlanoAcaoRepositorio
    carteira: CarteiraRepositorio
    comites: ComiteRepositorio
    configuracoes: ConfiguracaoRepositorio
    checklist: ChecklistRepositorio
    restritivos: RestritivoRepositorio
    classificacoes: ClassificacaoRepositorio
    fotos: FotoRepositorio
    mapa: MapaRepositorio
    integracao: IntegracaoRepositorio
  }
  servicos: {
    carteira: ServicoCarteira
    checklist: ServicoChecklist
    comite: ServicoComite
    decisao: ServicoDecisao
    importacao: ServicoImportacao
    arquivos: ServicoArquivos
    exportacao: ServicoExportacao
    planos: ServicoPlanos
    restritivos: ServicoRestritivos
    fotoBitfin: ServicoFotoBitfin
    mapaGarantias: ServicoMapaGarantias
    expurgoFotos: ServicoExpurgoFotos
  }
  leitorBitfin: LeitorBitfin
  /** Gateway do Bitfin (estado do disjuntor/fila) — null com leitor de teste. */
  gatewayBitfin: GatewayLegado | null
  agendadorFoto: AgendadorFoto
}

export function comporDependencias(cfg: Configuracao, sobrescritas: { banco?: Banco; armazenamento?: ArmazenamentoArquivos; fonteFoto?: FonteFoto; leitorBitfin?: LeitorBitfin; email?: EnviadorEmail; log?: { info: (o: object, m: string) => void; error: (o: object, m: string) => void } } = {}): Dependencias {
  const banco = sobrescritas.banco ?? criarBanco(cfg.databaseUrl, cfg.databasePoolMax)
  const armazenamento = sobrescritas.armazenamento ?? new ArmazenamentoS3(cfg.minio)
  const db = banco.pool
  const cofre = new Cofre(cfg.cofreChave)

  const repos = {
    usuarios: new UsuarioRepositorio(db),
    auditoria: new AuditoriaRepositorio(db),
    cadastros: new CadastrosRepositorio(db),
    clientes: new ClienteRepositorio(db),
    snapshots: new SnapshotRepositorio(db),
    alertas: new AlertaRepositorio(db),
    eventos: new EventoRepositorio(db),
    planos: new PlanoAcaoRepositorio(db),
    carteira: new CarteiraRepositorio(db),
    comites: new ComiteRepositorio(db),
    configuracoes: new ConfiguracaoRepositorio(db),
    checklist: new ChecklistRepositorio(db),
    restritivos: new RestritivoRepositorio(db),
    classificacoes: new ClassificacaoRepositorio(db),
    fotos: new FotoRepositorio(db),
    mapa: new MapaRepositorio(db),
    integracao: new IntegracaoRepositorio(db, cfg.ambiente),
  }

  const entra = new AutenticadorEntra(cfg)
  const intranet = new ClienteIntranet(cfg)
  const graph = new ClienteGraph(cfg)
  const fonteFoto =
    sobrescritas.fonteFoto ??
    new FonteFotoEmCache(
      cfg.fotoFonte === 'graph' ? new FonteFotoGraph(graph) : cfg.fotoFonte === 'intranet' ? new FonteFotoIntranet(intranet) : new FonteFotoNenhuma(),
    )

  const arquivoRepositorio = new ArquivoRepositorio(db)
  const arquivos = new ServicoArquivos(banco, armazenamento, arquivoRepositorio, repos.auditoria, cfg.arquivos)
  const carteira = new ServicoCarteira(repos.clientes, repos.snapshots, repos.cadastros, repos.alertas, repos.planos, repos.eventos, repos.carteira, repos.classificacoes)
  const comite = new ServicoComite(
    banco, repos.comites, repos.planos, repos.clientes, repos.alertas, repos.snapshots, repos.cadastros, carteira,
    repos.classificacoes, repos.checklist, repos.eventos, repos.restritivos,
  )
  const importacao = new ServicoImportacao(
    banco,
    armazenamento,
    arquivoRepositorio,
    new ImportacaoRepositorio(db),
    repos.clientes,
    repos.snapshots,
    repos.cadastros,
    repos.configuracoes,
    repos.planos,
    repos.eventos,
    repos.alertas,
    repos.auditoria,
    cfg.importacao,
    repos.restritivos,
    repos.classificacoes,
  )
  const expurgoFotos = new ServicoExpurgoFotos(banco, arquivos, repos.auditoria, cfg.retencaoFotoTesteDias, sobrescritas.log)
  const leitorBitfin = sobrescritas.leitorBitfin ?? new LeitorBitfinSqlServer(cfg.bitfin, (e) => repos.integracao.registrar(e), sobrescritas.log)
  const mapaGarantias = new ServicoMapaGarantias(repos.mapa, sobrescritas.email ?? criarEnviadorEmail(cfg), armazenamento, arquivoRepositorio, repos.auditoria, sobrescritas.log, leitorBitfin)
  const fotoBitfin = new ServicoFotoBitfin(
    leitorBitfin,
    repos.fotos,
    importacao,
    repos.clientes,
    repos.snapshots,
    repos.comites,
    repos.classificacoes,
    armazenamento,
    arquivoRepositorio,
    repos.auditoria,
    sobrescritas.log,
    { documentos: () => mapaGarantias.documentos(), gravar: (fotoId, docs, dados) => repos.mapa.gravarFotoMapa(fotoId, docs, dados) },
  )
  fotoBitfin.aoConcluirAgendada((execucao) => mapaGarantias.enviarDiario(execucao))
  fotoBitfin.aoFalharAgendada((execucao) => mapaGarantias.avisarFalhaDaFoto(execucao))
  const servicos = {
    carteira,
    checklist: new ServicoChecklist(repos.clientes, repos.snapshots, repos.planos, repos.alertas, repos.carteira, repos.checklist, carteira, repos.restritivos, repos.fotos),
    comite,
    decisao: new ServicoDecisao(banco, repos.planos, repos.eventos, repos.clientes, repos.auditoria, () => comite.garantirProximoPlanejado()),
    importacao,
    fotoBitfin,
    mapaGarantias,
    expurgoFotos,
    planos: new ServicoPlanos(banco, repos.planos, repos.eventos, repos.auditoria),
    restritivos: new ServicoRestritivos(banco, repos.restritivos, repos.clientes, repos.eventos, repos.alertas, repos.configuracoes, repos.auditoria, repos.snapshots),
    arquivos,
    // Exportações registradas: para uma nova, basta acrescentar aqui.
    exportacao: new ServicoExportacao(arquivos, [
      exportadorCarteira((f) => carteira.listarEnriquecidos(f)),
      exportadorPlanos(() => repos.planos.listarTodos(), (f) => repos.clientes.listar(f)),
    ]),
  }

  return {
    cfg,
    banco,
    armazenamento,
    sessao: new EmissorSessao(cfg.sessaoSegredo, cfg.sessaoHoras),
    estadoOidc: new EstadoAssinado(cfg.sessaoSegredo, 'emon-oidc'),
    entra,
    intranet,
    monitorIntranet: new MonitorIntranet(intranet, repos.auditoria),
    fonteFoto,
    login: new ServicoLogin(cfg, banco, entra, intranet, graph, repos.usuarios, repos.auditoria),
    autorizacao: new ServicoAutorizacao(cfg, repos.usuarios, repos.auditoria, intranet, graph),
    cofre,
    repos,
    servicos,
    leitorBitfin,
    gatewayBitfin: leitorBitfin instanceof LeitorBitfinSqlServer ? leitorBitfin.gateway : null,
    agendadorFoto: new AgendadorFoto(fotoBitfin, repos.fotos, sobrescritas.log ?? { info: () => {}, error: () => {} }, 60_000, expurgoFotos),
  }
}
