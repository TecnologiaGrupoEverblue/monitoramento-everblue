import type { Ata, Comite } from '@monitoramento/dominio'
import { linhaParaEntidade, linhasParaEntidades, type Executor } from '../infra/banco'

export class ComiteRepositorio {
  constructor(private readonly db: Executor) {}

  async listar(): Promise<Comite[]> {
    return linhasParaEntidades((await this.db.query('SELECT * FROM comite ORDER BY data DESC, id COLLATE "C"')).rows)
  }
  async porId(id: string, executor: Executor = this.db, travar = false): Promise<Comite | null> {
    const { rows } = await executor.query(`SELECT * FROM comite WHERE id = $1${travar ? ' FOR UPDATE' : ''}`, [id])
    return rows[0] ? linhaParaEntidade<Comite>(rows[0]) : null
  }
  async proximoPlanejado(): Promise<Comite | null> {
    const { rows } = await this.db.query(`SELECT * FROM comite WHERE status = 'PLANEJADO' ORDER BY data LIMIT 1`)
    return rows[0] ? linhaParaEntidade<Comite>(rows[0]) : null
  }
  async marcarRealizado(id: string, executor: Executor): Promise<void> {
    await executor.query(`UPDATE comite SET status = 'REALIZADO' WHERE id = $1`, [id])
  }
  async criar(comite: Comite, executor: Executor = this.db): Promise<void> {
    await executor.query('INSERT INTO comite (id, data, participantes, status) VALUES ($1, $2, $3, $4)', [comite.id, comite.data, comite.participantes, comite.status])
  }
  async criarSeNenhumPlanejado(comite: Comite): Promise<void> {
    await this.db.query(
      `INSERT INTO comite (id, data, participantes, status) VALUES ($1, $2, $3, 'PLANEJADO')
       ON CONFLICT (status) WHERE status = 'PLANEJADO' DO NOTHING`,
      [comite.id, comite.data, comite.participantes],
    )
  }
  async ultimaAta(): Promise<Ata | null> {
    const { rows } = await this.db.query('SELECT * FROM ata ORDER BY data_comite DESC, id COLLATE "C" LIMIT 1')
    return rows[0] ? linhaParaEntidade<Ata>(rows[0]) : null
  }
  async ataDoComite(comiteId: string): Promise<Ata | null> {
    const { rows } = await this.db.query('SELECT * FROM ata WHERE comite_id = $1', [comiteId])
    return rows[0] ? linhaParaEntidade<Ata>(rows[0]) : null
  }
  async inserirAta(ata: Ata, executor: Executor): Promise<void> {
    await executor.query(
      `INSERT INTO ata (id, comite_id, data_geracao, data_comite, participantes, resumo_executivo, clientes_discutidos, pendencias)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb)`,
      [ata.id, ata.comiteId, ata.dataGeracao, ata.dataComite, ata.participantes, JSON.stringify(ata.resumoExecutivo), JSON.stringify(ata.clientesDiscutidos), JSON.stringify(ata.pendencias)],
    )
  }
}
