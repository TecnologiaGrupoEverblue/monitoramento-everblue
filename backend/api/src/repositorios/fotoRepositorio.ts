/**
 * Fotos do Bitfin: execuções (histórico), posição de cada cliente
 * (append-only) e o agendador (linha única).
 */
import type { AgendamentoFoto, DetalheBitfinDoCliente, DetalheClienteFoto, DivergenciaFoto, ExecucaoFoto, LinhaValidada, OrigemFoto, PosicaoSemanalFoto, StatusFoto } from '@monitoramento/dominio'
import type { Executor } from '../infra/banco'

export type { AgendamentoFoto, ExecucaoFoto, OrigemFoto, PosicaoSemanalFoto, StatusFoto }

export interface ClienteFoto {
  fotoId: string
  bitfinClienteId: number
  clienteId: string | null
  documento: string
  nome: string
  status: string
  risco: number
  linha: LinhaValidada
  detalhe: DetalheClienteFoto
}

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v))
const dataIso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v).slice(0, 10)
}

function execucaoDe(l: Record<string, unknown>): ExecucaoFoto {
  return {
    id: String(l.id),
    origem: l.origem as OrigemFoto,
    solicitadoPor: String(l.solicitado_por),
    solicitadoPorNome: (l.solicitado_por_nome as string | null) ?? null,
    iniciadoEm: iso(l.iniciado_em)!,
    concluidoEm: iso(l.concluido_em),
    status: l.status as StatusFoto,
    gravarPosicao: Boolean(l.gravar_posicao),
    semanaRef: dataIso(l.semana_ref),
    posicaoSemanal: (l.posicao_semanal as PosicaoSemanalFoto | null) ?? null,
    importacaoId: (l.importacao_id as string | null) ?? null,
    arquivoId: (l.arquivo_id as string | null) ?? null,
    versaoRegras: String(l.versao_regras),
    bitfinLidoEm: iso(l.bitfin_lido_em),
    bitfinApuradoEm: iso(l.bitfin_apurado_em),
    clientes: l.clientes === null || l.clientes === undefined ? null : Number(l.clientes),
    totais: (l.totais as ExecucaoFoto['totais']) ?? null,
    divergencias: (l.divergencias as DivergenciaFoto[]) ?? [],
    recusas: (l.recusas as string[]) ?? [],
    temposMs: (l.tempos_ms as Record<string, number> | null) ?? null,
    mensagem: (l.mensagem as string | null) ?? null,
    fotoAnteriorId: (l.foto_anterior_id as string | null) ?? null,
  }
}

const SELECT_EXECUCAO = `SELECT f.*, u.nome AS solicitado_por_nome FROM foto_execucao f LEFT JOIN usuario u ON u.id = f.solicitado_por`

export class ErroFotoEmAndamento extends Error {}

export class FotoRepositorio {
  constructor(private readonly db: Executor) {}

  /** Abre a execução. Só uma por vez (índice único parcial no banco). */
  async iniciar(p: { origem: OrigemFoto; solicitadoPor: string; gravarPosicao: boolean; versaoRegras: string }): Promise<string> {
    try {
      const { rows } = await this.db.query(
        `INSERT INTO foto_execucao (origem, solicitado_por, gravar_posicao, versao_regras,
                                    foto_anterior_id)
         VALUES ($1, $2, $3, $4,
                 (SELECT id FROM foto_execucao WHERE status = 'CONCLUIDA' ORDER BY iniciado_em DESC LIMIT 1))
         RETURNING id`,
        [p.origem, p.solicitadoPor, p.gravarPosicao, p.versaoRegras],
      )
      return String(rows[0].id)
    } catch (e) {
      if ((e as { code?: string; constraint?: string }).code === '23505') throw new ErroFotoEmAndamento('Já existe uma foto do Bitfin em andamento.')
      throw e
    }
  }

