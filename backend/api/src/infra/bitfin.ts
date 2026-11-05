/**
 * Leitor do Bitfin (SQL Server de produção) para a foto — somente leitura.
 *
 * Conexão igual à da Intranet (ADR-014): canal cifrado, sem validar o
 * certificado do SQL Server (decisão do usuário, 29/10/2026 — exceção de TLS
 * registrada). A senha fica só no .env do servidor. Toda consulta passa pelo
 * gateway (gatewayLegado.ts): catálogo fechado, uma conexão por processo,
 * fila limitada, disjuntor, teto por comando com cancelamento real, zero
 * retentativa e trilha de auditoria (ADR-020).
 */
import sql from 'mssql'
import type {
  BitfinAging,
  BitfinAtraso,
  BitfinCliente,
  BitfinConta,
  BitfinEvento,
  BitfinLiquidezJanela,
  BitfinOperacaoPrazo,
  BitfinOperacoesMes,
  BitfinPontualidade,
  BitfinProdutoCliente,
  BitfinProdutoGrupo,
  BitfinProposta,
  BitfinResponsavel,
  DadosFotoBitfin,
  DadosMapaBitfin,
  PapelResponsavel,
} from '@monitoramento/dominio'
import type { Configuracao } from '../config/configuracao'
import { CONSULTAS_FOTO, conferirSomenteLeitura, consultaNomesClientes, consultasMapa, documentoBitfin, parametrosDocumentos, type NomeConsultaFoto } from './bitfinConsultas'
import { ErroBitfin, GatewayLegado, type ContextoOperacao, type EventoIntegracao, type Prazo } from './gatewayLegado'

export { ErroBitfin } from './gatewayLegado'

/** Contrato usado pelo serviço da foto (permite um leitor falso nos testes). */
export interface LeitorBitfin {
  readonly configurado: boolean
  /** Lê tudo de que a foto precisa, numa única conexão. Com `documentosMapa`
   * (só dígitos), lê também a base do Mapa de Garantias desses clientes. */
  ler(opcoes?: { documentosMapa?: string[] }, contexto?: ContextoOperacao): Promise<{ dados: DadosFotoBitfin; mapa?: DadosMapaBitfin; tempoMs: Record<string, number> }>
  /** Conecta e lê a data/hora do servidor (diagnóstico, sem dado de cliente). */
  testar(contexto?: ContextoOperacao): Promise<{ servidorAgora: string; banco: string }>
  /** Nome no Bitfin de cada CPF/CNPJ (só dígitos). Ausente no mapa = não encontrado. */
  buscarNomes(documentos: string[], contexto?: ContextoOperacao): Promise<Map<string, string>>
}


type Linha = Record<string, unknown>

const num = (v: unknown): number => {
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}
const numOuNulo = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
const texto = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim())
const textoOuNulo = (v: unknown): string | null => {
  const t = texto(v)
  return t ? t : null
}
/** Datas do SQL Server chegam como Date em UTC; o Bitfin grava hora local
 * "sem fuso" — a parte de data é a que vale. */
const data = (v: unknown): string | null => {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString()
  const t = String(v).trim()
  return t ? t : null
}
const bool = (v: unknown): boolean => v === true || v === 1 || v === '1'

