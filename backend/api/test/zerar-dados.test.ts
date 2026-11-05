/**
 * Limpeza total (ADR-018) contra PostgreSQL real: apaga tudo o que foi
 * carregado (inclusive histórico append-only), mantém usuários, volta regras
 * e agendadores ao padrão, esvazia o MinIO e registra a limpeza na auditoria.
 */
import { describe, expect, it } from 'vitest'
import { ArmazenamentoMemoria } from '../src/infra/armazenamento'
import { executarBootstrap } from '../src/infra/bootstrap'
import { carregarDemonstracao } from '../src/infra/cargaDemonstracao'
import { ServicoZerarDados, TABELAS_APAGADAS } from '../src/servicos/servicoZerarDados'
import { bancoLimpo, temBanco } from './banco'

const contar = async (pool: import('pg').Pool, t: string) => Number((await pool.query(`SELECT count(*) AS n FROM ${t}`)).rows[0].n)

describe.skipIf(!temBanco)('zerar-dados', () => {
  it('apaga tudo menos usuários, reinicia configurações e registra a limpeza', async () => {
    const banco = await bancoLimpo()
    try {
      await carregarDemonstracao(banco, () => {})
      await banco.pool.query(`INSERT INTO usuario (email, nome, perfil, origem) VALUES ('a@grupoeverblue.com.br', 'Analista', 'admin', 'local')`)
      await banco.pool.query(`UPDATE foto_agendamento SET ativo = TRUE`)
      await banco.pool.query(`UPDATE configuracao_alerta SET limiar = limiar + 1`)
      const minio = new ArmazenamentoMemoria()
      await minio.gravar('importados/planilha.xlsx', Buffer.from('x'), 'application/octet-stream')
      await minio.gravar('importados/planilha.xlsx', Buffer.from('y'), 'application/octet-stream')
      await minio.gravar('processados/ata.pdf', Buffer.from('%PDF'), 'application/pdf')

      const usuarios = await contar(banco.pool, 'usuario')
      const regrasPadrao = await contar(banco.pool, 'regra_classificacao')
      const servico = new ServicoZerarDados(banco.pool, minio)

      const sim = await servico.simular()
      expect(sim.totalLinhas).toBeGreaterThan(0)
      expect(sim.linhas.cliente).toBeGreaterThan(0)
      expect(sim.linhas.snapshot_semanal).toBeGreaterThan(0)
      expect(sim.arquivos).toEqual({ chaves: 2, versoes: 3 })
      expect(await contar(banco.pool, 'cliente')).toBe(sim.linhas.cliente) // simulação não altera

      await expect(servico.zerar({ confirmacao: 'apagar tudo', executadoPor: 'x' })).rejects.toThrow(/Confirmação incorreta/)
      expect(await contar(banco.pool, 'cliente')).toBe(sim.linhas.cliente)

      const r = await servico.zerar({ confirmacao: 'APAGAR TUDO', executadoPor: 'everblue@srvmnt01' })
      expect(r.linhas.cliente).toBe(sim.linhas.cliente)
      expect(r.usuariosMantidos).toBe(usuarios)
      for (const t of TABELAS_APAGADAS) if (t !== 'auditoria') expect(await contar(banco.pool, t), t).toBe(0)
      expect(await contar(banco.pool, 'usuario')).toBe(usuarios)
      expect(await contar(banco.pool, 'carteira')).toBeGreaterThan(0)
      expect((await banco.pool.query('SELECT ativo FROM foto_agendamento')).rows).toEqual([{ ativo: false }])
      expect(await contar(banco.pool, 'mapa_agendamento')).toBe(1)
      expect(minio.objetos.size).toBe(0)
      const aud = (await banco.pool.query(`SELECT acao, ator_email, detalhes FROM auditoria ORDER BY id`)).rows
      expect(aud.map((a) => a.acao)).toEqual(['dados.zerados', 'arquivos.zerados'])
      expect(aud[0].ator_email).toBe('everblue@srvmnt01')
      expect(aud[0].detalhes.linhasApagadas.cliente).toBe(sim.linhas.cliente)

      // As regras voltam pelo bootstrap (o comando roda logo depois).
      await executarBootstrap(banco.pool, minio, () => {})
      expect(await contar(banco.pool, 'regra_classificacao')).toBe(regrasPadrao)

      // Histórico continua protegido contra DELETE de linha.
      await expect(banco.pool.query(`DELETE FROM auditoria`)).rejects.toThrow(/append-only/)
      // Rodar de novo é seguro.
      await servico.zerar({ confirmacao: 'APAGAR TUDO', executadoPor: 'x' })
    } finally {
      await banco.encerrar()
    }
  })

  it('recusa sem apagar nada se houver tabela não classificada ou foto em execução', async () => {
    const banco = await bancoLimpo()
    try {
      await carregarDemonstracao(banco, () => {})
      const clientes = await contar(banco.pool, 'cliente')
      const servico = new ServicoZerarDados(banco.pool, new ArmazenamentoMemoria())
      await banco.pool.query('CREATE TABLE tabela_nova (id INT)')
      await expect(servico.zerar({ confirmacao: 'APAGAR TUDO', executadoPor: 'x' })).rejects.toThrow(/sem classificação.*tabela_nova/)
      await banco.pool.query('DROP TABLE tabela_nova')
      const { rows } = await banco.pool.query(`SELECT id FROM usuario LIMIT 1`)
      await banco.pool.query(`INSERT INTO foto_execucao (origem, solicitado_por, gravar_posicao, versao_regras) VALUES ('MANUAL', $1, FALSE, 't')`, [rows[0].id])
      await expect(servico.zerar({ confirmacao: 'APAGAR TUDO', executadoPor: 'x' })).rejects.toThrow(/foto do Bitfin em execução/)
      expect(await contar(banco.pool, 'cliente')).toBe(clientes)
    } finally {
      await banco.encerrar()
    }
  })
})
