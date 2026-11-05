/**
 * Gateway único da dependência legada (Bitfin) — Padrão Corporativo Everblue
 * de Conexões e Proteção de Bancos de Dados (ADR-020).
 *
 * Toda consulta ao Bitfin passa por aqui, nesta ordem:
 *   1. operação do catálogo fechado (`OPERACOES_LEGADO`) — fora dele, recusa;
 *   2. chave canônica (operação + parâmetros normalizados, sem PII no log);
 *   3. consulta idêntica já em voo → associa ao mesmo resultado (single-flight);
 *   4. disjuntor aberto → recusa sem tocar no banco;
 *   5. admissão na fila LIMITADA (cheia = recusa imediata; espera com teto);
 *   6. com a vaga, revalida prazo e disjuntor;
 *   7. executa sob o prazo da classe (o cancelamento real é do executor);
 *   8. libera a vaga e a entrada em voo em `finally`;
 *   9. métricas em memória e trilha de auditoria sem dado sensível.
 *
 * Zero retentativa: nada aqui repete consulta. O limite de concorrência vale
 * para ESTE processo (a API roda em um processo; o `cli testar-bitfin` é um
 * segundo consumidor eventual — orçamento em docs/CONEXOES-BANCO.md).
 */
import { randomUUID } from 'node:crypto'

export type CodigoErroLegado =
  | 'DB_LEGACY_NOT_CONFIGURED'
  | 'DB_LEGACY_CIRCUIT_OPEN'
  | 'DB_LEGACY_QUEUE_FULL'
  | 'DB_LEGACY_QUEUE_TIMEOUT'
  | 'DB_LEGACY_CONNECT_ERROR'
  | 'DB_LEGACY_CREDENTIAL'
  | 'DB_LEGACY_QUERY_TIMEOUT'
  | 'DB_LEGACY_QUERY_ERROR'
  | 'DB_FORBIDDEN_OPERATION'

/** Mensagem ao usuário por código — nunca texto do driver, SQL ou conexão. */
export const MENSAGENS_LEGADO: Record<CodigoErroLegado, string> = {
  DB_LEGACY_NOT_CONFIGURED: 'A conexão com o Bitfin não está configurada no servidor.',
  DB_LEGACY_CIRCUIT_OPEN: 'O Bitfin está indisponível no momento (proteção ativada após falhas seguidas). Nova tentativa automática em alguns minutos.',
  DB_LEGACY_QUEUE_FULL: 'O Bitfin já está atendendo outras consultas do Monitoramento. Tente de novo em instantes.',
  DB_LEGACY_QUEUE_TIMEOUT: 'A consulta ao Bitfin esperou demais na fila e foi descartada sem executar. Tente de novo em instantes.',
  DB_LEGACY_CONNECT_ERROR: 'Não foi possível conectar ao Bitfin (rede ou servidor indisponível).',
  DB_LEGACY_CREDENTIAL: 'O Bitfin recusou o usuário ou a senha configurados no servidor.',
  DB_LEGACY_QUERY_TIMEOUT: 'A consulta ao Bitfin passou do tempo máximo e foi cancelada.',
  DB_LEGACY_QUERY_ERROR: 'O Bitfin recusou uma consulta do Monitoramento.',
  DB_FORBIDDEN_OPERATION: 'Operação não autorizada no Bitfin.',
}

/** Erro da integração. `message` é seguro para o usuário; `detalhe` é só para log. */
export class ErroBitfin extends Error {
  constructor(
    readonly codigo: CodigoErroLegado,
    readonly detalhe: string | null = null,
    readonly etapa: string | null = null,
  ) {
    super(MENSAGENS_LEGADO[codigo])
    this.name = 'ErroBitfin'
  }
  /** Conta para o disjuntor? Só falha da dependência (rede, tempo, credencial). */
  get falhaDeDependencia(): boolean {
    return this.codigo === 'DB_LEGACY_CONNECT_ERROR' || this.codigo === 'DB_LEGACY_QUERY_TIMEOUT' || this.codigo === 'DB_LEGACY_CREDENTIAL'
  }
}

/** Catálogo fechado de operações no legado: classe, prazos e auditoria. */
export const OPERACOES_LEGADO = {
  'foto.leitura': { classe: 'foto' },
  'mapa.nomes': { classe: 'nomes' },
  'diagnostico.conexao': { classe: 'diagnostico' },
} as const
export type OperacaoLegado = keyof typeof OPERACOES_LEGADO
export type ClasseLegado = (typeof OPERACOES_LEGADO)[OperacaoLegado]['classe']

