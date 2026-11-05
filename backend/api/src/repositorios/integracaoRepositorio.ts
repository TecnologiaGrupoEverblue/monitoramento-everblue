/** Trilha das execuções no Bitfin (append-only, sem PII) — migração 0011. */
import type { EventoIntegracao } from '../infra/gatewayLegado'
import type { Executor } from '../infra/banco'

export class IntegracaoRepositorio {
  constructor(
    private readonly db: Executor,
    private readonly ambiente: string,
  ) {}

  async registrar(e: EventoIntegracao): Promise<void> {
    await this.db.query(
      `INSERT INTO integracao_execucao (id, correlation_id, ambiente, integracao, operacao, ator_ref, status, iniciado_em, concluido_em,
                                        duracao_ms, espera_fila_ms, tentativas, requisicoes_logicas, categoria_erro, estado_disjuntor, linhas, dados_de)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        e.id,
        e.correlationId,
        this.ambiente,
        e.integracao,
        e.operacao,
        e.atorRef,
        e.status,
        e.iniciadoEm,
        e.concluidoEm,
        e.duracaoMs,
        e.esperaFilaMs,
        e.tentativas,
        e.requisicoesLogicas,
        e.categoriaErro,
        e.estadoDisjuntor,
        e.linhas,
        e.dadosDe,
      ],
    )
  }

  /** Últimas execuções (operação, situação e tempos) para diagnóstico. */
  async ultimas(limite = 20): Promise<Array<Omit<EventoIntegracao, 'integracao'> & { ambiente: string }>> {
    const { rows } = await this.db.query(
      `SELECT id, correlation_id, ambiente, operacao, ator_ref, status, iniciado_em, concluido_em, duracao_ms, espera_fila_ms, tentativas,
              requisicoes_logicas, categoria_erro, estado_disjuntor, linhas, dados_de
         FROM integracao_execucao ORDER BY iniciado_em DESC LIMIT $1`,
      [Math.min(Math.max(1, limite), 100)],
    )
    const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v === null ? null : String(v))
    return rows.map((l) => ({
      id: l.id,
      correlationId: l.correlation_id,
      ambiente: l.ambiente,
      operacao: l.operacao,
      atorRef: l.ator_ref,
      status: l.status,
      iniciadoEm: iso(l.iniciado_em)!,
      concluidoEm: iso(l.concluido_em)!,
      duracaoMs: l.duracao_ms,
      esperaFilaMs: l.espera_fila_ms,
      tentativas: l.tentativas,
      requisicoesLogicas: l.requisicoes_logicas,
      categoriaErro: l.categoria_erro,
      estadoDisjuntor: l.estado_disjuntor,
      linhas: l.linhas,
      dadosDe: iso(l.dados_de),
    }))
  }
}
