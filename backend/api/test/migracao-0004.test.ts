/** A 0004 sobe sobre uma base 1.0.x com dados: nada é perdido, documentos e
 * carteira são preenchidos, e o QUATTUOR que entrou como plataforma vira
 * carteira apartada. */
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { criarBanco } from '../src/infra/banco'
import { aplicarMigracoes } from '../src/infra/migrador'
import { URL_TESTE, temBanco } from './banco'

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../database/migrations')

describe.skipIf(!temBanco)('migração 0004 sobre base existente', () => {
  it('preserva dados e preenche carteira e documentos', async () => {
    const banco = criarBanco(URL_TESTE!, 2)
    const antigas = mkdtempSync(path.join(tmpdir(), 'mig-'))
    try {
      await banco.pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
      for (const f of readdirSync(DIR).filter((f) => f < '0004')) cpSync(path.join(DIR, f), path.join(antigas, f))
      await aplicarMigracoes(banco.pool, antigas)
      await banco.pool.query(`
        INSERT INTO grupo_economico VALUES ('g1', 'G'); INSERT INTO gerente VALUES ('ge1', 'Ger', NULL);
        INSERT INTO plataforma VALUES ('p1', 'EVERBLUE'), ('p2', 'QUATTUOR');
        INSERT INTO cliente (id, nome, cnpj, grupo_economico_id, gerente_id, plataforma_id, setor, ramo_atividade, status, prioridade, criticidade, responsavel)
        VALUES ('c1', 'Um', '11.111.111/0001-11', 'g1', 'ge1', 'p1', 'S', 'R', 'NORMAL', 'MEDIA', 'NORMAL', 'Ger'),
               ('c2', 'Dois', '22.222.222/0001-22', 'g1', 'ge1', 'p2', 'S', 'R', 'NORMAL', 'MEDIA', 'NORMAL', 'Ger');
        INSERT INTO snapshot_semanal (id, cliente_id, semana_ref, risco_cliente, risco_grupo, limite_global, perc_consumo_limite, status_proposta,
          tranche_consolidada, valor_em_andamento, perc_consumo_tranche, status_tranche, vencido_oficial, aging_carteira_dias, prazo_medio_carteira_dias,
          il30, il60, il90, il120, il150, il180, manifesto_perc_sem_atuacao, manifesto_inacessivel, manifesto_nao_confirma, manifesto_transacao_desconhecida,
          manifesto_lastro_inconsistente, manifesto_transacao_nao_concluida, liquidado_no_periodo, recompras, perc_liquidado_no_prazo, atraso_medio_dias, restritivos)
        VALUES ('s1', 'c1', '2026-09-24', 10, 10, 10, 100, 'EM_ANALISE', 0, 0, 0, 'DENTRO_DO_LIMITE', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);`)
      const r = await aplicarMigracoes(banco.pool, DIR)
      expect(r.aplicadas).toEqual(['0004_comite_classificacao_restritivos.sql', '0005_classificacao_nao_avaliados.sql'])
      const { rows: cli } = await banco.pool.query('SELECT id, carteira_id FROM cliente ORDER BY id')
      expect(cli).toEqual([{ id: 'c1', carteira_id: 'car_everblue' }, { id: 'c2', carteira_id: 'car_quattuor' }])
      const { rows: docs } = await banco.pool.query('SELECT cliente_id, principal FROM cliente_documento ORDER BY cliente_id')
      expect(docs).toEqual([{ cliente_id: 'c1', principal: true }, { cliente_id: 'c2', principal: true }])
      expect((await banco.pool.query('SELECT count(*)::int n FROM snapshot_semanal')).rows[0].n).toBe(1)
      // snapshot continua append-only; IL agora aceita ausência
      await expect(banco.pool.query(`UPDATE snapshot_semanal SET il30 = NULL`)).rejects.toThrow(/append-only/)
      // documento de outro cliente é recusado
      await expect(banco.pool.query(`INSERT INTO cliente_documento (cliente_id, documento) VALUES ('c2', '11111111000111')`)).rejects.toThrow()
    } finally {
      rmSync(antigas, { recursive: true, force: true })
      await banco.encerrar()
    }
  })
})
