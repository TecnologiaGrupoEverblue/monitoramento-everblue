/** Saída de Risco, IASR, Jurídico e movimento de conta — leituras da carteira. */
import type { EventoIASR, Juridico, MovimentoContaMensal, RegistroIASR, SaidaDeRisco } from '@monitoramento/dominio'
import { linhaParaEntidade, linhasParaEntidades, type Executor } from '../infra/banco'

export class CarteiraRepositorio {
  constructor(private readonly db: Executor) {}

  async saidasDeRisco(): Promise<SaidaDeRisco[]> {
    return linhasParaEntidades((await this.db.query('SELECT * FROM saida_de_risco ORDER BY id COLLATE "C"')).rows)
  }
  async saidaDeRiscoDoCliente(clienteId: string): Promise<SaidaDeRisco | null> {
    const { rows } = await this.db.query('SELECT * FROM saida_de_risco WHERE cliente_id = $1 ORDER BY id COLLATE "C" LIMIT 1', [clienteId])
    return rows[0] ? linhaParaEntidade<SaidaDeRisco>(rows[0]) : null
  }
  async registrosIasr(): Promise<RegistroIASR[]> {
    return linhasParaEntidades((await this.db.query('SELECT * FROM registro_iasr ORDER BY id COLLATE "C"')).rows)
  }
  async eventosIasr(): Promise<EventoIASR[]> {
    return linhasParaEntidades((await this.db.query('SELECT * FROM evento_iasr ORDER BY id COLLATE "C"')).rows)
  }
  async juridico(): Promise<Juridico[]> {
    return linhasParaEntidades((await this.db.query('SELECT * FROM juridico ORDER BY id COLLATE "C"')).rows)
  }
  async juridicoDoCliente(clienteId: string, executor: Executor = this.db): Promise<Juridico | null> {
    const { rows } = await executor.query('SELECT * FROM juridico WHERE cliente_id = $1 ORDER BY id COLLATE "C" LIMIT 1', [clienteId])
    return rows[0] ? linhaParaEntidade<Juridico>(rows[0]) : null
  }
  async movimentosDoCliente(clienteId: string): Promise<MovimentoContaMensal[]> {
    return linhasParaEntidades((await this.db.query('SELECT * FROM movimento_conta_mensal WHERE cliente_id = $1 ORDER BY mes_ref', [clienteId])).rows)
  }
}