export interface LimitesClasse {
  /** Teto de cada comando SQL. */
  consultaMs: number
  /** Prazo total da operação (fila + execução). */
  prazoMs: number
  /** Espera máxima na fila. */
  esperaFilaMs: number
}

export interface ConfigGateway {
  filaMax: number
  disjuntorFalhas: number
  disjuntorAbertoMs: number
  classes: Record<ClasseLegado, LimitesClasse>
}

export type EstadoDisjuntor = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

/** Disjuntor: OPEN recusa sem tocar no banco; HALF_OPEN deixa UMA sondagem. */
export class Disjuntor {
  private falhasSeguidas = 0
  private abertoAte = 0
  private sondando = false
  private _estado: EstadoDisjuntor = 'CLOSED'
  ultimaTransicao: { de: EstadoDisjuntor; para: EstadoDisjuntor; em: string; motivo: string } | null = null

  constructor(
    private readonly limiteFalhas: number,
    private readonly abertoMs: number,
    private readonly agora: () => number = Date.now,
    private readonly aoMudar: (t: { de: EstadoDisjuntor; para: EstadoDisjuntor; motivo: string }) => void = () => {},
  ) {}

  get estado(): EstadoDisjuntor {
    if (this._estado === 'OPEN' && this.agora() >= this.abertoAte) this.mudar('HALF_OPEN', 'tempo de espera cumprido')
    return this._estado
  }

  get reabreEm(): string | null {
    return this._estado === 'OPEN' ? new Date(this.abertoAte).toISOString() : null
  }

  /** Pode executar agora? Em HALF_OPEN, só uma sondagem por vez. */
  permitir(): boolean {
    const e = this.estado
    if (e === 'CLOSED') return true
    if (e === 'OPEN') return false
    if (this.sondando) return false
    this.sondando = true
    return true
  }

  sucesso(): void {
    this.falhasSeguidas = 0
    this.sondando = false
    if (this._estado !== 'CLOSED') this.mudar('CLOSED', 'sondagem bem-sucedida')
  }

  /** `imediata`: credencial inválida abre na hora (sem tempestade de tentativas). */
  falha(motivo: string, imediata = false): void {
    this.sondando = false
    this.falhasSeguidas += 1
    if (this._estado === 'HALF_OPEN' || imediata || this.falhasSeguidas >= this.limiteFalhas) {
      this.abertoAte = this.agora() + this.abertoMs
      if (this._estado !== 'OPEN') this.mudar('OPEN', motivo)
    }
  }

  /** A sondagem terminou sem dizer nada sobre a saúde (ex.: erro de SQL). */
  neutro(): void {
    this.sondando = false
  }

  private mudar(para: EstadoDisjuntor, motivo: string) {
    const de = this._estado
    this._estado = para
    this.ultimaTransicao = { de, para, em: new Date(this.agora()).toISOString(), motivo }
    this.aoMudar({ de, para, motivo })
  }
}

/** Uma execução física, para a trilha de auditoria (sem PII, sem resultado). */
export interface EventoIntegracao {
  id: string
  correlationId: string
  integracao: 'bitfin'
  operacao: OperacaoLegado
  atorRef: string | null
  status: 'SUCESSO' | 'ERRO' | 'RECUSADA'
  iniciadoEm: string
  concluidoEm: string
  duracaoMs: number
  esperaFilaMs: number
  tentativas: number
  requisicoesLogicas: number
  categoriaErro: CodigoErroLegado | null
  estadoDisjuntor: EstadoDisjuntor
  linhas: number | null
  dadosDe: string | null
}

export interface ContextoOperacao {
  /** Pseudônimo do ator (id interno do usuário ou 'agendador'). */
  atorRef?: string | null
  correlationId?: string
}

export interface ResultadoExecucao<T> {
  valor: T
  linhas: number | null
  dadosDe?: string | null
}

/** O que o executor recebe: prazo absoluto (relógio monotônico) e teto por comando. */
export interface Prazo {
  /** `performance.now()` limite; não comece comando depois dele. */
  ate: number
  consultaMs: number
  restanteMs(): number
}

interface Esperando {
  liberar: () => void
  recusar: (e: ErroBitfin) => void
  relogio: NodeJS.Timeout
}

export class GatewayLegado {
  readonly disjuntor: Disjuntor
  private emExecucao = 0
  private encerrando = false
  private readonly fila: Esperando[] = []
  private readonly emVoo = new Map<string, { promessa: Promise<unknown>; requisicoes: number }>()
  private readonly duracoes: number[] = []
  readonly contadores = { execucoes: 0, sucessos: 0, erros: 0, recusas: 0, compartilhadas: 0 } as Record<string, number>
  ultimaExecucao: { operacao: OperacaoLegado; status: string; em: string; duracaoMs: number; categoriaErro: CodigoErroLegado | null } | null = null

