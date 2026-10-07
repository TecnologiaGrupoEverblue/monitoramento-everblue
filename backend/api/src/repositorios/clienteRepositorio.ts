import type { Cliente, DocumentoCliente, FiltrosGlobais } from '@monitoramento/dominio'
import { linhaParaEntidade, montarUpdateParcial, type Executor } from '../infra/banco'
import { condicoesClientes } from './filtrosSql'

const COLUNAS = `c.id, c.nome, c.cnpj, c.grupo_economico_id, c.gerente_id, c.plataforma_id, c.carteira_id, c.setor, c.ramo_atividade,
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

  /** Todo documento (principal ou não) → cliente dono. É por aqui que a
   * importação reconhece um cliente que já existe. */
  async mapaPorDocumento(executor: Executor = this.db): Promise<Map<string, Cliente>> {
    const { rows } = await executor.query(
      `SELECT ${COLUNAS}, d.documento_normalizado
         FROM cliente_documento d JOIN cliente c ON c.id = d.cliente_id`,
    )
    return new Map(rows.map((r) => [String(r.documento_normalizado), linhaParaEntidade<Cliente>({ ...r, documento_normalizado: undefined })]))
  }

  /** Compatibilidade: só o documento principal. */
  async mapaPorCnpjNormalizado(executor: Executor = this.db): Promise<Map<string, Cliente>> {
    return this.mapaPorDocumento(executor)
  }

  async documentos(clienteId: string): Promise<DocumentoCliente[]> {
    const { rows } = await this.db.query(
      'SELECT documento, principal FROM cliente_documento WHERE cliente_id = $1 ORDER BY principal DESC, id',
      [clienteId],
    )
    return rows.map((r) => ({ documento: r.documento, principal: r.principal }))
  }

  async documentosPorCliente(executor: Executor = this.db): Promise<Map<string, string[]>> {
    const { rows } = await executor.query('SELECT cliente_id, documento FROM cliente_documento ORDER BY cliente_id, principal DESC, id')
    const mapa = new Map<string, string[]>()
    for (const r of rows) {
      const lista = mapa.get(r.cliente_id) ?? []
      lista.push(r.documento)
      mapa.set(r.cliente_id, lista)
    }
    return mapa
  }

  /** Acrescenta documentos secundários. Nunca remove nem troca o principal. */
  async adicionarDocumentos(clienteId: string, documentos: string[], executor: Executor = this.db): Promise<number> {
    let novos = 0
    for (const documento of documentos) {
      const { rowCount } = await executor.query(
        `INSERT INTO cliente_documento (cliente_id, documento, principal) VALUES ($1, $2, FALSE)
         ON CONFLICT (documento_normalizado) DO NOTHING`,
        [clienteId, documento],
      )
      novos += rowCount ?? 0
    }
    return novos
  }

  async criar(cliente: Cliente, executor: Executor = this.db): Promise<void> {
    await executor.query(
      `INSERT INTO cliente (id, nome, cnpj, grupo_economico_id, gerente_id, plataforma_id, carteira_id, setor, ramo_atividade, produtos,
                            status, prioridade, criticidade, responsavel, criado_em)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'car_everblue'), $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        cliente.id, cliente.nome, cliente.cnpj, cliente.grupoEconomicoId, cliente.gerenteId, cliente.plataformaId, cliente.carteiraId ?? null, cliente.setor,
        cliente.ramoAtividade, cliente.produtos, cliente.status, cliente.prioridade, cliente.criticidade, cliente.responsavel, cliente.criadoEm,
      ],
    )
  }

  /** Atualização vinda da Importação Semanal: cadastro e status. Carteira só
   * muda quando a planilha traz a coluna. Prioridade e criticidade são
   * gravadas à parte, pela classificação semanal; responsável nunca. */
  async atualizarPelaImportacao(
    id: string,
    dados: Pick<Cliente, 'nome' | 'grupoEconomicoId' | 'gerenteId' | 'plataformaId' | 'setor' | 'ramoAtividade' | 'produtos' | 'status'> & { carteiraId?: string | null },
    executor: Executor = this.db,
  ): Promise<void> {
    await executor.query(
      `UPDATE cliente SET nome = $2, grupo_economico_id = $3, gerente_id = $4, plataforma_id = $5, setor = $6,
                          ramo_atividade = $7, produtos = $8, status = $9, carteira_id = COALESCE($10, carteira_id)
        WHERE id = $1`,
      [id, dados.nome, dados.grupoEconomicoId, dados.gerenteId, dados.plataformaId, dados.setor, dados.ramoAtividade, dados.produtos, dados.status, dados.carteiraId ?? null],
    )
  }

  /** Prioridade e criticidade calculadas pela classificação semanal — em lote. */
  async gravarClassificacoes(lista: (Pick<Cliente, 'id' | 'prioridade' | 'criticidade'>)[], executor: Executor = this.db): Promise<void> {
    for (let i = 0; i < lista.length; i += 1000) {
      const lote = lista.slice(i, i + 1000)
      await executor.query(
        `UPDATE cliente c SET prioridade = v.prioridade, criticidade = v.criticidade
           FROM unnest($1::text[], $2::text[], $3::text[]) AS v(id, prioridade, criticidade)
          WHERE c.id = v.id`,
        [lote.map((x) => x.id), lote.map((x) => x.prioridade), lote.map((x) => x.criticidade)],
      )
    }
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