export function mapearDados(r: Record<NomeConsultaFoto, Linha[]>, lidoEm: string): DadosFotoBitfin {
  const clientes: BitfinCliente[] = r.clientes.map((x) => ({
    clienteId: num(x.ClienteId),
    nome: texto(x.Nome),
    documento: texto(x.Documento),
    situacao: texto(x.Situacao),
    grupoEconomicoId: numOuNulo(x.GrupoEconomicoId),
    grupo: textoOuNulo(x.Grupo),
    cnaeSecao: textoOuNulo(x.CnaeSecao),
    cnaeDenominacao: textoOuNulo(x.CnaeDenominacao),
    risco: num(x.RiscoTotalTotal),
    riscoVencido: num(x.RiscoVencidoTotal),
    indiceLiquidez: numOuNulo(x.IndiceDeLiquidez),
    vencimentario: numOuNulo(x.VencimentarioDaLiquidez),
    liquidados: numOuNulo(x.TotalDosLiquidadosDaLiquidez),
    recomprados: numOuNulo(x.TotalDosRecompradosDaLiquidez),
    dataInicialLiquidez: data(x.DataInicialDaLiquidez),
    dataFinalLiquidez: data(x.DataFinalDaLiquidez),
    dataApuracaoLiquidez: data(x.DataDeApuracaoDaLiquidez),
  }))
  const responsaveis: BitfinResponsavel[] = r.responsaveis.map((x) => ({
    clienteId: num(x.ClienteId),
    papel: texto(x.Papel) as PapelResponsavel,
    membroId: num(x.MembroInternoId),
    nome: textoOuNulo(x.Nome),
    email: textoOuNulo(x.Email)?.toLowerCase() ?? null,
    ativo: bool(x.Ativo),
  }))
  const contas: BitfinConta[] = r.contas.map((x) => ({
    clienteId: num(x.ClienteId),
    contaOperacionalId: num(x.ContaOperacionalId),
    contaCorrenteId: numOuNulo(x.ContaCorrenteId),
    produtoId: num(x.ProdutoId),
    produto: texto(x.Produto),
    unidade: texto(x.Unidade),
    risco: num(x.RiscoTotalTotal),
    riscoVencido: num(x.RiscoVencidoTotal),
    riscoVencidoPrimeiraData: data(x.RiscoVencidoPrimeiraData),
    prorrogados: num(x.ProrrogadosTotal),
    semAtuacao: num(x.SemAtuacaoTotal),
    emAndamento: num(x.TransacaoEmAndamentoTotal),
    naoConcluida: num(x.TransacaoNaoConcluidaTotal),
    lastroInconsistente: num(x.LastroInconsistenteTotal),
    transacaoDesconhecida: num(x.TransacaoDesconhecidaTotal),
    protestado: num(x.ProtestadoTotal),
    concluida: num(x.TransacaoConcluidaTotal),
    promessa: num(x.PromessaDePagamentoTotal),
    ciencia: num(x.CienciaDaTransacaoTotal),
    naoConfirma: num(x.SacadoNaoConfirmaTotal),
    inacessivel: num(x.InacessivelTotal),
    indiceLiquidez: numOuNulo(x.IndiceDeLiquidez),
    vencimentario: numOuNulo(x.VencimentarioDaLiquidez),
    liquidados: numOuNulo(x.TotalDosLiquidadosDaLiquidez),
    recomprados: numOuNulo(x.TotalDosRecompradosDaLiquidez),
    penalizados: numOuNulo(x.TotalDoVencidosPenalizadosDaLiquidez),
  }))
  const produtos: BitfinProdutoCliente[] = r.produtos.map((x) => ({
    clienteId: num(x.ClienteId),
    produtoId: num(x.ProdutoId),
    produto: texto(x.Produto),
    limite: num(x.LimiteOperacional),
    tranche: num(x.Tranche),
    risco: num(x.RiscoTotalTotal),
  }))
  const produtosGrupo: BitfinProdutoGrupo[] = r.produtosGrupo.map((x) => ({
    grupoEconomicoId: num(x.GrupoEconomicoId),
    produtoId: num(x.ProdutoId),
    produto: texto(x.Produto),
    limite: num(x.LimiteOperacional),
    tranche: num(x.Tranche),
    risco: num(x.RiscoTotalTotal),
    concluida: num(x.TransacaoConcluidaTotal),
  }))
  const propostas: BitfinProposta[] = r.propostas.map((x) => ({
    grupoEconomicoId: num(x.GrupoEconomicoId),
    propostaId: num(x.PropostaId),
    totalLimites: num(x.TotalDosLimites),
    validade: data(x.DataDeValidade),
    vigente: bool(x.Vigente),
  }))
  const liquidez: BitfinLiquidezJanela[] = r.liquidez.map((x) => ({
    clienteId: num(x.ClienteId),
    janela: num(x.Janela),
    liquidado: num(x.Liquidado),
    total: num(x.Total),
  }))
  const operacoesPrazo: BitfinOperacaoPrazo[] = r.operacoesPrazo.map((x) => ({
    clienteId: num(x.ClienteId),
    grupo: num(x.Grupo) === 1 ? 1 : 2,
    ordem: num(x.Ordem),
    operacaoId: num(x.OperacaoId),
    data: data(x.DataDeEfetivacao) ?? '',
    produto: texto(x.Produto),
    valorBase: num(x.ValorBase),
    prazo: numOuNulo(x.Prazo),
  }))
  const atrasos: BitfinAtraso[] = r.atrasos.map((x) => ({ clienteId: num(x.ClienteId), valor: num(x.Valor), valorVezesDias: num(x.ValorVezesDias) }))
  const pontualidade: BitfinPontualidade[] = r.pontualidade.map((x) => ({
    documento: texto(x.pesCNPJCPF),
    ano: num(x.ano),
    mes: num(x.mes),
    emDia: num(x.emDia),
    esperado: num(x.esperado),
    pontual: num(x.pontual),
    de8a15: num(x.de8_15),
    de16a30: num(x.de16_30),
    de31a60: num(x.de31_60),
    acima60: num(x.de61_),
    recomprado: num(x.recomprado),
  }))
  const aging: BitfinAging[] = r.aging.map((x) => ({
    documento: texto(x.pesCNPJCPF),
    vencer: {
      ate30: num(x.vencerDe5V_30),
      de31a60: num(x.vencerDe31_60),
      de61a90: num(x.vencerDe61_90),
      de91a180: num(x.vencerDe91_180),
      de181a360: num(x.vencerDe181_360),
      acima360: num(x.vencerDe361_),
    },
    vencido: {
      de6a30: num(x.vencidoDe6_30),
      de31a60: num(x.vencidoDe31_60),
      de61a90: num(x.vencidoDe61_90),
      de91a180: num(x.vencidoDe91_180),
      de181a360: num(x.vencidoDe181_360),
      acima360: num(x.vencidoDe361_),
    },
  }))
  // Uma linha por ocorrência → um evento com a lista de ocorrências.
  const eventosPorChave = new Map<string, BitfinEvento>()
  for (const x of r.eventos) {
    const chave = `${num(x.ClienteId)}:${num(x.EventoId)}`
    let ev = eventosPorChave.get(chave)
    if (!ev) {
      ev = {
        clienteId: num(x.ClienteId),
        eventoId: num(x.EventoId),
        titulo: texto(x.Titulo),
        categoria: textoOuNulo(x.Categoria),
        nivel: numOuNulo(x.Nivel),
        desfecho: numOuNulo(x.Desfecho),
        dataCadastro: data(x.DataDeCadastro) ?? '',
        dataAtualizacao: data(x.DataDeAtualizacao),
        criadoPor: textoOuNulo(x.CriadoPor),
        ocorrencias: [],
      }
      eventosPorChave.set(chave, ev)
    }
    const dataOc = data(x.DataOcorrencia)
    if (dataOc) ev.ocorrencias.push({ data: dataOc, autor: textoOuNulo(x.Autor), categoria: textoOuNulo(x.CategoriaOcorrencia), mensagem: textoOuNulo(x.Mensagem) })
  }
  const operacoesMes: BitfinOperacoesMes[] = r.operacoesMes.map((x) => ({ clienteId: num(x.ClienteId), mesAnterior: num(x.MesAnterior), mesAtual: num(x.MesAtual) }))

  return {
    lidoEm,
    clientes,
    responsaveis,
    contas,
    produtos,
    produtosGrupo,
    propostas,
    liquidez,
    operacoesPrazo,
    atrasos,
    pontualidade,
    aging,
    eventos: [...eventosPorChave.values()],
    operacoesMes,
  }
}

