import type { ConfiguracaoAlerta } from '@monitoramento/dominio'
import { linhasParaEntidades, montarUpdateParcial, type Executor } from '../infra/banco'

export const CAMPOS_EDITAVEIS_CONFIG = ['limiar', 'gravidadeSugerida', 'ativo', 'descricao'] as const

/** Regras e limiares de alerta — configuráveis pela tela de Cadastros. */
export class ConfiguracaoRepositorio {
  constructor(private readonly db: Executor) {}

  async listarAlertas(executor: Executor = this.db): Promise<ConfiguracaoAlerta[]> {
    return linhasParaEntidades((await executor.query('SELECT * FROM configuracao_alerta ORDER BY id COLLATE "C"')).rows)
  }
  async atualizarAlerta(id: string, alteracoes: Partial<ConfiguracaoAlerta>): Promise<boolean> {
    const sql = montarUpdateParcial('configuracao_alerta', id, alteracoes as Record<string, unknown>, CAMPOS_EDITAVEIS_CONFIG)
    if (!sql) return false
    const { rowCount } = await this.db.query(sql.texto, sql.valores)
    return (rowCount ?? 0) > 0
  }
}
