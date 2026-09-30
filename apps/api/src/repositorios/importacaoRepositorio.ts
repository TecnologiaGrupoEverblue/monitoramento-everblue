import type { LinhaComErro, LinhaValidada, PreviewImportacao } from '@monitoramento/dominio'
import type { Executor } from '../infra/banco'

export interface RegistroImportacao {
  id: string
  arquivoId: string
  nomeArquivo: string
  semanaRef: string
  status: 'PREVIA' | 'CONFIRMADA'
  linhasValidas: LinhaValidada[]
  linhasComErro: LinhaComErro[]
  colunasFaltando: string[]
  criadoPor: string
}

export class ImportacaoRepositorio {
  constructor(private readonly db: Executor) {}

  async criar(r: Omit<RegistroImportacao, 'status' | 'nomeArquivo'>, executor: Executor = this.db): Promise<void> {
    await executor.query(
      `INSERT INTO importacao (id, arquivo_id, semana_ref, linhas_validas, linhas_com_erro, colunas_faltando, criado_por)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)`,
      [r.id, r.arquivoId, r.semanaRef, JSON.stringify(r.linhasValidas), JSON.stringify(r.linhasComErro), r.colunasFaltando, r.criadoPor],
    )
  }

  async porId(id: string, executor: Executor = this.db, travar = false): Promise<RegistroImportacao | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null
    const { rows } = await executor.query(
      `SELECT i.*, a.nome_original FROM importacao i JOIN arquivo a ON a.id = i.arquivo_id WHERE i.id = $1${travar ? ' FOR UPDATE OF i' : ''}`,
      [id],
    )
    const l = rows[0]
    if (!l) return null
    return {
      id: l.id,
      arquivoId: l.arquivo_id,
      nomeArquivo: l.nome_original,
      semanaRef: l.semana_ref,
      status: l.status,
      linhasValidas: l.linhas_validas,
      linhasComErro: l.linhas_com_erro,
      colunasFaltando: l.colunas_faltando,
      criadoPor: l.criado_por,
    }
  }

  async atualizarSemana(id: string, semanaRef: string): Promise<void> {
    await this.db.query(`UPDATE importacao SET semana_ref = $2 WHERE id = $1 AND status = 'PREVIA'`, [id, semanaRef])
  }

  async confirmar(id: string, usuarioId: string, semanaRef: string, totais: PreviewImportacao['totais'], executor: Executor): Promise<void> {
    await executor.query(
      `UPDATE importacao SET status = 'CONFIRMADA', confirmado_por = $2, confirmado_em = now(), semana_ref = $3, totais = $4::jsonb WHERE id = $1`,
      [id, usuarioId, semanaRef, JSON.stringify(totais)],
    )
  }
}
