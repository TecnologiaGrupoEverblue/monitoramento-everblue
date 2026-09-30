/**
 * Metadados, versões e trilha do ciclo de vida dos arquivos guardados no
 * MinIO. O conteúdo fica no bucket; aqui fica tudo o que o descreve.
 */
import type {
  ArquivoResumo,
  EventoArquivo,
  FiltroArquivos,
  FinalidadeArquivo,
  PaginaArquivos,
  SituacaoArquivo,
  TotaisArquivos,
  VersaoArquivo,
} from '@monitoramento/dominio'
import { FINALIDADES_ARQUIVO, SITUACOES_ARQUIVO } from '@monitoramento/dominio'
import { linhaParaEntidade, linhasParaEntidades, type Executor } from '../infra/banco'

export interface MetadadosArquivo {
  id: string
  finalidade: FinalidadeArquivo
  categoria: string
  chaveObjeto: string
  idVersaoMinio?: string | null
  nomeOriginal: string
  mime: string
  tamanhoBytes: number
  sha256: string
  criadoPor: string | null
  descricao?: string | null
  tags?: Record<string, string>
  recursoTipo?: string | null
  recursoId?: string | null
  arquivoOrigemId?: string | null
  retencaoAte?: string | null
}

export interface NovaVersao {
  arquivoId: string
  numero: number
  chaveObjeto: string
  idVersaoMinio: string | null
  nomeOriginal: string
  mime: string
  tamanhoBytes: number
  sha256: string
  comentario: string | null
  criadoPor: string | null
}

/** Registro completo (inclui a chave do objeto — nunca sai pela API). */
export interface ArquivoCompleto extends ArquivoResumo {
  chaveObjeto: string
}

export interface VersaoCompleta extends VersaoArquivo {
  chaveObjeto: string
  idVersaoMinio: string | null
}

const COLUNAS = `a.id, a.finalidade, a.categoria, a.situacao, a.nome_original, a.mime, a.tamanho_bytes, a.sha256,
  a.versao_atual, a.descricao, a.tags, a.recurso_tipo, a.recurso_id, a.arquivo_origem_id, a.retencao_ate,
  a.criado_por, u.nome AS criado_por_nome, a.criado_em, a.atualizado_em, a.excluido_em, a.motivo_exclusao, a.chave_objeto`

export class ArquivoRepositorio {
  constructor(private readonly db: Executor) {}

  /** Novo arquivo + versão 1 + evento de envio. Use dentro de transação. */
  async registrar(m: MetadadosArquivo, executor: Executor = this.db): Promise<void> {
    await executor.query(
      `INSERT INTO arquivo (id, finalidade, categoria, chave_objeto, nome_original, mime, tamanho_bytes, sha256, criado_por,
                            descricao, tags, recurso_tipo, recurso_id, arquivo_origem_id, retencao_ate, atualizado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15, $9)`,
      [
        m.id,
        m.finalidade,
        m.categoria,
        m.chaveObjeto,
        m.nomeOriginal,
        m.mime,
        m.tamanhoBytes,
        m.sha256,
        m.criadoPor,
        m.descricao ?? null,
        JSON.stringify(m.tags ?? {}),
        m.recursoTipo ?? null,
        m.recursoId ?? null,
        m.arquivoOrigemId ?? null,
        m.retencaoAte ?? null,
      ],
    )
    await this.inserirVersao(
      { arquivoId: m.id, numero: 1, chaveObjeto: m.chaveObjeto, idVersaoMinio: m.idVersaoMinio ?? null, nomeOriginal: m.nomeOriginal, mime: m.mime, tamanhoBytes: m.tamanhoBytes, sha256: m.sha256, comentario: null, criadoPor: m.criadoPor },
      executor,
    )
    await this.registrarEvento(m.id, 'enviado', 1, m.criadoPor, { finalidade: m.finalidade, categoria: m.categoria, tamanhoBytes: m.tamanhoBytes }, executor)
  }

