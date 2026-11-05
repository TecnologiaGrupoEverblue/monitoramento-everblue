/** Mapa de Garantias: clientes, cópias, configuração por cliente, base lida
 * em cada foto e registro de envios. */
import type { ClienteMapa, ConfigMapaCliente, CopiaMapa, DadosMapaBitfin, EnvioMapa } from '@monitoramento/dominio'
import type { Executor } from '../infra/banco'

export type { ClienteMapa, CopiaMapa, EnvioMapa }

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v))

export class MapaRepositorio {
  constructor(private readonly db: Executor) {}

  async clientes(): Promise<ClienteMapa[]> {
    const { rows } = await this.db.query(
      `SELECT m.documento, m.nome, u.nome AS incluido_por, m.incluido_em FROM mapa_cliente m LEFT JOIN usuario u ON u.id = m.incluido_por WHERE m.ativo ORDER BY m.nome NULLS LAST, m.documento`,
    )
    return rows.map((l) => ({ documento: l.documento, nome: l.nome, incluidoPor: l.incluido_por, incluidoEm: iso(l.incluido_em) }))
  }

  /** Inclui (ou reativa) um cliente pelo documento (só dígitos). */
  async incluirCliente(documento: string, nome: string | null, usuarioId: string): Promise<'INCLUIDO' | 'JA_EXISTIA'> {
    const { rows } = await this.db.query(
      `INSERT INTO mapa_cliente (documento, nome, incluido_por) VALUES ($1, $2, $3)
       ON CONFLICT (documento) DO UPDATE SET ativo = TRUE, nome = COALESCE(EXCLUDED.nome, mapa_cliente.nome), incluido_por = EXCLUDED.incluido_por,
              incluido_em = now(), removido_por = NULL, removido_em = NULL
        WHERE NOT mapa_cliente.ativo
       RETURNING documento`,
      [documento, nome, usuarioId],
    )
    return rows.length > 0 ? 'INCLUIDO' : 'JA_EXISTIA'
  }

  async removerCliente(documento: string, usuarioId: string): Promise<boolean> {
    const { rowCount } = await this.db.query(`UPDATE mapa_cliente SET ativo = FALSE, removido_por = $2, removido_em = now() WHERE documento = $1 AND ativo`, [documento, usuarioId])
    return (rowCount ?? 0) > 0
  }

  async atualizarNome(documento: string, nome: string): Promise<void> {
    await this.db.query(`UPDATE mapa_cliente SET nome = $2 WHERE documento = $1 AND (nome IS DISTINCT FROM $2)`, [documento, nome])
  }

  async copias(): Promise<CopiaMapa[]> {
    const { rows } = await this.db.query(`SELECT c.email, u.nome AS incluido_por, c.incluido_em FROM mapa_copia c LEFT JOIN usuario u ON u.id = c.incluido_por WHERE c.ativo ORDER BY c.email`)
    return rows.map((l) => ({ email: l.email, incluidoPor: l.incluido_por, incluidoEm: iso(l.incluido_em) }))
  }

  async incluirCopia(email: string, usuarioId: string): Promise<'INCLUIDO' | 'JA_EXISTIA'> {
    const { rows } = await this.db.query(
      `INSERT INTO mapa_copia (email, incluido_por) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET ativo = TRUE, incluido_por = EXCLUDED.incluido_por, incluido_em = now(), removido_por = NULL, removido_em = NULL
        WHERE NOT mapa_copia.ativo
       RETURNING email`,
      [email, usuarioId],
    )
    return rows.length > 0 ? 'INCLUIDO' : 'JA_EXISTIA'
  }

  async removerCopia(email: string, usuarioId: string): Promise<boolean> {
    const { rowCount } = await this.db.query(`UPDATE mapa_copia SET ativo = FALSE, removido_por = $2, removido_em = now() WHERE email = $1 AND ativo`, [email, usuarioId])
    return (rowCount ?? 0) > 0
  }

  async configs(): Promise<Map<string, ConfigMapaCliente>> {
    const { rows } = await this.db.query(`SELECT documento, contas_graficas, deducoes, concentracao, restricao FROM mapa_config_cliente`)
    return new Map(
      rows.map((l) => [
        String(l.documento),
        { contasGraficas: l.contas_graficas ?? null, deducoes: l.deducoes ?? [], concentracaoExcedida: l.concentracao ?? null, sacadoComRestricao: l.restricao ?? null },
      ]),
    )
  }

