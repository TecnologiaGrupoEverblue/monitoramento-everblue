/** Histórico de eventos — append-only. Nada aqui é editado ou apagado. */
import type { EventoHistorico } from '@monitoramento/dominio'
import { linhasParaEntidades, type Executor } from '../infra/banco'
import { novoId } from './cadastrosRepositorio'

export class EventoRepositorio {
  constructor(private readonly db: Executor) {}

  async porCliente(clienteId: string): Promise<EventoHistorico[]> {
    return linhasParaEntidades((await this.db.query('SELECT * FROM evento_historico WHERE cliente_id = $1 ORDER BY data DESC, id COLLATE "C"', [clienteId])).rows)
  }
  async recentes(limite = 50): Promise<EventoHistorico[]> {
    const teto = Math.min(Math.max(limite, 1), 500)
    return linhasParaEntidades((await this.db.query('SELECT * FROM evento_historico ORDER BY data DESC, id COLLATE "C" LIMIT $1', [teto])).rows)
  }
  async mudancasDeStatus(clienteIds: string[]): Promise<EventoHistorico[]> {
    return linhasParaEntidades(
      (await this.db.query(`SELECT * FROM evento_historico WHERE tipo = 'MUDANCA_STATUS' AND cliente_id = ANY($1)`, [clienteIds])).rows,
    )
  }
  async registrar(evento: Omit<EventoHistorico, 'id'>, executor: Executor = this.db): Promise<EventoHistorico> {
    const registro: EventoHistorico = { ...evento, id: novoId('evt') }
    await executor.query(
      `INSERT INTO evento_historico (id, cliente_id, data, usuario, tipo, valor_anterior, valor_novo, justificativa, decisao_comite_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [registro.id, registro.clienteId, registro.data, registro.usuario, registro.tipo, registro.valorAnterior, registro.valorNovo, registro.justificativa, registro.decisaoComiteId],
    )
    return registro
  }
}
