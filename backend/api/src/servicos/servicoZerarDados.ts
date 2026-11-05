/**
 * Limpeza total dos dados carregados (decisão de 30/10/2026, ADR-018): tudo
 * o que foi lançado até a 1.2 era teste; daqui em diante os dados vêm só do
 * Bitfin. Mantém APENAS usuários e perfis (e o cadastro de carteiras e o
 * controle de migrações, que são estrutura). Regras de alerta e de
 * classificação voltam ao padrão (bootstrap), agendadores voltam ao padrão.
 *
 * Fail-closed:
 *   - toda tabela do banco precisa estar classificada aqui (apagar, reiniciar
 *     ou manter); tabela nova não classificada → recusa sem apagar nada;
 *   - recusa com foto em execução (pare a API antes);
 *   - TRUNCATE sem CASCADE numa única transação: se alguma tabela mantida
 *     depender de uma apagada, o PostgreSQL recusa e nada é apagado;
 *   - a frase de confirmação precisa ser exata.
 * TRUNCATE não dispara os gatilhos append-only (que barram UPDATE/DELETE de
 * linha); por isso este é o ÚNICO caminho previsto para apagar histórico.
 */
import type pg from 'pg'
import type { ArmazenamentoArquivos } from '../infra/armazenamento'

export const FRASE_CONFIRMACAO = 'APAGAR TUDO'

/** Dados carregados e tudo o que deriva deles. */
export const TABELAS_APAGADAS = [
  'alerta',
  'arquivo',
  'arquivo_evento',
  'arquivo_versao',
  'ata',
  'auditoria',
  'checklist_analise',
  'classificacao_semanal',
  'classificacao_semanal_substituida',
  'cliente',
  'cliente_documento',
  'comite',
  'configuracao_alerta',
  'evento_historico',
  'evento_iasr',
  'foto_cliente',
  'foto_execucao',
  'foto_mapa',
  'gerente',
  'grupo_economico',
  'importacao',
  'integracao_execucao',
  'juridico',
  'mapa_cliente',
  'mapa_config_cliente',
  'mapa_copia',
  'mapa_envio',
  'movimento_conta_mensal',
  'plano_acao',
  'plataforma',
  'registro_iasr',
  'regra_classificacao',
  'restritivo_semanal',
  'saida_de_risco',
  'snapshot_semanal',
  'snapshot_semanal_substituido',
] as const

/** Linha única de configuração: apagadas e recriadas com o padrão. */
export const TABELAS_REINICIADAS = ['foto_agendamento', 'mapa_agendamento'] as const

/** Não são tocadas. */
export const TABELAS_MANTIDAS = ['usuario', 'carteira', 'migracao_aplicada'] as const

export interface ResultadoZerar {
  linhas: Record<string, number>
  totalLinhas: number
  arquivos: { chaves: number; versoes: number }
  usuariosMantidos: number
}

export class ServicoZerarDados {
  constructor(
    private readonly pool: pg.Pool,
    private readonly armazenamento: ArmazenamentoArquivos,
  ) {}

