/** Classificação semanal (append-only) e limiares das regras. */
import type { ClassificacaoSemanal, RegraClassificacao } from '@monitoramento/dominio'
import { linhasParaEntidades, type Executor } from '../infra/banco'

function mapear(r: Record<string, unknown>): ClassificacaoSemanal {
  return {
    clienteId: String(r.cliente_id),
    semanaRef: String(r.semana_ref),
    prioridadeOrdem: Number(r.prioridade_ordem) as ClassificacaoSemanal['prioridadeOrdem'],
    enquadramento: r.enquadramento as ClassificacaoSemanal['enquadramento'],
    motivosEnquadramento: (r.motivos_enquadramento as string[]) ?? [],
    criticidade: r.criticidade as ClassificacaoSemanal['criticidade'],
    tendenciaLiquidez: r.tendencia_liquidez as ClassificacaoSemanal['tendenciaLiquidez'],
    qtdAlertas: Number(r.qtd_alertas),
    alertas: (r.alertas as ClassificacaoSemanal['alertas']) ?? [],
    naoAvaliados: (r.nao_avaliados as string[]) ?? [],
    calculadoEm: String(r.calculado_em),
  }
}

export class ClassificacaoRepositorio {
  constructor(private readonly db: Executor) {}

  /** Grava em lotes (uma ida ao banco por lote, não por cliente). */
  async inserir(lista: ClassificacaoSemanal[], executor: Executor = this.db, tamanhoLote = 500): Promise<void> {
    for (let inicio = 0; inicio < lista.length; inicio += tamanhoLote) {
      const lote = lista.slice(inicio, inicio + tamanhoLote)
      const valores: unknown[] = []
      const linhas = lote.map((c) => {
        valores.push(
          c.clienteId, c.semanaRef, c.prioridadeOrdem, c.enquadramento, c.criticidade, c.tendenciaLiquidez, c.qtdAlertas,
          JSON.stringify(c.alertas), JSON.stringify(c.motivosEnquadramento), JSON.stringify(c.naoAvaliados ?? []), c.calculadoEm,
        )
        const b = valores.length - 11
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}::jsonb, $${b + 9}::jsonb, $${b + 10}::jsonb, $${b + 11})`
      })
      await executor.query(
        `INSERT INTO classificacao_semanal (cliente_id, semana_ref, prioridade_ordem, enquadramento, criticidade, tendencia_liquidez,
                                            qtd_alertas, alertas, motivos_enquadramento, nao_avaliados, calculado_em)
         VALUES ${linhas.join(', ')}
         ON CONFLICT (cliente_id, semana_ref) DO NOTHING`,
        valores,
      )
    }
  }

  async porSemana(semanaRef: string, executor: Executor = this.db): Promise<Map<string, ClassificacaoSemanal>> {
    const { rows } = await executor.query('SELECT * FROM classificacao_semanal WHERE semana_ref = $1', [semanaRef])
    return new Map(rows.map((r) => [String(r.cliente_id), mapear(r)]))
  }

  async porSemanas(semanas: string[]): Promise<ClassificacaoSemanal[]> {
    if (semanas.length === 0) return []
    const { rows } = await this.db.query('SELECT * FROM classificacao_semanal WHERE semana_ref = ANY($1::date[])', [semanas])
    return rows.map(mapear)
  }

  async porCliente(clienteId: string): Promise<ClassificacaoSemanal[]> {
    const { rows } = await this.db.query('SELECT * FROM classificacao_semanal WHERE cliente_id = $1 ORDER BY semana_ref', [clienteId])
    return rows.map(mapear)
  }

  /** Última classificação de cada cliente. */
  async ultimas(): Promise<Map<string, ClassificacaoSemanal>> {
    const { rows } = await this.db.query('SELECT DISTINCT ON (cliente_id) * FROM classificacao_semanal ORDER BY cliente_id, semana_ref DESC')
    return new Map(rows.map((r) => [String(r.cliente_id), mapear(r)]))
  }

  async listarRegras(executor: Executor = this.db): Promise<RegraClassificacao[]> {
    return linhasParaEntidades((await executor.query('SELECT chave, grupo, descricao, valor, unidade, ordem FROM regra_classificacao ORDER BY ordem')).rows)
  }

  /** Devolve o valor anterior (para a auditoria) ou `null` se a regra não existe. */
  async atualizarRegra(chave: string, valor: number, por: string): Promise<number | null> {
    const { rows } = await this.db.query(
      `UPDATE regra_classificacao r SET valor = $2, atualizado_em = now(), atualizado_por = $3
         FROM (SELECT chave, valor FROM regra_classificacao WHERE chave = $1 FOR UPDATE) antes
        WHERE r.chave = antes.chave
        RETURNING antes.valor AS anterior`,
      [chave, valor, por],
    )
    return rows[0] ? Number(rows[0].anterior) : null
  }
}
