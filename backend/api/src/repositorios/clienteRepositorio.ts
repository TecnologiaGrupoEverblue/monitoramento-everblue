import type { Cliente, FiltrosGlobais } from '@monitoramento/dominio'
import { linhaParaEntidade, montarUpdateParcial, type Executor } from '../infra/banco'
import { condicoesClientes } from './filtrosSql'

const COLUNAS = `c.id, c.nome, c.cnpj, c.grupo_economico_id, c.gerente_id, c.plataforma_id, c.setor, c.ramo_atividade,
                 c.produtos, c.status, c.prioridade, c.criticidade, c.responsavel, c.criado_em`

/** Campos que a interface pode alterar num cliente — decisões manuais do comitê. */
export const CAMPOS_EDITAVEIS_CLIENTE = ['prioridade', 'criticidade', 'responsavel', 'status'] as const

export class ClienteRepositorio {
  constructor(private readonly db: Executor) {}

  async listar(filtros: Partial<FiltrosGlobais> = {}, executor: Executor = this.db): Promise<Cliente[]> {
    const parametros: unknown[] = []
    const onde = condicoesClientes(filtros, parametros)
    const { rows } = await executor.query(`SELECT ${COLUNAS} FROM cliente c WHERE ${onde} ORDER BY c.id COLLATE "C"`, parametros)
    return rows.map((r) => linhaParaEntidade<Cliente>(r))
  }

  async porId(id: string, executor: Executor = this.db): Promise<Cliente | null> {
    const { rows } = await executor.query(`SELECT ${COLUNAS} FROM cliente c WHERE c.id = $1`, [id])
    return rows[0] ? linhaParaEntidade<Cliente>(rows[0]) : null
  }

  async mapaPorCnpjNormalizado(executor: Executor = this.db): Promise<Map<string, Cliente>> {
    const { rows } = await executor.query(`SELECT ${COLUNAS}, c.cnpj_normalizado FROM cliente c`)
    return new Map(rows.map((r) => [String(r.cnpj_normalizado), linhaParaEntidade<Cliente>({ ...r, cnpj_normalizado: undefined })]))
  }

  async criar(cliente: Cliente, executor: Executor = this.db): Promise<void> {
    await executor.query(
      `INSERT INTO cliente (id, nome, cnpj, grupo_economico_id, gerente_id, plataforma_id, setor, ramo_atividade, produtos,
                            status, prioridade, criticidade, responsavel, criado_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        cliente.id, cliente.nome, cliente.cnpj, cliente.grupoEconomicoId, cliente.gerenteId, cliente.plataformaId, cliente.setor,
        cliente.ramoAtividade, cliente.produtos, cliente.status, cliente.prioridade, cliente.criticidade, cliente.responsavel, cliente.criadoEm,
      ],
    )
  }

  /** Atualização vinda da Importação Semanal: nunca toca em prioridade,
   * criticidade nem responsável — decisões manuais do comitê. */
  async atualizarPelaImportacao(
    id: string,
    dados: Pick<Cliente, 'nome' | 'grupoEconomicoId' | 'gerenteId' | 'plataformaId' | 'setor' | 'ramoAtividade' | 'produtos' | 'status'>,
    executor: Executor = this.db,
  ): Promise<void> {
    await executor.query(
      `UPDATE cliente SET nome = $2, grupo_economico_id = $3, gerente_id = $4, plataforma_id = $5, setor = $6,
                          ramo_atividade = $7, produtos = $8, status = $9
        WHERE id = $1`,
      [id, dados.nome, dados.grupoEconomicoId, dados.gerenteId, dados.plataformaId, dados.setor, dados.ramoAtividade, dados.produtos, dados.status],
    )
  }

  async atualizar(id: string, alteracoes: Partial<Cliente>, executor: Executor = this.db): Promise<boolean> {
    const sql = montarUpdateParcial('cliente', id, alteracoes as Record<string, unknown>, CAMPOS_EDITAVEIS_CLIENTE)
    if (!sql) return false
    const { rowCount } = await executor.query(sql.texto, sql.valores)
    return (rowCount ?? 0) > 0
  }

  async valoresDistintos(): Promise<{ setores: string[]; ramos: string[]; produtos: string[] }> {
    const [setores, ramos, produtos] = await Promise.all([
      this.db.query(`SELECT DISTINCT setor COLLATE "C" AS v FROM cliente ORDER BY 1`),
      this.db.query(`SELECT DISTINCT ramo_atividade COLLATE "C" AS v FROM cliente ORDER BY 1`),
      this.db.query(`SELECT DISTINCT p COLLATE "C" AS v FROM cliente, unnest(produtos) AS p ORDER BY 1`),
    ])
    const lista = (r: { rows: { v: string }[] }) => r.rows.map((l) => l.v)
    return { setores: lista(setores), ramos: lista(ramos), produtos: lista(produtos) }
  }

  async contar(): Promise<number> {
    const { rows } = await this.db.query('SELECT count(*)::int AS n FROM cliente')
    return rows[0].n
  }
}