  /** Toda tabela do esquema precisa estar numa das três listas. */
  async conferirClassificacao(cliente: pg.PoolClient | pg.Pool = this.pool): Promise<void> {
    const { rows } = await cliente.query<{ tabela: string }>(
      `SELECT table_name AS tabela FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    )
    const conhecidas = new Set<string>([...TABELAS_APAGADAS, ...TABELAS_REINICIADAS, ...TABELAS_MANTIDAS])
    const sobrando = rows.map((r) => r.tabela).filter((t) => !conhecidas.has(t))
    if (sobrando.length > 0) throw new Error(`Tabela(s) sem classificação na limpeza: ${sobrando.sort().join(', ')}. Nada foi apagado.`)
    const existentes = new Set(rows.map((r) => r.tabela))
    const faltando = [...TABELAS_APAGADAS, ...TABELAS_REINICIADAS].filter((t) => !existentes.has(t))
    if (faltando.length > 0) throw new Error(`Tabela(s) esperada(s) não existe(m): ${faltando.join(', ')}. Rode as migrações antes. Nada foi apagado.`)
  }

  private async contar(cliente: pg.PoolClient | pg.Pool): Promise<Record<string, number>> {
    const linhas: Record<string, number> = {}
    for (const t of TABELAS_APAGADAS) {
      const { rows } = await cliente.query<{ n: string }>(`SELECT count(*) AS n FROM ${t}`)
      linhas[t] = Number(rows[0]!.n)
    }
    return linhas
  }

  private async usuarios(cliente: pg.PoolClient | pg.Pool): Promise<number> {
    const { rows } = await cliente.query<{ n: string }>('SELECT count(*) AS n FROM usuario')
    return Number(rows[0]!.n)
  }

  /** Manifesto ANTES de apagar (regra dos roteiros destrutivos): cada objeto
   * do MinIO (chave gerada pelo sistema, sem dado pessoal) e as contagens. */
  async manifesto(escrever: (linha: string) => void): Promise<ResultadoZerar> {
    const r = await this.simular()
    escrever(`# manifesto da limpeza total — ${new Date().toISOString()}`)
    for (const [t, n] of Object.entries(r.linhas)) escrever(`tabela\t${t}\t${n}`)
    await this.armazenamento.esvaziarBucket(true, (chave, versao) => escrever(`objeto\t${chave}\t${versao ?? '-'}`))
    escrever(`total\tlinhas=${r.totalLinhas}\tobjetos=${r.arquivos.chaves}\tversoes=${r.arquivos.versoes}\tusuarios_mantidos=${r.usuariosMantidos}`)
    return r
  }

  /** O que seria apagado — não altera nada. */
  async simular(): Promise<ResultadoZerar> {
    await this.conferirClassificacao()
    const linhas = await this.contar(this.pool)
    return {
      linhas,
      totalLinhas: Object.values(linhas).reduce((a, b) => a + b, 0),
      arquivos: await this.armazenamento.esvaziarBucket(true),
      usuariosMantidos: await this.usuarios(this.pool),
    }
  }

  /**
   * Apaga. Banco primeiro (uma transação); depois o MinIO. Se o MinIO falhar,
   * o banco já está limpo e os objetos ficam órfãos: rodar de novo termina
   * (o banco vazio é apagado de novo sem efeito).
   */
  async zerar(p: { confirmacao: string; executadoPor: string }): Promise<ResultadoZerar> {
    if (p.confirmacao !== FRASE_CONFIRMACAO) throw new Error(`Confirmação incorreta: digite exatamente "${FRASE_CONFIRMACAO}". Nada foi apagado.`)
    const cliente = await this.pool.connect()
    let linhas: Record<string, number>
    let usuariosMantidos: number
    try {
      await cliente.query('BEGIN')
      await cliente.query(`SET LOCAL lock_timeout = '10s'`)
      await this.conferirClassificacao(cliente)
      const { rows: emCurso } = await cliente.query(`SELECT 1 FROM foto_execucao WHERE status = 'EXECUTANDO' LIMIT 1`)
      if (emCurso.length > 0) throw new Error('Há uma foto do Bitfin em execução: pare a API (docker compose stop api) e rode de novo. Nada foi apagado.')
      linhas = await this.contar(cliente)
      usuariosMantidos = await this.usuarios(cliente)
      await cliente.query(`TRUNCATE TABLE ${[...TABELAS_APAGADAS, ...TABELAS_REINICIADAS].join(', ')} RESTART IDENTITY`)
      await cliente.query('INSERT INTO foto_agendamento (id) VALUES (1)')
      await cliente.query('INSERT INTO mapa_agendamento (id) VALUES (1)')
      const total = Object.values(linhas).reduce((a, b) => a + b, 0)
      // Primeiro registro da nova trilha: o que foi apagado, por quem e quando.
      await cliente.query(
        `INSERT INTO auditoria (acao, resultado, ator_email, recurso_tipo, motivo, detalhes)
         VALUES ('dados.zerados', 'sucesso', $1, 'base', $2, $3::jsonb)`,
        [
          p.executadoPor,
          'Limpeza total: dados de teste apagados; a partir de agora os dados vêm do Bitfin (ADR-018).',
          JSON.stringify({ linhasApagadas: linhas, totalLinhas: total, usuariosMantidos, mantidas: TABELAS_MANTIDAS }),
        ],
      )
      await cliente.query('COMMIT')
    } catch (erro) {
      await cliente.query('ROLLBACK').catch(() => {})
      throw erro
    } finally {
      cliente.release()
    }
    const arquivos = await this.armazenamento.esvaziarBucket(false)
    await this.pool.query(
      `INSERT INTO auditoria (acao, resultado, ator_email, recurso_tipo, detalhes) VALUES ('arquivos.zerados', 'sucesso', $1, 'minio', $2::jsonb)`,
      [p.executadoPor, JSON.stringify(arquivos)],
    )
    return { linhas, totalLinhas: Object.values(linhas).reduce((a, b) => a + b, 0), arquivos, usuariosMantidos }
  }
}