export function mapearMapa(r: Record<string, Linha[]>, lidoEm: string): DadosMapaBitfin {
  const dia = (v: unknown) => data(v)?.slice(0, 10) ?? null
  return {
    lidoEm,
    clientes: (r.clientes ?? []).map((x) => ({ clienteId: num(x.ClienteId), nome: texto(x.Nome), documento: texto(x.Documento), grupo: textoOuNulo(x.Grupo) })),
    contas: (r.contas ?? []).map((x) => ({
      clienteId: num(x.ClienteId),
      contaOperacionalId: num(x.ContaOperacionalId),
      contaCorrenteId: numOuNulo(x.ContaCorrenteId),
      produtoId: num(x.ProdutoId),
      produto: texto(x.Produto),
      unidade: texto(x.Unidade),
      risco: num(x.RiscoTotalTotal),
      prorrogados: num(x.ProrrogadosTotal),
      indiceLiquidez: numOuNulo(x.IndiceDeLiquidez),
    })),
    titulos: (r.titulos ?? []).map((x) => ({
      clienteId: num(x.ClienteId),
      contaOperacionalId: num(x.ContaOperacionalId),
      sacadoId: num(x.SacadoId),
      saldo: num(x.SaldoDevedor),
      vencimento: dia(x.DataDeVencimentoEfetiva) ?? '',
      vencimentoAtual: dia(x.DataDeVencimento),
      vencimentoOriginal: dia(x.DataDeVencimentoOriginal),
      status: numOuNulo(x.Status),
    })),
    garantias: (r.garantias ?? []).map((x) => ({
      clienteId: num(x.ClienteId),
      garantiaId: num(x.GarantiaId),
      tipo: texto(x.Tipo),
      valor: numOuNulo(x.Valor),
      percentual: numOuNulo(x.Percentual),
      status: numOuNulo(x.Status),
      contaOperacionalId: numOuNulo(x.ContaOperacionalId),
      bemTipo: textoOuNulo(x.BemTipo),
      bemDescricao: textoOuNulo(x.BemDescricao),
      valorEmGarantia: numOuNulo(x.ValorEmGarantia),
      vencimento: dia(x.DataDeVencimento),
    })),
    contasGraficas: (r.contasGraficas ?? []).map((x) => ({
      clienteId: num(x.ClienteId),
      contaCorrenteId: num(x.ContaCorrenteId),
      descricao: texto(x.Descricao),
      produto: texto(x.Produto),
      saldo: num(x.Saldo),
      ultimoLancamento: data(x.DataDoUltimoLancamento),
    })),
    responsaveis: (r.responsaveis ?? []).map((x) => ({
      clienteId: num(x.ClienteId),
      papel: texto(x.Papel) as PapelResponsavel,
      membroId: num(x.MembroInternoId),
      nome: textoOuNulo(x.Nome),
      email: textoOuNulo(x.Email)?.toLowerCase() ?? null,
      ativo: bool(x.Ativo),
    })),
  }
}