  constructor(
    private readonly cfg: ConfigGateway,
    private readonly registrar: (e: EventoIntegracao) => Promise<void> = async () => {},
    private readonly log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void } = { info: () => {}, error: () => {} },
    agora: () => number = Date.now,
  ) {
    this.disjuntor = new Disjuntor(cfg.disjuntorFalhas, cfg.disjuntorAbertoMs, agora, (t) =>
      this.log[t.para === 'OPEN' ? 'error' : 'info']({ integracao: 'bitfin', ...t }, 'bitfin_disjuntor_mudou'),
    )
  }

  /** Estado resumido para /api/health/dependencies e métricas. */
  estado() {
    const ordenadas = [...this.duracoes].sort((a, b) => a - b)
    const pct = (p: number) => (ordenadas.length ? ordenadas[Math.min(ordenadas.length - 1, Math.floor((p / 100) * ordenadas.length))] : null)
    return {
      disjuntor: this.disjuntor.estado,
      reabreEm: this.disjuntor.reabreEm,
      ultimaTransicao: this.disjuntor.ultimaTransicao,
      emExecucao: this.emExecucao,
      naFila: this.fila.length,
      filaMax: this.cfg.filaMax,
      contadores: { ...this.contadores },
      duracaoMs: { p50: pct(50), p95: pct(95), p99: pct(99), amostras: ordenadas.length },
      ultimaExecucao: this.ultimaExecucao,
    }
  }

  /**
   * Executa `trabalho` sob as regras do gateway. `chave` (opcional) liga o
   * single-flight: só passe chave para consultas semanticamente idênticas e
   * sem diferença de autorização (o mesmo resultado serve a qualquer pedido).
   */
  async executar<T>(
    operacao: OperacaoLegado,
    contexto: ContextoOperacao,
    trabalho: (prazo: Prazo) => Promise<ResultadoExecucao<T>>,
    chave?: string,
  ): Promise<T> {
    if (!Object.prototype.hasOwnProperty.call(OPERACOES_LEGADO, operacao)) throw new ErroBitfin('DB_FORBIDDEN_OPERATION')
    if (chave) {
      const k = `${operacao}:${chave}`
      const existente = this.emVoo.get(k)
      if (existente) {
        existente.requisicoes += 1
        this.contadores.compartilhadas += 1
        return existente.promessa as Promise<T>
      }
      const entrada = { promessa: null as unknown as Promise<T>, requisicoes: 1 }
      entrada.promessa = this.executarFisico(operacao, contexto, trabalho, () => entrada.requisicoes).finally(() => this.emVoo.delete(k))
      this.emVoo.set(k, entrada)
      return entrada.promessa
    }
    return this.executarFisico(operacao, contexto, trabalho, () => 1)
  }

  private async executarFisico<T>(
    operacao: OperacaoLegado,
    contexto: ContextoOperacao,
    trabalho: (prazo: Prazo) => Promise<ResultadoExecucao<T>>,
    requisicoes: () => number,
  ): Promise<T> {
    const limites = this.cfg.classes[OPERACOES_LEGADO[operacao].classe]
    const inicioRelogio = performance.now()
    const ate = inicioRelogio + limites.prazoMs
    const iniciadoEm = new Date().toISOString()
    const id = randomUUID()
    const correlationId = contexto.correlationId ?? id
    let esperaFilaMs = 0
    let vaga = false
    let executou = false
    const finalizar = async (status: EventoIntegracao['status'], categoria: CodigoErroLegado | null, linhas: number | null, dadosDe: string | null) => {
      const duracaoMs = Math.round(performance.now() - inicioRelogio)
      this.ultimaExecucao = { operacao, status, em: new Date().toISOString(), duracaoMs, categoriaErro: categoria }
      this.contadores[status === 'SUCESSO' ? 'sucessos' : status === 'ERRO' ? 'erros' : 'recusas'] += 1
      if (executou) {
        this.duracoes.push(duracaoMs - esperaFilaMs)
        if (this.duracoes.length > 200) this.duracoes.shift()
      }
      const evento: EventoIntegracao = {
        id,
        correlationId,
        integracao: 'bitfin',
        operacao,
        atorRef: contexto.atorRef ?? null,
        status,
        iniciadoEm,
        concluidoEm: new Date().toISOString(),
        duracaoMs,
        esperaFilaMs,
        tentativas: executou ? 1 : 0,
        requisicoesLogicas: requisicoes(),
        categoriaErro: categoria,
        estadoDisjuntor: this.disjuntor.estado,
        linhas,
        dadosDe,
      }
      this.log[status === 'SUCESSO' ? 'info' : 'error'](
        { database_alias: 'legacy_bitfin', operation_id: operacao, correlation_id: correlationId, duration_ms: duracaoMs, queue_wait_ms: esperaFilaMs, status, error_category: categoria, retry_count: 0, circuit_state: evento.estadoDisjuntor, result_count: linhas },
        'bitfin_operacao',
      )
      // Auditoria de leitura não derruba a operação: a falha ao gravar vai
      // para o log (sem loop) e o resultado segue (decisão registrada na ADR-020).
      await this.registrar(evento).catch((e) => this.log.error({ err: e, operation_id: operacao, correlation_id: correlationId }, 'bitfin_auditoria_falhou'))
    }

    try {
      if (!this.disjuntor.permitir()) throw new ErroBitfin('DB_LEGACY_CIRCUIT_OPEN')
      try {
        await this.admitir(limites.esperaFilaMs)
      } catch (e) {
        // Não chegou a usar a sondagem do disjuntor.
        this.disjuntor.neutro()
        throw e
      }
      vaga = true
      esperaFilaMs = Math.round(performance.now() - inicioRelogio)
      if (performance.now() >= ate) {
        this.disjuntor.neutro()
        throw new ErroBitfin('DB_LEGACY_QUEUE_TIMEOUT')
      }
      this.contadores.execucoes += 1
      executou = true
      const r = await trabalho({ ate, consultaMs: limites.consultaMs, restanteMs: () => Math.max(0, ate - performance.now()) })
      this.disjuntor.sucesso()
      await finalizar('SUCESSO', null, r.linhas, r.dadosDe ?? null)
      return r.valor
    } catch (e) {
      const erro = e instanceof ErroBitfin ? e : new ErroBitfin('DB_LEGACY_QUERY_ERROR', (e as Error)?.message ?? String(e))
      if (executou) {
        if (erro.falhaDeDependencia) this.disjuntor.falha(erro.codigo, erro.codigo === 'DB_LEGACY_CREDENTIAL')
        else this.disjuntor.neutro()
      }
      const recusada = !executou
      await finalizar(recusada ? 'RECUSADA' : 'ERRO', erro.codigo, null, null)
      if (erro.detalhe) this.log.error({ operation_id: operacao, correlation_id: correlationId, error_category: erro.codigo, etapa: erro.etapa, detalhe: erro.detalhe }, 'bitfin_erro_detalhe')
      throw erro
    } finally {
      if (vaga) this.liberar()
    }
  }

  /** Shutdown: para de admitir e espera a execução em curso terminar (com teto). */
  async drenar(maxMs: number): Promise<void> {
    this.encerrando = true
    for (const item of this.fila.splice(0)) item.recusar(new ErroBitfin('DB_LEGACY_QUEUE_FULL'))
    const fim = performance.now() + maxMs
    while (this.emExecucao > 0 && performance.now() < fim) await new Promise((r) => setTimeout(r, 100))
  }

  private admitir(esperaMaxMs: number): Promise<void> {
    if (this.encerrando) return Promise.reject(new ErroBitfin('DB_LEGACY_QUEUE_FULL'))
    if (this.emExecucao < 1 && this.fila.length === 0) {
      this.emExecucao += 1
      return Promise.resolve()
    }
    if (this.fila.length >= this.cfg.filaMax) return Promise.reject(new ErroBitfin('DB_LEGACY_QUEUE_FULL'))
    return new Promise<void>((resolve, reject) => {
      const item: Esperando = {
        liberar: () => {
          clearTimeout(item.relogio)
          resolve()
        },
        recusar: (e) => {
          clearTimeout(item.relogio)
          reject(e)
        },
        relogio: setTimeout(() => {
          const i = this.fila.indexOf(item)
          if (i >= 0) this.fila.splice(i, 1)
          reject(new ErroBitfin('DB_LEGACY_QUEUE_TIMEOUT'))
        }, esperaMaxMs),
      }
      this.fila.push(item)
    })
  }

  private liberar(): void {
    const proximo = this.fila.shift()
    if (proximo) {
      // A vaga passa direto ao próximo: emExecucao continua 1.
      proximo.liberar()
      return
    }
    this.emExecucao = Math.max(0, this.emExecucao - 1)
  }
}