  async salvarConfig(documento: string, c: ConfigMapaCliente, usuarioId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO mapa_config_cliente (documento, contas_graficas, deducoes, concentracao, restricao, atualizado_por)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6)
       ON CONFLICT (documento) DO UPDATE SET contas_graficas = EXCLUDED.contas_graficas, deducoes = EXCLUDED.deducoes, concentracao = EXCLUDED.concentracao,
              restricao = EXCLUDED.restricao, atualizado_por = EXCLUDED.atualizado_por, atualizado_em = now()`,
      [documento, c.contasGraficas, JSON.stringify(c.deducoes), JSON.stringify(c.concentracaoExcedida), JSON.stringify(c.sacadoComRestricao), usuarioId],
    )
  }

  async gravarFotoMapa(fotoId: string, documentos: string[], dados: DadosMapaBitfin): Promise<void> {
    await this.db.query(`INSERT INTO foto_mapa (foto_id, documentos, dados) VALUES ($1, $2, $3::jsonb)`, [fotoId, documentos, JSON.stringify(dados)])
  }

  /** Base do mapa de uma foto (ou da última foto que leu o mapa). */
  async fotoMapa(fotoId?: string): Promise<{ fotoId: string; tiradaEm: string; apuradoEm: string | null; documentos: string[]; dados: DadosMapaBitfin } | null> {
    const { rows } = await this.db.query(
      `SELECT fm.foto_id, f.iniciado_em, f.bitfin_apurado_em, fm.documentos, fm.dados
         FROM foto_mapa fm JOIN foto_execucao f ON f.id = fm.foto_id
        WHERE ($1::uuid IS NULL OR fm.foto_id = $1::uuid)
        ORDER BY f.iniciado_em DESC LIMIT 1`,
      [fotoId ?? null],
    )
    const l = rows[0]
    if (!l) return null
    return { fotoId: String(l.foto_id), tiradaEm: iso(l.iniciado_em), apuradoEm: l.bitfin_apurado_em ? iso(l.bitfin_apurado_em) : null, documentos: l.documentos, dados: l.dados }
  }

  async registrarEnvio(e: Omit<EnvioMapa, 'id' | 'em' | 'solicitadoPorNome'> & { solicitadoPor: string }): Promise<void> {
    await this.db.query(
      `INSERT INTO mapa_envio (lote_id, foto_id, origem, solicitado_por, destinatario, papeis, clientes, status, mensagem, arquivo_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [e.loteId, e.fotoId, e.origem, e.solicitadoPor, e.destinatario, e.papeis, e.clientes, e.status, e.mensagem, e.arquivoId],
    )
  }

  async envios(limite = 100): Promise<EnvioMapa[]> {
    const { rows } = await this.db.query(
      `SELECT e.*, u.nome AS solicitado_por_nome FROM mapa_envio e LEFT JOIN usuario u ON u.id = e.solicitado_por ORDER BY e.em DESC LIMIT $1`,
      [Math.min(Math.max(limite, 1), 500)],
    )
    return rows.map((l) => ({
      id: l.id,
      loteId: l.lote_id,
      fotoId: l.foto_id,
      origem: l.origem,
      solicitadoPorNome: l.solicitado_por_nome,
      destinatario: l.destinatario,
      papeis: l.papeis,
      clientes: l.clientes,
      status: l.status,
      mensagem: l.mensagem,
      arquivoId: l.arquivo_id,
      em: iso(l.em),
    }))
  }

  async envioDiarioAtivo(): Promise<boolean> {
    const { rows } = await this.db.query(`SELECT ativo FROM mapa_agendamento WHERE id = 1`)
    return Boolean(rows[0]?.ativo)
  }

  async definirEnvioDiario(ativo: boolean, usuarioId: string): Promise<void> {
    await this.db.query(`UPDATE mapa_agendamento SET ativo = $1, atualizado_por = $2, atualizado_em = now() WHERE id = 1`, [ativo, usuarioId])
  }

  /** Reserva o envio automático do dia (atômico: uma vez por dia). */
  async reservarEnvioDoDia(hoje: string): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `UPDATE mapa_agendamento SET ultimo_envio_dia = $1::date WHERE id = 1 AND ativo AND (ultimo_envio_dia IS NULL OR ultimo_envio_dia < $1::date)`,
      [hoje],
    )
    return (rowCount ?? 0) > 0
  }
}