/** Classifica o erro do driver mssql/tedious no catálogo (sem expor o texto). */
export function classificarErroMssql(e: unknown, etapa: string): ErroBitfin {
  if (e instanceof ErroBitfin) return e
  const err = e as { code?: string; number?: number; message?: string; name?: string }
  const detalhe = (err?.message ?? String(e)).slice(0, 500)
  const codigo = err?.code ?? ''
  if (codigo === 'ELOGIN' || err?.number === 18456) return new ErroBitfin('DB_LEGACY_CREDENTIAL', detalhe, etapa)
  if (codigo === 'ECANCEL' || (codigo === 'ETIMEOUT' && err?.name === 'RequestError')) return new ErroBitfin('DB_LEGACY_QUERY_TIMEOUT', detalhe, etapa)
  if (['ETIMEOUT', 'ESOCKET', 'ECONNCLOSED', 'ECONNRESET', 'EINSTLOOKUP', 'ENOTOPEN', 'ENOCONN', 'EALREADYCONNECTING'].includes(codigo) || err?.name === 'ConnectionError')
    return new ErroBitfin('DB_LEGACY_CONNECT_ERROR', detalhe, etapa)
  return new ErroBitfin('DB_LEGACY_QUERY_ERROR', detalhe, etapa)
}

/** O que o leitor precisa do driver — interface pequena para teste (o dublê
 * cancela e falha como o driver real: ver test/gateway-bitfin.test.ts). */
export interface ComandoSql {
  input(nome: string, tipo: unknown, valor: unknown): unknown
  query(sql: string): Promise<{ recordset?: unknown[] }>
  cancel(): void
}

/**
 * Executa UM comando com teto próprio e cancelamento REAL: no fim do prazo
 * chama `request.cancel()`, que no tedious envia ATTENTION ao SQL Server
 * (o servidor interrompe a consulta). Não começa comando com o prazo vencido.
 */
export async function executarComando(req: ComandoSql, consulta: string, prazo: Prazo, etapa: string): Promise<Linha[]> {
  conferirSomenteLeitura(consulta)
  const restante = prazo.restanteMs()
  if (restante <= 0) throw new ErroBitfin('DB_LEGACY_QUERY_TIMEOUT', 'prazo total esgotado antes do comando', etapa)
  const teto = Math.min(prazo.consultaMs, restante)
  let estourou = false
  const relogio = setTimeout(() => {
    estourou = true
    try {
      req.cancel()
    } catch {
      /* o driver já encerrou */
    }
  }, teto)
  try {
    const r = await req.query(consulta)
    if (estourou) throw new ErroBitfin('DB_LEGACY_QUERY_TIMEOUT', `cancelada após ${teto} ms`, etapa)
    return (r.recordset ?? []) as Linha[]
  } catch (e) {
    if (estourou) throw new ErroBitfin('DB_LEGACY_QUERY_TIMEOUT', `cancelada após ${teto} ms`, etapa)
    throw classificarErroMssql(e, etapa)
  } finally {
    clearTimeout(relogio)
  }
}