  async concluir(
    id: string,
    p: {
      status: Exclude<StatusFoto, 'EXECUTANDO'>
      mensagem?: string | null
      semanaRef?: string | null
      posicaoSemanal?: PosicaoSemanalFoto | null
      importacaoId?: string | null
      arquivoId?: string | null
      bitfinLidoEm?: string | null
      bitfinApuradoEm?: string | null
      clientes?: number | null
      totais?: ExecucaoFoto['totais']
      divergencias?: DivergenciaFoto[]
      recusas?: string[]
      temposMs?: Record<string, number> | null
    },
    executor: Executor = this.db,
  ): Promise<void> {
    await executor.query(
      `UPDATE foto_execucao
          SET status = $2, concluido_em = now(), mensagem = $3, semana_ref = $4, posicao_semanal = $5, importacao_id = $6,
              arquivo_id = COALESCE($7, arquivo_id), bitfin_lido_em = $8, bitfin_apurado_em = $9, clientes = $10, totais = $11::jsonb,
              divergencias = $12::jsonb, recusas = $13::jsonb, tempos_ms = $14::jsonb
        WHERE id = $1 AND status = 'EXECUTANDO'`,
      [
        id,
        p.status,
        p.mensagem ?? null,
        p.semanaRef ?? null,
        p.posicaoSemanal ?? null,
        p.importacaoId ?? null,
        p.arquivoId ?? null,
        p.bitfinLidoEm ?? null,
        p.bitfinApuradoEm ?? null,
        p.clientes ?? null,
        JSON.stringify(p.totais ?? null),
        JSON.stringify(p.divergencias ?? []),
        JSON.stringify(p.recusas ?? []),
        JSON.stringify(p.temposMs ?? null),
      ],
    )
  }

  /** Execução que ficou "em andamento" porque o processo parou no meio
   * (reinício, queda): fica registrada como falha e libera a próxima. */
  async encerrarInterrompidas(minutos: number): Promise<number> {
    const { rowCount } = await this.db.query(
      `UPDATE foto_execucao SET status = 'FALHOU', concluido_em = now(),
              mensagem = 'Execução interrompida (o serviço reiniciou durante a foto). Nada foi gravado na posição.'
        WHERE status = 'EXECUTANDO' AND iniciado_em < now() - make_interval(mins => $1)`,
      [minutos],
    )
    return rowCount ?? 0
  }

