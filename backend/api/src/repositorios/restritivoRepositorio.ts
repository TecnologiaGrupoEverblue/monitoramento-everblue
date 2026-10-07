/** Restritivos estruturados por cliente, semana e tipo. */
import type { LinhaRestritivo, RestritivoSemanal, TipoRestritivo } from '@monitoramento/dominio'
import { linhasParaEntidades, type Executor } from '../infra/banco'
import { novoId } from './cadastrosRepositorio'

export interface PosicaoRestritivos {
  semanaRef: string
  linhas: LinhaRestritivo[]
}

function agrupar(rows: RestritivoSemanal[]): Map<string, Map<string, LinhaRestritivo[]>> {
  const porCliente = new Map<string, Map<string, LinhaRestritivo[]>>()
  for (const r of rows) {
    const semanas = porCliente.get(r.clienteId) ?? new Map<string, LinhaRestritivo[]>()
    const linhas = semanas.get(r.semanaRef) ?? []
    linhas.push({ tipo: r.tipo, quantidade: r.quantidade, valor: r.valor })
    semanas.set(r.semanaRef, linhas)
    porCliente.set(r.clienteId, semanas)
  }
  return porCliente
}

export class RestritivoRepositorio {
  constructor(private readonly db: Executor) {}

  async porCliente(clienteId: string): Promise<RestritivoSemanal[]> {
    return linhasParaEntidades((await this.db.query('SELECT * FROM restritivo_semanal WHERE cliente_id = $1 ORDER BY semana_ref DESC, tipo', [clienteId])).rows)
  }

  /** Posição da semana e a última anterior a ela, por cliente — uma consulta. */
  async atualEAnterior(clienteIds: string[], semanaRef: string, executor: Executor = this.db): Promise<Map<string, { atual: PosicaoRestritivos | null; anterior: PosicaoRestritivos | null }>> {
    const resultado = new Map<string, { atual: PosicaoRestritivos | null; anterior: PosicaoRestritivos | null }>()
    if (clienteIds.length === 0) return resultado
    const rows = linhasParaEntidades<RestritivoSemanal>(
      (
        await executor.query(
          `SELECT r.* FROM restritivo_semanal r
            WHERE r.cliente_id = ANY($1)
              AND (r.semana_ref = $2
                   OR r.semana_ref = (SELECT max(x.semana_ref) FROM restritivo_semanal x WHERE x.cliente_id = r.cliente_id AND x.semana_ref < $2))`,
          [clienteIds, semanaRef],
        )
      ).rows,
    )
    for (const [clienteId, semanas] of agrupar(rows)) {
      let atual: PosicaoRestritivos | null = null
      let anterior: PosicaoRestritivos | null = null
      for (const [semana, linhas] of semanas) {
        if (semana === semanaRef) atual = { semanaRef: semana, linhas }
        else anterior = { semanaRef: semana, linhas }
      }
      resultado.set(clienteId, { atual, anterior })
    }
    return resultado
  }

  /** Substitui a posição do cliente na semana pelos tipos informados (os
   * omitidos são removidos). Devolve a posição anterior DESTA semana. */
  async gravarSemana(
    clienteId: string,
    semanaRef: string,
    linhas: (LinhaRestritivo & { observacao?: string | null })[],
    origem: 'IMPORTACAO' | 'MANUAL',
    registradoPor: string,
    executor: Executor = this.db,
  ): Promise<LinhaRestritivo[]> {
    const { rows } = await executor.query('SELECT tipo, quantidade, valor FROM restritivo_semanal WHERE cliente_id = $1 AND semana_ref = $2', [clienteId, semanaRef])
    const antes = rows.map((r) => ({ tipo: r.tipo as TipoRestritivo, quantidade: Number(r.quantidade), valor: Number(r.valor) }))
    const tipos = linhas.map((l) => l.tipo)
    await executor.query('DELETE FROM restritivo_semanal WHERE cliente_id = $1 AND semana_ref = $2 AND NOT (tipo = ANY($3))', [clienteId, semanaRef, tipos])
    for (const l of linhas) {
      await executor.query(
        `INSERT INTO restritivo_semanal (id, cliente_id, semana_ref, tipo, quantidade, valor, origem, observacao, registrado_por, registrado_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
         ON CONFLICT (cliente_id, semana_ref, tipo) DO UPDATE
            SET quantidade = EXCLUDED.quantidade, valor = EXCLUDED.valor, origem = EXCLUDED.origem,
                observacao = EXCLUDED.observacao, registrado_por = EXCLUDED.registrado_por, registrado_em = now()`,
        [novoId('rst'), clienteId, semanaRef, l.tipo, l.quantidade, l.valor, origem, l.observacao ?? null, registradoPor],
      )
    }
    return antes
  }
}
