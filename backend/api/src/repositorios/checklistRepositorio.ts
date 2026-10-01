import type { ChaveItemChecklist, Gravidade, ItemChecklistAnalise } from '@monitoramento/dominio'
import { linhasParaEntidades, type Executor } from '../infra/banco'
import { novoId } from './cadastrosRepositorio'

export class ChecklistRepositorio {
  constructor(private readonly db: Executor) {}

  async salvos(clienteId: string, semanaRef: string): Promise<ItemChecklistAnalise[]> {
    return linhasParaEntidades((await this.db.query('SELECT * FROM checklist_analise WHERE cliente_id = $1 AND semana_ref = $2', [clienteId, semanaRef])).rows)
  }

  /** Grava (upsert) o parecer/gravidade de um item. Concorrência resolvida
   * pelo índice único (cliente, semana, item). */
  async salvar(
    clienteId: string,
    semanaRef: string,
    item: ChaveItemChecklist,
    alteracoes: { parecer?: string; gravidade?: Gravidade; gravidadeManual?: boolean },
    atualizadoPor: string,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO checklist_analise (id, cliente_id, semana_ref, item, gravidade, gravidade_manual, parecer, atualizado_em, atualizado_por)
       VALUES ($1, $2, $3, $4, COALESCE($5, 'VERDE'), COALESCE($6, FALSE), COALESCE($7, ''), now(), $8)
       ON CONFLICT (cliente_id, semana_ref, item) DO UPDATE
          SET gravidade = COALESCE($5, checklist_analise.gravidade),
              gravidade_manual = COALESCE($6, checklist_analise.gravidade_manual),
              parecer = COALESCE($7, checklist_analise.parecer),
              atualizado_em = now(),
              atualizado_por = $8`,
      [novoId('chk'), clienteId, semanaRef, item, alteracoes.gravidade ?? null, alteracoes.gravidadeManual ?? null, alteracoes.parecer ?? null, atualizadoPor],
    )
  }
}
