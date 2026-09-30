/** Snapshots semanais — append-only: este repositório nunca expõe update/delete
 * (e o banco recusa, por gatilho, se alguém tentar). */
import type { SnapshotSemanal } from '@monitoramento/dominio'
import { inserirEmLote, type Executor } from '../infra/banco'

function mapear(r: Record<string, unknown>): SnapshotSemanal {
  const s: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(r)) {
    if (k === 'importacao_id') continue
    s[k.replace(/_([a-z0-9])/g, (_, l: string) => l.toUpperCase())] = v
  }
  return s as unknown as SnapshotSemanal
}

export class SnapshotRepositorio {
  constructor(private readonly db: Executor) {}

  async semanasDisponiveis(executor: Executor = this.db): Promise<string[]> {
    const { rows } = await executor.query(`SELECT DISTINCT semana_ref FROM snapshot_semanal ORDER BY semana_ref`)
    return rows.map((r) => r.semana_ref as string)
  }

  async porSemanas(semanas: string[], clienteIds?: string[]): Promise<SnapshotSemanal[]> {
    if (semanas.length === 0) return []
    const parametros: unknown[] = [semanas]
    let filtro = ''
    if (clienteIds) {
      parametros.push(clienteIds)
      filtro = ' AND cliente_id = ANY($2)'
    }
    const { rows } = await this.db.query(`SELECT * FROM snapshot_semanal WHERE semana_ref = ANY($1::date[])${filtro}`, parametros)
    return rows.map(mapear)
  }

  async porCliente(clienteId: string, executor: Executor = this.db): Promise<SnapshotSemanal[]> {
    const { rows } = await executor.query(`SELECT * FROM snapshot_semanal WHERE cliente_id = $1 ORDER BY semana_ref`, [clienteId])
    return rows.map(mapear)
  }

  async porClienteESemana(clienteId: string, semanaRef: string, executor: Executor = this.db): Promise<SnapshotSemanal | null> {
    const { rows } = await executor.query(`SELECT * FROM snapshot_semanal WHERE cliente_id = $1 AND semana_ref = $2`, [clienteId, semanaRef])
    return rows[0] ? mapear(rows[0]) : null
  }

  /** Último snapshot de cada cliente informado — uma consulta só. */
  async ultimosPorCliente(clienteIds: string[], executor: Executor = this.db): Promise<Map<string, SnapshotSemanal>> {
    if (clienteIds.length === 0) return new Map()
    const { rows } = await executor.query(
      `SELECT DISTINCT ON (cliente_id) * FROM snapshot_semanal WHERE cliente_id = ANY($1) ORDER BY cliente_id, semana_ref DESC`,
      [clienteIds],
    )
    return new Map(rows.map((r) => [String(r.cliente_id), mapear(r)]))
  }

  async clientesComSnapshotNaSemana(clienteIds: string[], semanaRef: string, executor: Executor = this.db): Promise<Set<string>> {
    if (clienteIds.length === 0) return new Set()
    const { rows } = await executor.query(`SELECT cliente_id FROM snapshot_semanal WHERE semana_ref = $1 AND cliente_id = ANY($2)`, [semanaRef, clienteIds])
    return new Set(rows.map((r) => String(r.cliente_id)))
  }

  /** Série agregada (risco/vencido) por semana, sobre um conjunto de clientes. */
  async serieAgregada(clienteIds: string[]): Promise<{ semana: string; risco: number; vencido: number }[]> {
    const { rows } = await this.db.query(
      `SELECT s.semana_ref AS semana,
              COALESCE(SUM(s.risco_cliente) FILTER (WHERE s.cliente_id = ANY($1)), 0) AS risco,
              COALESCE(SUM(s.vencido_oficial) FILTER (WHERE s.cliente_id = ANY($1)), 0) AS vencido
         FROM snapshot_semanal s
        GROUP BY s.semana_ref ORDER BY s.semana_ref`,
      [clienteIds],
    )
    return rows.map((r) => ({ semana: r.semana, risco: Number(r.risco), vencido: Number(r.vencido) }))
  }

  async inserir(snapshots: (SnapshotSemanal & { importacaoId?: string | null })[], executor: Executor = this.db): Promise<void> {
    await inserirEmLote(executor, 'snapshot_semanal', snapshots as unknown as Record<string, unknown>[], [], 200)
  }
}
