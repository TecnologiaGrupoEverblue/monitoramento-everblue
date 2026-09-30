/** Auditoria — append-only (gatilho no banco recusa UPDATE/DELETE). */
import type { Executor } from '../infra/banco'

export type ResultadoAuditoria = 'sucesso' | 'negado' | 'falha' | 'excecao'

export interface EventoAuditoria {
  acao: string
  resultado?: ResultadoAuditoria
  atorId?: string | null
  atorEmail?: string | null
  recursoTipo?: string | null
  recursoId?: string | null
  origemIp?: string | null
  correlationId?: string | null
  motivo?: string | null
  /** Nunca incluir token, senha, cookie ou documento integral. */
  detalhes?: Record<string, unknown>
}

export class AuditoriaRepositorio {
  constructor(private readonly db: Executor) {}

  async registrar(evento: EventoAuditoria, executor: Executor = this.db): Promise<void> {
    await executor.query(
      `INSERT INTO auditoria (acao, resultado, ator_id, ator_email, recurso_tipo, recurso_id, origem_ip, correlation_id, motivo, detalhes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
      [
        evento.acao,
        evento.resultado ?? 'sucesso',
        evento.atorId ?? null,
        evento.atorEmail ?? null,
        evento.recursoTipo ?? null,
        evento.recursoId ?? null,
        evento.origemIp ?? null,
        evento.correlationId ?? null,
        evento.motivo ? evento.motivo.slice(0, 500) : null,
        JSON.stringify(evento.detalhes ?? {}),
      ],
    )
  }
}
