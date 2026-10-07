import { randomUUID } from 'node:crypto'
import type { Carteira, Gerente, GrupoEconomico, Plataforma } from '@monitoramento/dominio'
import { linhasParaEntidades, type Executor } from '../infra/banco'

/** Identificador de entidade: prefixo + instante (base 36) + aleatório.
 * Ordenável no tempo, como o `novoIdSessao` do protótipo — listas em ordem
 * de identificador continuam em ordem de criação. */
export function novoId(prefixo: string): string {
  return `${prefixo}_${Date.now().toString(36)}${randomUUID().replace(/-/g, '').slice(0, 10)}`
}

type TabelaCadastro = 'grupo_economico' | 'gerente' | 'plataforma' | 'carteira'
const PREFIXO: Record<TabelaCadastro, string> = { grupo_economico: 'grp', gerente: 'ger', plataforma: 'plt', carteira: 'car' }

/** Grupos econômicos, gerentes e plataformas comerciais. */
export class CadastrosRepositorio {
  constructor(private readonly db: Executor) {}

  async listarGrupos(): Promise<GrupoEconomico[]> {
    return linhasParaEntidades((await this.db.query('SELECT id, nome FROM grupo_economico ORDER BY id COLLATE "C"')).rows)
  }
  async listarGerentes(): Promise<Gerente[]> {
    const { rows } = await this.db.query('SELECT id, nome, email FROM gerente ORDER BY id COLLATE "C"')
    return rows.map((r) => ({ id: r.id, nome: r.nome, ...(r.email ? { email: r.email } : {}) }))
  }
  async listarPlataformas(): Promise<Plataforma[]> {
    return linhasParaEntidades((await this.db.query('SELECT id, nome FROM plataforma ORDER BY id COLLATE "C"')).rows)
  }

  async listarCarteiras(executor: Executor = this.db): Promise<Carteira[]> {
    return linhasParaEntidades((await executor.query('SELECT id, nome, apartada FROM carteira ORDER BY apartada, nome')).rows)
  }
  async idsCarteirasApartadas(executor: Executor = this.db): Promise<Set<string>> {
    const { rows } = await executor.query('SELECT id FROM carteira WHERE apartada')
    return new Set(rows.map((r) => String(r.id)))
  }
  async definirCarteiraApartada(id: string, apartada: boolean): Promise<boolean> {
    const { rowCount } = await this.db.query('UPDATE carteira SET apartada = $2 WHERE id = $1', [id, apartada])
    return (rowCount ?? 0) > 0
  }

  /** A planilha traz o nome, não o id: acha o cadastro (sem diferenciar
   * maiúsculas/espaços) ou cria na hora. Seguro sob concorrência pelo índice único. */
  async encontrarOuCriar(tabela: TabelaCadastro, nome: string, executor: Executor = this.db): Promise<{ id: string; nome: string }> {
    const limpo = nome.trim()
    const { rows } = await executor.query(
      `INSERT INTO ${tabela} (id, nome) VALUES ($1, $2)
       ON CONFLICT ((lower(btrim(nome)))) DO UPDATE SET nome = ${tabela}.nome
       RETURNING id, nome`,
      [novoId(PREFIXO[tabela]), limpo],
    )
    return rows[0]
  }
}
