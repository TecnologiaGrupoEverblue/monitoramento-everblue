import type { PlanoAcao } from '@monitoramento/dominio'
import { linhaParaEntidade, linhasParaEntidades, montarUpdateParcial, type Executor } from '../infra/banco'
import { novoId } from './cadastrosRepositorio'

export const CAMPOS_EDITAVEIS_PLANO = ['oQueFoiFeito', 'oQueNaoFoiFeito', 'status', 'dataLimite', 'responsavel', 'plano', 'prazoRegularizacao'] as const

export class PlanoAcaoRepositorio {
  constructor(private readonly db: Executor) {}

  async listarTodos(executor: Executor = this.db): Promise<PlanoAcao[]> {
    return linhasParaEntidades((await executor.query('SELECT * FROM plano_acao ORDER BY id COLLATE "C"')).rows)
  }
  async porCliente(clienteId: string): Promise<PlanoAcao[]> {
    return linhasParaEntidades((await this.db.query('SELECT * FROM plano_acao WHERE cliente_id = $1 ORDER BY id COLLATE "C"', [clienteId])).rows)
  }
  async doComite(comiteId: string, executor: Executor = this.db): Promise<PlanoAcao[]> {
    return linhasParaEntidades((await executor.query('SELECT * FROM plano_acao WHERE comite_origem_id = $1 ORDER BY id COLLATE "C"', [comiteId])).rows)
  }
  async contarDoComite(comiteId: string): Promise<number> {
    const { rows } = await this.db.query('SELECT count(*)::int AS n FROM plano_acao WHERE comite_origem_id = $1', [comiteId])
    return rows[0].n
  }
  async contarAtrasados(executor: Executor = this.db): Promise<number> {
    const { rows } = await executor.query(`SELECT count(*)::int AS n FROM plano_acao WHERE status = 'ATRASADO'`)
    return rows[0].n
  }
  async criar(plano: Omit<PlanoAcao, 'id'>, executor: Executor = this.db): Promise<PlanoAcao> {
    const id = novoId('pla')
    const { rows } = await executor.query(
      `INSERT INTO plano_acao (id, cliente_id, comite_origem_id, decisao_anterior, data_decisao_anterior, decisao_atual, data_decisao_atual,
                               prazo_regularizacao, plano, responsavel, o_que_foi_feito, o_que_nao_foi_feito, status, data_limite, evidencias)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
      [
        id, plano.clienteId, plano.comiteOrigemId, plano.decisaoAnterior, plano.dataDecisaoAnterior, plano.decisaoAtual, plano.dataDecisaoAtual,
        plano.prazoRegularizacao, plano.plano, plano.responsavel, plano.oQueFoiFeito, plano.oQueNaoFoiFeito, plano.status, plano.dataLimite, plano.evidencias,
      ],
    )
    return linhaParaEntidade<PlanoAcao>(rows[0])
  }
  async atualizar(id: string, alteracoes: Partial<PlanoAcao>): Promise<boolean> {
    const sql = montarUpdateParcial('plano_acao', id, alteracoes as Record<string, unknown>, CAMPOS_EDITAVEIS_PLANO)
    if (!sql) return false
    const { rowCount } = await this.db.query(sql.texto, sql.valores)
    return (rowCount ?? 0) > 0
  }
}
