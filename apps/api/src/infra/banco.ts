/**
 * Acesso ao PostgreSQL. Esta é a única camada que conhece o driver `pg`:
 * repositórios recebem um `Executor` (pool ou transação) e nada mais.
 */
import pg from 'pg'

// NUMERIC chega do driver como string para não perder precisão. O domínio
// trabalha com `number` (o mesmo que o protótipo usava), e os valores
// guardados têm no máximo 18 dígitos com 2 casas — cabem com folga no double
// para exibição e agregação. A exatidão fica garantida onde importa: no banco.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)))
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => (v === null ? null : Number(v)))
// DATE como texto `yyyy-MM-dd`, exatamente o formato do domínio. Convertê-lo
// em Date aplicaria fuso horário e mudaria o dia de um vencimento.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v)
// TIMESTAMPTZ como ISO 8601 em UTC — o formato que o domínio usa em `criadoEm`.
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (v) => (v === null ? null : new Date(v).toISOString()))

export type Executor = Pick<pg.Pool, 'query'> | Pick<pg.PoolClient, 'query'>

export interface Banco {
  pool: pg.Pool
  transacao<T>(trabalho: (cliente: pg.PoolClient) => Promise<T>): Promise<T>
  encerrar(): Promise<void>
}

export function criarBanco(url: string, max: number): Banco {
  const pool = new pg.Pool({
    connectionString: url,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Consulta sem teto é como uma tela pesada derruba o banco dos outros.
    statement_timeout: 30_000,
    application_name: 'everblue-monitoramento-api',
  })
  return {
    pool,
    async transacao(trabalho) {
      const cliente = await pool.connect()
      try {
        await cliente.query('BEGIN')
        const resultado = await trabalho(cliente)
        await cliente.query('COMMIT')
        return resultado
      } catch (erro) {
        await cliente.query('ROLLBACK').catch(() => undefined)
        throw erro
      } finally {
        cliente.release()
      }
    },
    encerrar: () => pool.end(),
  }
}

// ------------------------------------------------------------------ mapeamento

const cacheSnake = new Map<string, string>()
const cacheCamel = new Map<string, string>()

export function paraSnake(campo: string): string {
  let valor = cacheSnake.get(campo)
  if (!valor) {
    valor = campo.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`)
    cacheSnake.set(campo, valor)
  }
  return valor
}

export function paraCamel(coluna: string): string {
  let valor = cacheCamel.get(coluna)
  if (!valor) {
    valor = coluna.replace(/_([a-z0-9])/g, (_, l: string) => l.toUpperCase())
    cacheCamel.set(coluna, valor)
  }
  return valor
}

/** Linha do banco (snake_case) → entidade do domínio (camelCase). */
export function linhaParaEntidade<T>(linha: Record<string, unknown>): T {
  const entidade: Record<string, unknown> = {}
  for (const [coluna, valor] of Object.entries(linha)) entidade[paraCamel(coluna)] = valor
  return entidade as T
}

export function linhasParaEntidades<T>(linhas: Record<string, unknown>[]): T[] {
  return linhas.map((l) => linhaParaEntidade<T>(l))
}

/** Identificador SQL seguro: só aceita o que casar com o padrão de coluna.
 * Os nomes vêm sempre do código (campos das entidades), nunca do usuário —
 * a checagem existe para que um descuido futuro falhe alto em vez de virar
 * injeção. */
export function identificador(nome: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(nome)) throw new Error(`Identificador SQL inválido: ${nome}`)
  return `"${nome}"`
}

/** Monta um INSERT a partir das chaves da entidade. */
export function montarInsert(tabela: string, entidade: Record<string, unknown>, colunasJson: string[] = []) {
  const colunas = Object.keys(entidade).map(paraSnake)
  const valores = Object.values(entidade).map((v, i) => (colunasJson.includes(colunas[i]) ? JSON.stringify(v) : v))
  const marcadores = colunas.map((c, i) => (colunasJson.includes(c) ? `$${i + 1}::jsonb` : `$${i + 1}`))
  return {
    texto: `INSERT INTO ${identificador(tabela)} (${colunas.map(identificador).join(', ')}) VALUES (${marcadores.join(', ')})`,
    valores,
  }
}

/** Insere várias entidades de mesmo formato em lotes (uma ida ao banco por lote). */
export async function inserirEmLote(
  executor: Executor,
  tabela: string,
  entidades: Record<string, unknown>[],
  colunasJson: string[] = [],
  tamanhoLote = 500,
): Promise<void> {
  if (entidades.length === 0) return
  const campos = Object.keys(entidades[0])
  const colunas = campos.map(paraSnake)
  for (let inicio = 0; inicio < entidades.length; inicio += tamanhoLote) {
    const lote = entidades.slice(inicio, inicio + tamanhoLote)
    const valores: unknown[] = []
    const linhas = lote.map((entidade) => {
      const marcadores = campos.map((campo, j) => {
        const valor = entidade[campo]
        valores.push(colunasJson.includes(colunas[j]) ? JSON.stringify(valor) : valor)
        return colunasJson.includes(colunas[j]) ? `$${valores.length}::jsonb` : `$${valores.length}`
      })
      return `(${marcadores.join(', ')})`
    })
    await executor.query(
      `INSERT INTO ${identificador(tabela)} (${colunas.map(identificador).join(', ')}) VALUES ${linhas.join(', ')}`,
      valores,
    )
  }
}

/** Monta um UPDATE parcial restrito a uma lista de campos permitidos. */
export function montarUpdateParcial(
  tabela: string,
  id: string,
  alteracoes: Record<string, unknown>,
  permitidos: readonly string[],
): { texto: string; valores: unknown[] } | null {
  const pares = Object.entries(alteracoes).filter(([campo, valor]) => permitidos.includes(campo) && valor !== undefined)
  if (pares.length === 0) return null
  const sets = pares.map(([campo], i) => `${identificador(paraSnake(campo))} = $${i + 2}`)
  return {
    texto: `UPDATE ${identificador(tabela)} SET ${sets.join(', ')} WHERE id = $1`,
    valores: [id, ...pares.map(([, valor]) => valor)],
  }
}
