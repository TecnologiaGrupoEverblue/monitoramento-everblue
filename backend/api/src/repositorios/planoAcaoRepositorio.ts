import type { PlanoAcao } from '@monitoramento/dominio'
import { linhaParaEntidade, linhasParaEntidades, montarUpdateParcial, type Executor } from '../infra/banco'
import { novoId } from './cadastrosRepositorio'

export const CAMPOS_EDITAVEIS_PLANO = ['oQueFoiFeito', 'oQueNaoFoiFeito', 'status', 'dataLimite', 'responsavel', 'plano', 'prazoRegularizacao'] as const

export class PlanoAcaoRepositorio {
  constructor(private readonly db: Executor) {}

  /** Plano em dia com a data-limite já passada vira ATRASADO — sem depender
   * de alguém lembrar de mudar. Roda antes de toda leitura (barato: índice
   * parcial em data_limite dos não concluídos). A transição deixa evento no
   * histórico do cliente, na mesma instrução (atômico e sem corrida: dois
   * pedidos simultâneos não duplicam o evento, porque só um UPDATE muda a linha). */
  async marcarAtrasados(executor: Executor = this.db): Promise<number> {
    const { rows } = await executor.query(
      `WITH atrasados AS (
         UPDATE plano_acao SET status = 'ATRASADO', atualizado_em = now(), atualizado_por = 'Sistema (prazo vencido)'
          WHERE status = 'EM_DIA' AND data_limite < (now() AT TIME ZONE 'America/Sao_Paulo')::date
          RETURNING id, cliente_id, decisao_atual, data_limite, comite_origem_id
       ), eventos AS (
         INSERT INTO evento_historico (id, cliente_id, data, usuario, tipo, valor_anterior, valor_novo, justificativa, decisao_comite_id)
         SELECT 'evt_' || replace(gen_random_uuid()::text, '-', ''), cliente_id, now(), 'Sistema', 'PLANO_ACAO', 'EM_DIA', 'ATRASADO',
                left('Plano "' || decisao_atual || '" atrasado automaticamente: prazo ' || to_char(data_limite, 'DD/MM/YYYY') || ' vencido sem conclusão.', 2000),
                comite_origem_id
           FROM atrasados
         RETURNING 1
       )
       SELECT count(*)::int AS n FROM eventos`,
    )
    return rows[0]?.n ?? 0
  }

  async listarTodos(executor: Executor = this.db): Promise<PlanoAcao[]> {
    await this.marcarAtrasados(executor)
    return linhasParaEntidades((await executor.query('SELECT * FROM plano_acao ORDER BY id COLLATE "C"')).rows)
  }
  async porId(id: string, executor: Executor = this.db, travar = false): Promise<PlanoAcao | null> {
    const { rows } = await executor.query(`SELECT * FROM plano_acao WHERE id = $1${travar ? ' FOR UPDATE' : ''}`, [id])
    return rows[0] ? linhaParaEntidade<PlanoAcao>(rows[0]) : null
  }
  async porCliente(clienteId: string): Promise<PlanoAcao[]> {
    await this.marcarAtrasados()
    return linhasParaEntidades((await this.db.query('SELECT * FROM plano_acao WHERE cliente_id = $1 ORDER BY data_decisao_atual, id COLLATE "C"', [clienteId])).rows)
  }
  /** Andamento registrado pelo responsável/comitê. */
  async gravarAndamento(
    id: string,
    dados: Pick<PlanoAcao, 'oQueFoiFeito' | 'oQueNaoFoiFeito' | 'status' | 'dataLimite' | 'responsavel'> & { concluidoEm: string | null; atualizadoPor: string },
    executor: Executor = this.db,
  ): Promise<PlanoAcao | null> {
    const { rows } = await executor.query(
      `UPDATE plano_acao SET o_que_foi_feito = $2, o_que_nao_foi_feito = $3, status = $4, data_limite = $5, responsavel = $6,
                             concluido_em = $7, atualizado_em = now(), atualizado_por = $8
        WHERE id = $1 RETURNING *`,
      [id, dados.oQueFoiFeito, dados.oQueNaoFoiFeito, dados.status, dados.dataLimite, dados.responsavel, dados.concluidoEm, dados.atualizadoPor],
    )
    return rows[0] ? linhaParaEntidade<PlanoAcao>(rows[0]) : null
  }
  async doComite(comiteId: string, executor: Executor = this.db): Promise<PlanoAcao[]> {
    return linhasParaEntidades((await executor.query('SELECT * FROM plano_acao WHERE comite_origem_id = $1 ORDER BY id COLLATE "C"', [comiteId])).rows)
  }
  async contarDoComite(comiteId: string): Promise<number> {
    const { rows } = await this.db.query('SELECT count(*)::int AS n FROM plano_acao WHERE comite_origem_id = $1', [comiteId])
    return rows[0].n
  }
  async contarAtrasados(executor: Executor = this.db): Promise<number> {
    await this.marcarAtrasados(executor)
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