  async inserirClientes(lista: ClienteFoto[], executor: Executor = this.db): Promise<void> {
    if (lista.length === 0) return
    const valores: unknown[] = []
    const linhas = lista.map((c, i) => {
      const b = i * 9
      valores.push(c.fotoId, c.bitfinClienteId, c.clienteId, c.documento, c.nome, c.status, c.risco, JSON.stringify(c.linha), JSON.stringify(c.detalhe))
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}::jsonb, $${b + 9}::jsonb)`
    })
    await executor.query(
      `INSERT INTO foto_cliente (foto_id, bitfin_cliente_id, cliente_id, documento, nome, status, risco, linha, detalhe) VALUES ${linhas.join(', ')}`,
      valores,
    )
  }

  async listar(limite = 50, antesDe?: string): Promise<ExecucaoFoto[]> {
    const { rows } = await this.db.query(
      `${SELECT_EXECUCAO} WHERE ($2::timestamptz IS NULL OR f.iniciado_em < $2::timestamptz) ORDER BY f.iniciado_em DESC LIMIT $1`,
      [Math.min(Math.max(limite, 1), 200), antesDe ?? null],
    )
    return rows.map(execucaoDe)
  }

  async porId(id: string): Promise<ExecucaoFoto | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null
    const { rows } = await this.db.query(`${SELECT_EXECUCAO} WHERE f.id = $1`, [id])
    return rows[0] ? execucaoDe(rows[0]) : null
  }

  async ultimaConcluida(): Promise<ExecucaoFoto | null> {
    const { rows } = await this.db.query(`${SELECT_EXECUCAO} WHERE f.status = 'CONCLUIDA' ORDER BY f.iniciado_em DESC LIMIT 1`)
    return rows[0] ? execucaoDe(rows[0]) : null
  }

  async clientesDaFoto(fotoId: string): Promise<ClienteFoto[]> {
    const { rows } = await this.db.query(`SELECT * FROM foto_cliente WHERE foto_id = $1 ORDER BY nome`, [fotoId])
    return rows.map((l) => ({
      fotoId: String(l.foto_id),
      bitfinClienteId: Number(l.bitfin_cliente_id),
      clienteId: (l.cliente_id as string | null) ?? null,
      documento: String(l.documento),
      nome: String(l.nome),
      status: String(l.status),
      risco: Number(l.risco),
      linha: l.linha as LinhaValidada,
      detalhe: l.detalhe as DetalheClienteFoto,
    }))
  }

  /** Detalhe do Bitfin de um cliente do Monitoramento. Com `ate` (semana do
   * comitê): a foto que gravou a posição dessa semana; sem ela, a última foto
   * tirada até essa data (semana passada não mostra eventos de depois). Sem
   * `ate`: a última foto concluída que trouxe o cliente. */
  async ultimoDetalheDoCliente(clienteId: string, ate?: string): Promise<DetalheBitfinDoCliente | null> {
    const { rows } = await this.db.query(
      `SELECT fc.foto_id, f.iniciado_em, fc.detalhe, fc.linha
         FROM foto_cliente fc JOIN foto_execucao f ON f.id = fc.foto_id
        WHERE f.status = 'CONCLUIDA'
          AND (fc.cliente_id = $1
               OR fc.documento IN (SELECT documento FROM cliente_documento WHERE cliente_id = $1 UNION SELECT cnpj FROM cliente WHERE id = $1))
          AND ($2::date IS NULL OR f.semana_ref = $2::date OR (f.iniciado_em AT TIME ZONE 'America/Sao_Paulo')::date <= $2::date)
        ORDER BY (f.semana_ref = $2::date AND f.posicao_semanal = 'GRAVADA') DESC NULLS LAST, f.iniciado_em DESC LIMIT 1`,
      [clienteId, ate ?? null],
    )
    const l = rows[0]
    if (!l) return null
    return { fotoId: String(l.foto_id), tiradaEm: iso(l.iniciado_em)!, detalhe: l.detalhe as DetalheClienteFoto, linha: l.linha as LinhaValidada }
  }

  // ------------------------------------------------------------ agendador

  async agendamento(): Promise<AgendamentoFoto> {
    const { rows } = await this.db.query(
      `SELECT a.*, u.nome AS atualizado_por_nome FROM foto_agendamento a LEFT JOIN usuario u ON u.id = a.atualizado_por WHERE a.id = 1`,
    )
    const l = rows[0]
    return {
      ativo: Boolean(l.ativo),
      horario: String(l.horario),
      diasSemana: (l.dias_semana as number[]).map(Number).sort(),
      diaPosicaoSemanal: l.dia_posicao_semanal === null ? null : Number(l.dia_posicao_semanal),
      ultimaExecucaoEm: iso(l.ultima_execucao_em),
      atualizadoPor: (l.atualizado_por as string | null) ?? null,
      atualizadoPorNome: (l.atualizado_por_nome as string | null) ?? null,
      atualizadoEm: iso(l.atualizado_em)!,
    }
  }

  async salvarAgendamento(a: Pick<AgendamentoFoto, 'ativo' | 'horario' | 'diasSemana' | 'diaPosicaoSemanal'>, usuarioId: string): Promise<void> {
    await this.db.query(
      `UPDATE foto_agendamento SET ativo = $1, horario = $2, dias_semana = $3, dia_posicao_semanal = $4, atualizado_por = $5, atualizado_em = now() WHERE id = 1`,
      [a.ativo, a.horario, a.diasSemana, a.diaPosicaoSemanal, usuarioId],
    )
  }

  /** Devolve a reserva do dia quando a foto agendada não chegou a abrir. */
  async liberarExecucaoDoDia(anterior: string | null): Promise<void> {
    await this.db.query(`UPDATE foto_agendamento SET ultima_execucao_em = $1 WHERE id = 1`, [anterior])
  }

  /** Reserva a execução do dia (data local `hoje`, America/Sao_Paulo) de forma
   * atômica: só um processo consegue, mesmo com mais de uma réplica. */
  async reservarExecucaoDoDia(hoje: string): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `UPDATE foto_agendamento SET ultima_execucao_em = now()
        WHERE id = 1 AND ativo
          AND (ultima_execucao_em IS NULL OR (ultima_execucao_em AT TIME ZONE 'America/Sao_Paulo')::date < $1::date)`,
      [hoje],
    )
    return (rowCount ?? 0) > 0
  }
}
