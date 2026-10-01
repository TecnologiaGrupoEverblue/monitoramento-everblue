import type { Alerta, StatusAlerta } from '@monitoramento/dominio'
import { inserirEmLote, linhasParaEntidades, type Executor } from '../infra/banco'
import { novoId } from './cadastrosRepositorio'

export class AlertaRepositorio {
  constructor(private readonly db: Executor) {}

  async listarTodos(): Promise<Alerta[]> {
    return linhasParaEntidades((await this.db.query('SELECT * FROM alerta ORDER BY data DESC, id COLLATE "C"')).rows)
  }
  async abertos(executor: Executor = this.db): Promise<Alerta[]> {
    return linhasParaEntidades((await executor.query(`SELECT * FROM alerta WHERE status <> 'RESOLVIDO' ORDER BY data DESC, id COLLATE "C"`)).rows)
  }
  async porCliente(clienteId: string): Promise<Alerta[]> {
    return linhasParaEntidades((await this.db.query('SELECT * FROM alerta WHERE cliente_id = $1 ORDER BY data DESC, id COLLATE "C"', [clienteId])).rows)
  }
  async criarMuitos(alertas: Omit<Alerta, 'id'>[], executor: Executor = this.db): Promise<void> {
    await inserirEmLote(executor, 'alerta', alertas.map((a) => ({ id: novoId('alt'), ...a })))
  }
  async atualizarStatus(id: string, status: StatusAlerta): Promise<boolean> {
    const { rowCount } = await this.db.query('UPDATE alerta SET status = $2 WHERE id = $1', [id, status])
    return (rowCount ?? 0) > 0
  }
}