/**
 * Leitor do Bitfin pelo gateway: UM pool por processo (máx. 1 conexão, que
 * fecha sozinha após 30 s ociosa), nunca um pool por pedido.
 */
export class LeitorBitfinSqlServer implements LeitorBitfin {
  private pool: sql.ConnectionPool | null = null
  private conectando: Promise<sql.ConnectionPool> | null = null
  readonly gateway: GatewayLegado

  constructor(
    private readonly cfg: Configuracao['bitfin'],
    registrar?: (e: EventoIntegracao) => Promise<void>,
    log?: { info: (o: object, m: string) => void; error: (o: object, m: string) => void },
  ) {
    const p = cfg.protecao
    this.gateway = new GatewayLegado(
      {
        filaMax: p.filaMax,
        disjuntorFalhas: p.disjuntorFalhas,
        disjuntorAbertoMs: p.disjuntorAbertoMs,
        classes: {
          foto: { consultaMs: cfg.timeoutMs, prazoMs: p.prazoFotoMs, esperaFilaMs: p.esperaFilaFotoMs },
          nomes: { consultaMs: p.timeoutNomesMs, prazoMs: p.esperaFilaNomesMs + p.timeoutNomesMs * 2, esperaFilaMs: p.esperaFilaNomesMs },
          diagnostico: { consultaMs: p.timeoutNomesMs, prazoMs: p.esperaFilaNomesMs + p.timeoutNomesMs * 2, esperaFilaMs: p.esperaFilaNomesMs },
        },
      },
      registrar,
      log,
    )
  }

  get configurado(): boolean {
    return this.cfg.configurado
  }

  private async obterPool(): Promise<sql.ConnectionPool> {
    if (!this.cfg.configurado) throw new ErroBitfin('DB_LEGACY_NOT_CONFIGURED')
    if (this.pool?.connected) return this.pool
    if (this.conectando) return this.conectando
    const pool = new sql.ConnectionPool({
      server: this.cfg.servidor,
      port: this.cfg.porta,
      database: this.cfg.banco,
      user: this.cfg.usuario,
      password: this.cfg.senha,
      // Exceção de TLS registrada na ADR-014/ADR-020 (TrustServerCertificate).
      options: { encrypt: true, trustServerCertificate: this.cfg.confiarCertificado, appName: 'everblue-monitoramento', readOnlyIntent: true },
      // Uma conexão no máximo, devolvida ao Bitfin após 30 s sem uso.
      pool: { max: 1, min: 0, idleTimeoutMillis: 30_000 },
      connectionTimeout: 15_000,
      // Teto de segurança do driver; o teto efetivo é por comando (executarComando).
      requestTimeout: this.cfg.timeoutMs + 5_000,
    })
    this.conectando = pool
      .connect()
      .then(() => {
        this.pool = pool
        return pool
      })
      .catch(async (e) => {
        await pool.close().catch(() => {})
        throw classificarErroMssql(e, 'conexao')
      })
      .finally(() => {
        this.conectando = null
      })
    return this.conectando
  }

  /** Encerramento gracioso (SIGTERM): fecha o pool do Bitfin. */
  async encerrar(): Promise<void> {
    const p = this.pool
    this.pool = null
    if (p) await p.close().catch(() => {})
  }

  async testar(contexto: ContextoOperacao = {}): Promise<{ servidorAgora: string; banco: string }> {
    return this.gateway.executar('diagnostico.conexao', contexto, async (prazo) => {
      const pool = await this.obterPool()
      const linhas = await executarComando(pool.request(), 'SELECT SYSDATETIME() AS Agora, DB_NAME() AS Banco', prazo, 'diagnostico')
      const x = linhas[0] ?? {}
      return { valor: { servidorAgora: data(x.Agora) ?? '', banco: texto(x.Banco) }, linhas: linhas.length }
    })
  }

