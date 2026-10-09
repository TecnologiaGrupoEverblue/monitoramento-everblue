/** 0006: gerente de nome vazio (importação de base sem gerente) vira "Sem
 * Gerente" — renomeando ou, se o cadastro já existir, fundindo nele. */
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { criarBanco } from '../src/infra/banco'
import { aplicarMigracoes } from '../src/infra/migrador'
import { URL_TESTE, temBanco } from './banco'

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../database/migrations')

async function cenario(semGerenteJaExiste: boolean) {
  const banco = criarBanco(URL_TESTE!, 2)
  const antigas = mkdtempSync(path.join(tmpdir(), 'mig6-'))
  try {
    await banco.pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    for (const f of readdirSync(DIR).filter((f) => f < '0006')) cpSync(path.join(DIR, f), path.join(antigas, f))
    await aplicarMigracoes(banco.pool, antigas)
    await banco.pool.query(`
      INSERT INTO grupo_economico VALUES ('g1', 'G'); INSERT INTO plataforma VALUES ('p1', 'P');
      INSERT INTO gerente VALUES ('ge_vazio', '', NULL), ('ge1', 'Joice', NULL);
      ${semGerenteJaExiste ? `INSERT INTO gerente VALUES ('ge_sem', 'Sem Gerente', NULL);` : ''}
      INSERT INTO cliente (id, nome, cnpj, grupo_economico_id, gerente_id, plataforma_id, setor, ramo_atividade, status, prioridade, criticidade, responsavel)
      VALUES ('c1', 'Um', '11.111.111/0001-11', 'g1', 'ge_vazio', 'p1', 'S', 'R', 'NORMAL', 'MEDIA', 'NORMAL', ''),
             ('c2', 'Dois', '22.222.222/0001-22', 'g1', 'ge1', 'p1', 'S', 'R', 'NORMAL', 'MEDIA', 'NORMAL', 'Joice');`)
    const r = await aplicarMigracoes(banco.pool, DIR)
    expect(r.aplicadas).toEqual(['0006_sem_gerente.sql', '0007_importacao_formato.sql'])
    const { rows: gerentes } = await banco.pool.query(`SELECT id, nome FROM gerente ORDER BY nome`)
    const { rows: clientes } = await banco.pool.query(`SELECT c.id, g.nome AS gerente, c.responsavel FROM cliente c JOIN gerente g ON g.id = c.gerente_id ORDER BY c.id`)
    return { gerentes, clientes }
  } finally {
    rmSync(antigas, { recursive: true, force: true })
    await banco.encerrar()
  }
}

describe.skipIf(!temBanco)('migração 0006 — Sem Gerente', () => {
  it('renomeia o gerente vazio', async () => {
    const { gerentes, clientes } = await cenario(false)
    expect(gerentes).toEqual([{ id: 'ge1', nome: 'Joice' }, { id: 'ge_vazio', nome: 'Sem Gerente' }])
    expect(clientes).toEqual([
      { id: 'c1', gerente: 'Sem Gerente', responsavel: 'Sem Gerente' },
      { id: 'c2', gerente: 'Joice', responsavel: 'Joice' },
    ])
  })
  it('funde no "Sem Gerente" que já existe', async () => {
    const { gerentes, clientes } = await cenario(true)
    expect(gerentes).toEqual([{ id: 'ge1', nome: 'Joice' }, { id: 'ge_sem', nome: 'Sem Gerente' }])
    expect(clientes[0]).toEqual({ id: 'c1', gerente: 'Sem Gerente', responsavel: 'Sem Gerente' })
  })
})
