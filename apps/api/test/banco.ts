import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { criarBanco, type Banco } from '../src/infra/banco'
import { aplicarMigracoes } from '../src/infra/migrador'
import { executarBootstrap } from '../src/infra/bootstrap'
import { ArmazenamentoMemoria } from '../src/infra/armazenamento'

export const URL_TESTE = process.env.TESTE_DATABASE_URL
export const temBanco = Boolean(URL_TESTE)

/** Banco de teste zerado e migrado. Exige TESTE_DATABASE_URL (PostgreSQL real:
 * o que precisa ser exercitado é o SQL, não um dublê). */
export async function bancoLimpo(): Promise<Banco> {
  const banco = criarBanco(URL_TESTE!, 5)
  await banco.pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../database/migrations')
  await aplicarMigracoes(banco.pool, dir)
  await executarBootstrap(banco.pool, new ArmazenamentoMemoria(), () => {})
  return banco
}