  async buscarNomes(documentos: string[], contexto: ContextoOperacao = {}): Promise<Map<string, string>> {
    const unicos = [...new Set(documentos.map((d) => d.replace(/\D/g, '')).filter(Boolean))].sort()
    if (unicos.length === 0) return new Map()
    // Mesma lista de documentos = mesma resposta para qualquer usuário com
    // acesso ao Mapa (nome do cliente): pode compartilhar a execução.
    return this.gateway.executar(
      'mapa.nomes',
      contexto,
      async (prazo) => {
        const pool = await this.obterPool()
        const req = pool.request()
        parametrosDocumentos(unicos).forEach((v, i) => req.input(`d${i}`, sql.VarChar(15), v))
        const linhas = await executarComando(req, consultaNomesClientes(unicos.length), prazo, 'mapa.nomes')
        const porBitfin = new Map<string, string>()
        for (const l of linhas) {
          const nome = texto(l.Nome).trim()
          if (nome) porBitfin.set(documentoBitfin(texto(l.Documento)), nome)
        }
        const resultado = new Map<string, string>()
        for (const d of unicos) {
          const nome = porBitfin.get(documentoBitfin(d))
          if (nome) resultado.set(d, nome)
        }
        return { valor: resultado, linhas: linhas.length }
      },
      unicos.join(','),
    )
  }

  async ler(opcoes: { documentosMapa?: string[] } = {}, contexto: ContextoOperacao = {}): Promise<{ dados: DadosFotoBitfin; mapa?: DadosMapaBitfin; tempoMs: Record<string, number> }> {
    return this.gateway.executar('foto.leitura', contexto, async (prazo) => {
      const pool = await this.obterPool()
      const lidoEm = new Date().toISOString()
      const tempoMs: Record<string, number> = {}
      const resultado = {} as Record<NomeConsultaFoto, Linha[]>
      // Retrato único: todas as consultas na MESMA transação de leitura. Com
      // SNAPSHOT (se o banco permitir) os números são do mesmo instante e nada
      // é bloqueado; senão, READ COMMITTED (as conferências cruzadas da foto
      // apontam qualquer descompasso). Nada é escrito: a transação é desfeita.
      //
      // O SQL Server só recusa o SNAPSHOT na PRIMEIRA leitura de dados (não no
      // BEGIN): pergunta-se antes ao próprio banco se ele está liberado.
      let snapshotLiberado = false
      try {
        const r = await executarComando(pool.request(), 'SELECT snapshot_isolation_state AS Estado FROM sys.databases WHERE database_id = DB_ID()', prazo, 'isolamento')
        snapshotLiberado = Number(r[0]?.Estado) === 1
      } catch (e) {
        if (e instanceof ErroBitfin && e.codigo !== 'DB_LEGACY_QUERY_ERROR') throw e
        snapshotLiberado = false
      }
      const tx = new sql.Transaction(pool)
      let linhasTotal = 0
      try {
        try {
          await tx.begin(snapshotLiberado ? sql.ISOLATION_LEVEL.SNAPSHOT : sql.ISOLATION_LEVEL.READ_COMMITTED)
        } catch (e) {
          throw classificarErroMssql(e, 'transacao')
        }
        tempoMs.isolamentoSnapshot = snapshotLiberado ? 1 : 0
        for (const [nome, consulta] of Object.entries(CONSULTAS_FOTO) as [NomeConsultaFoto, string][]) {
          const inicio = performance.now()
          resultado[nome] = await executarComando(new sql.Request(tx), consulta, prazo, nome)
          linhasTotal += resultado[nome].length
          tempoMs[nome] = Math.round(performance.now() - inicio)
        }
        const docs = [...new Set((opcoes.documentosMapa ?? []).map((d) => d.replace(/\D/g, '')).filter(Boolean))]
        let mapa: DadosMapaBitfin | undefined
        if (docs.length > 0) {
          const brutos: Record<string, Linha[]> = {}
          const valores = parametrosDocumentos(docs)
          for (const [nome, consulta] of Object.entries(consultasMapa(docs.length))) {
            const inicio = performance.now()
            const req = new sql.Request(tx)
            valores.forEach((v, i) => req.input(`d${i}`, sql.VarChar(15), v))
            brutos[nome] = await executarComando(req, consulta, prazo, `mapa.${nome}`)
            linhasTotal += brutos[nome].length
            tempoMs[`mapa.${nome}`] = Math.round(performance.now() - inicio)
          }
          mapa = mapearMapa(brutos, lidoEm)
        }
        const dados = mapearDados(resultado, lidoEm)
        const apuradoEm = dados.clientes.map((c) => c.dataApuracaoLiquidez).filter((v): v is string => Boolean(v)).sort().at(-1) ?? null
        return { valor: { dados, mapa, tempoMs }, linhas: linhasTotal, dadosDe: apuradoEm }
      } finally {
        await tx.rollback().catch(() => {})
      }
    })
  }
}
