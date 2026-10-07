/**
 * Bootstrap idempotente, executado pelo job de migração: cadastra só o
 * necessário para o primeiro uso — as regras de alerta e de classificação padrão e o bucket do
 * MinIO. Nunca apaga nem sobrescreve o que já existe.
 */
import { CONFIGURACOES_ALERTA_PADRAO, REGRAS_CLASSIFICACAO_PADRAO } from '@monitoramento/dominio'
import type pg from 'pg'
import type { ArmazenamentoArquivos } from './armazenamento'

export async function executarBootstrap(pool: pg.Pool, armazenamento: ArmazenamentoArquivos, log: (m: string) => void): Promise<void> {
  for (const c of CONFIGURACOES_ALERTA_PADRAO) {
    await pool.query(
      `INSERT INTO configuracao_alerta (id, tipo, descricao, limiar, unidade, gravidade_sugerida, ativo)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (tipo) DO NOTHING`,
      [c.id, c.tipo, c.descricao, c.limiar, c.unidade, c.gravidadeSugerida, c.ativo],
    )
  }
  log(`regras de alerta padrão conferidas (${CONFIGURACOES_ALERTA_PADRAO.length})`)
  for (const r of REGRAS_CLASSIFICACAO_PADRAO) {
    await pool.query(
      `INSERT INTO regra_classificacao (chave, grupo, descricao, valor, unidade, ordem)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (chave) DO NOTHING`,
      [r.chave, r.grupo, r.descricao, r.valor, r.unidade, r.ordem],
    )
  }
  log(`limiares de classificação conferidos (${REGRAS_CLASSIFICACAO_PADRAO.length})`)
  const { versionamento } = await armazenamento.preparar()
  log(versionamento ? 'bucket do MinIO conferido (versionamento ligado)' : 'ATENÇÃO: bucket do MinIO existe, mas o versionamento NÃO pôde ser confirmado — verifique no MinIO')
}
