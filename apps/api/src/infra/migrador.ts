/**
 * Aplicação das migrações versionadas de `database/migrations`.
 *
 * - Roda num job dedicado (`node dist/cli.js migrar`), antes da API subir —
 *   nunca no start de cada réplica.
 * - Trava consultiva impede duas execuções simultâneas.
 * - Cada migração roda em transação própria e é registrada com checksum. Se um
 *   arquivo já aplicado mudar, o processo para: migração aplicada é história,
 *   e mudança nela é sinal de engano, não de evolução.
 */
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type pg from 'pg'

const TRAVA_MIGRACAO = 7_310_2026

export interface ResultadoMigracao {
  aplicadas: string[]
  jaAplicadas: number
}

export async function aplicarMigracoes(pool: pg.Pool, diretorio: string, log: (msg: string) => void = () => {}): Promise<ResultadoMigracao> {
  const arquivos = (await readdir(diretorio)).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort()
  const cliente = await pool.connect()
  try {
    await cliente.query('SELECT pg_advisory_lock($1)', [TRAVA_MIGRACAO])
    await cliente.query(`CREATE TABLE IF NOT EXISTS migracao_aplicada (
      nome TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      aplicada_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)
    const { rows } = await cliente.query<{ nome: string; checksum: string }>('SELECT nome, checksum FROM migracao_aplicada')
    const aplicadas = new Map(rows.map((r) => [r.nome, r.checksum]))
    const novas: string[] = []

    for (const arquivo of arquivos) {
      const sql = await readFile(path.join(diretorio, arquivo), 'utf8')
      const checksum = createHash('sha256').update(sql).digest('hex')
      const anterior = aplicadas.get(arquivo)
      if (anterior) {
        if (anterior !== checksum) {
          throw new Error(`A migração ${arquivo} já foi aplicada e o arquivo mudou. Crie uma nova migração em vez de alterar uma existente.`)
        }
        continue
      }
      log(`aplicando migração ${arquivo}`)
      await cliente.query('BEGIN')
      try {
        await cliente.query(sql)
        await cliente.query('INSERT INTO migracao_aplicada (nome, checksum) VALUES ($1, $2)', [arquivo, checksum])
        await cliente.query('COMMIT')
      } catch (erro) {
        await cliente.query('ROLLBACK')
        throw new Error(`Falha ao aplicar ${arquivo}: ${(erro as Error).message}`)
      }
      novas.push(arquivo)
    }
    return { aplicadas: novas, jaAplicadas: aplicadas.size }
  } finally {
    await cliente.query('SELECT pg_advisory_unlock($1)', [TRAVA_MIGRACAO]).catch(() => undefined)
    cliente.release()
  }
}