  async inserirVersao(v: NovaVersao, executor: Executor = this.db): Promise<void> {
    await executor.query(
      `INSERT INTO arquivo_versao (arquivo_id, numero, chave_objeto, id_versao_minio, nome_original, mime, tamanho_bytes, sha256, comentario, criado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [v.arquivoId, v.numero, v.chaveObjeto, v.idVersaoMinio, v.nomeOriginal, v.mime, v.tamanhoBytes, v.sha256, v.comentario, v.criadoPor],
    )
  }

  /** Aponta o arquivo para a versão informada (nova ou restaurada). */
  async definirVersaoAtual(arquivoId: string, v: Pick<NovaVersao, 'numero' | 'chaveObjeto' | 'nomeOriginal' | 'mime' | 'tamanhoBytes' | 'sha256'>, ator: string | null, executor: Executor = this.db): Promise<void> {
    await executor.query(
      `UPDATE arquivo SET versao_atual = $2, chave_objeto = $3, nome_original = $4, mime = $5, tamanho_bytes = $6, sha256 = $7,
                          atualizado_em = now(), atualizado_por = $8
        WHERE id = $1`,
      [arquivoId, v.numero, v.chaveObjeto, v.nomeOriginal, v.mime, v.tamanhoBytes, v.sha256, ator],
    )
  }

  async registrarEvento(arquivoId: string, acao: string, versao: number | null, atorId: string | null, detalhes: Record<string, unknown> = {}, executor: Executor = this.db): Promise<void> {
    await executor.query(
      `INSERT INTO arquivo_evento (arquivo_id, acao, versao, ator_id, ator_nome, detalhes)
       VALUES ($1, $2, $3, $4, (SELECT nome FROM usuario WHERE id = $4), $5::jsonb)`,
      [arquivoId, acao, versao, atorId, JSON.stringify(detalhes)],
    )
  }

  async porId(id: string, executor: Executor = this.db, bloquear = false): Promise<ArquivoCompleto | null> {
    const { rows } = await executor.query(
      `SELECT ${COLUNAS} FROM arquivo a LEFT JOIN usuario u ON u.id = a.criado_por WHERE a.id = $1 ${bloquear ? 'FOR UPDATE OF a' : ''}`,
      [id],
    )
    return rows[0] ? linhaParaEntidade<ArquivoCompleto>(rows[0]) : null
  }

  async listar(f: FiltroArquivos): Promise<PaginaArquivos> {
    const condicoes: string[] = []
    const valores: unknown[] = []
    const add = (sql: string, valor: unknown) => {
      valores.push(valor)
      condicoes.push(sql.replaceAll('?', `$${valores.length}`))
    }
    if (f.finalidade) add('a.finalidade = ?', f.finalidade)
    // Sem filtro de situação, a lista mostra o que está em uso (não excluídos).
    if (f.situacao) add('a.situacao = ?', f.situacao)
    else condicoes.push(`a.situacao IN ('ATIVO', 'ARQUIVADO')`)
    if (f.categoria) add('a.categoria = ?', f.categoria)
    if (f.recursoTipo) add('a.recurso_tipo = ?', f.recursoTipo)
    if (f.recursoId) add('a.recurso_id = ?', f.recursoId)
    if (f.busca) add(`(lower(a.nome_original) LIKE ? OR lower(coalesce(a.descricao, '')) LIKE ?)`, `%${f.busca.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
    const onde = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : ''
    const porPagina = Math.min(Math.max(f.porPagina ?? 25, 1), 100)
    const pagina = Math.max(f.pagina ?? 1, 1)

    const [{ rows }, { rows: total }] = await Promise.all([
      this.db.query(
        `SELECT ${COLUNAS} FROM arquivo a LEFT JOIN usuario u ON u.id = a.criado_por ${onde}
          ORDER BY a.criado_em DESC, a.id LIMIT ${porPagina} OFFSET ${(pagina - 1) * porPagina}`,
        valores,
      ),
      this.db.query(`SELECT count(*)::int AS n FROM arquivo a ${onde}`, valores),
    ])
    const itens = linhasParaEntidades<ArquivoCompleto>(rows).map(semChave)
    return { itens, total: Number(total[0]?.n ?? 0), pagina, porPagina }
  }

  async versoes(arquivoId: string): Promise<VersaoCompleta[]> {
    const { rows } = await this.db.query(
      `SELECT v.numero, v.nome_original, v.mime, v.tamanho_bytes, v.sha256, v.comentario, u.nome AS criado_por_nome, v.criado_em,
              v.chave_objeto, v.id_versao_minio
         FROM arquivo_versao v LEFT JOIN usuario u ON u.id = v.criado_por
        WHERE v.arquivo_id = $1 ORDER BY v.numero DESC`,
      [arquivoId],
    )
    return linhasParaEntidades<VersaoCompleta>(rows)
  }

  async eventos(arquivoId: string): Promise<EventoArquivo[]> {
    const { rows } = await this.db.query(
      `SELECT id, acao, versao, ator_nome, detalhes, criado_em FROM arquivo_evento WHERE arquivo_id = $1 ORDER BY criado_em DESC, id LIMIT 500`,
      [arquivoId],
    )
    return linhasParaEntidades<EventoArquivo>(rows)
  }

  async alterarSituacao(
    arquivoId: string,
    situacao: SituacaoArquivo,
    ator: string | null,
    motivo: string | null,
    executor: Executor = this.db,
  ): Promise<void> {
    const exclusao = situacao === 'EXCLUIDO' || situacao === 'EXPURGADO'
    await executor.query(
      `UPDATE arquivo SET situacao = $2, atualizado_em = now(), atualizado_por = $3,
              excluido_em = CASE WHEN $4 THEN coalesce(excluido_em, now()) ELSE NULL END,
              excluido_por = CASE WHEN $4 THEN coalesce(excluido_por, $3) ELSE NULL END,
              motivo_exclusao = CASE WHEN $4 THEN coalesce($5, motivo_exclusao) ELSE NULL END
        WHERE id = $1`,
      [arquivoId, situacao, ator, exclusao, motivo],
    )
  }

  async atualizarMetadados(
    arquivoId: string,
    dados: { descricao?: string | null; categoria?: string; tags?: Record<string, string>; retencaoAte?: string | null; recursoTipo?: string | null; recursoId?: string | null },
    ator: string | null,
    executor: Executor = this.db,
  ): Promise<void> {
    const sets: string[] = []
    const valores: unknown[] = [arquivoId]
    const set = (coluna: string, valor: unknown, json = false) => {
      valores.push(json ? JSON.stringify(valor) : valor)
      sets.push(`${coluna} = $${valores.length}${json ? '::jsonb' : ''}`)
    }
    if (dados.descricao !== undefined) set('descricao', dados.descricao)
    if (dados.categoria !== undefined) set('categoria', dados.categoria)
    if (dados.tags !== undefined) set('tags', dados.tags, true)
    if (dados.retencaoAte !== undefined) set('retencao_ate', dados.retencaoAte)
    if (dados.recursoTipo !== undefined) set('recurso_tipo', dados.recursoTipo)
    if (dados.recursoId !== undefined) set('recurso_id', dados.recursoId)
    if (sets.length === 0) return
    valores.push(ator)
    await executor.query(`UPDATE arquivo SET ${sets.join(', ')}, atualizado_em = now(), atualizado_por = $${valores.length} WHERE id = $1`, valores)
  }

  async categorias(): Promise<string[]> {
    const { rows } = await this.db.query(`SELECT DISTINCT categoria COLLATE "C" AS v FROM arquivo ORDER BY 1`)
    return rows.map((r) => String(r.v))
  }

  async totais(): Promise<TotaisArquivos> {
    const { rows } = await this.db.query(
      `SELECT finalidade, situacao, count(*)::int AS quantidade, coalesce(sum(tamanho_bytes), 0)::bigint AS bytes FROM arquivo GROUP BY 1, 2`,
    )
    const porFinalidade = Object.fromEntries(FINALIDADES_ARQUIVO.map((f) => [f, { quantidade: 0, bytes: 0 }])) as TotaisArquivos['porFinalidade']
    const porSituacao = Object.fromEntries(SITUACOES_ARQUIVO.map((s) => [s, 0])) as TotaisArquivos['porSituacao']
    for (const r of rows) {
      porSituacao[r.situacao as SituacaoArquivo] += Number(r.quantidade)
      if (r.situacao === 'ATIVO' || r.situacao === 'ARQUIVADO') {
        porFinalidade[r.finalidade as FinalidadeArquivo].quantidade += Number(r.quantidade)
        porFinalidade[r.finalidade as FinalidadeArquivo].bytes += Number(r.bytes)
      }
    }
    return { porFinalidade, porSituacao }
  }
}

export function semChave(a: ArquivoCompleto): ArquivoResumo {
  const { chaveObjeto: _chave, ...resto } = a
  return resto
}
