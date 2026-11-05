/**
 * Expurgo das fotos de TESTE do Bitfin (ADR-021, migração 0012).
 *
 * Permanente (nunca entra aqui): foto que gravou a posição do comitê ou cuja
 * base gerou Mapa de Garantias enviado. Teste: qualquer outra foto, apagada
 * depois de RETENCAO_FOTO_TESTE_DIAS (mínimo 90, piso também no banco).
 *
 * Por foto, nesta ordem: (1) leitura bruta expurgada do MinIO pela Central de
 * Arquivos (metadados e trilha do arquivo ficam); (2) numa transação curta com
 * a sessão de expurgo ligada: a foto seguinte passa a apontar para a anterior
 * mantida, e saem detalhe por cliente, base do mapa e a execução. Lote
 * limitado por rodada; auditoria com os ids (sem dado de cliente).
 */
import type { Banco } from '../infra/banco'
import type { AuditoriaRepositorio } from '../repositorios/auditoriaRepositorio'
import type { ServicoArquivos } from './servicoArquivos'
import { dataLocal, USUARIO_AGENDADOR } from './servicoFotoBitfin'

export interface ResultadoExpurgo {
  fotos: number
  clientes: number
  mapas: number
  arquivos: number
  falhas: number
  ids: string[]
}

export class ServicoExpurgoFotos {
  private ultimoDia: string | null = null

  constructor(
    private readonly banco: Banco,
    private readonly arquivos: Pick<ServicoArquivos, 'expurgar'>,
    private readonly auditoria: AuditoriaRepositorio,
    private readonly retencaoDias: number,
    private readonly log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void } = { info: () => {}, error: () => {} },
    private readonly lote = 200,
  ) {
    if (retencaoDias < 90) throw new Error('Retenção das fotos de teste não pode ser menor que 90 dias.')
  }

  /** Uma vez por dia (horário de Brasília), a partir das 03:00. */
  async talvezExecutar(agora: Date = new Date()): Promise<ResultadoExpurgo | null> {
    const dia = dataLocal(agora)
    const hora = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }).format(agora))
    if (this.ultimoDia === dia || hora < 3) return null
    this.ultimoDia = dia
    return this.executar()
  }

  async executar(): Promise<ResultadoExpurgo> {
    const r: ResultadoExpurgo = { fotos: 0, clientes: 0, mapas: 0, arquivos: 0, falhas: 0, ids: [] }
    const { rows } = await this.banco.pool.query<{ id: string; arquivo_id: string | null; arquivo_situacao: string | null }>(
      `SELECT f.id, f.arquivo_id, a.situacao AS arquivo_situacao
         FROM foto_execucao f
         LEFT JOIN arquivo a ON a.id = f.arquivo_id
        WHERE f.status <> 'EXECUTANDO'
          AND f.iniciado_em < now() - make_interval(days => $1::int)
          AND NOT foto_permanente(f.id)
        ORDER BY f.iniciado_em
        LIMIT $2`,
      [this.retencaoDias, this.lote],
    )
    for (const f of rows) {
      try {
        if (f.arquivo_id && f.arquivo_situacao !== 'EXPURGADO') {
          await this.arquivos.expurgar(f.arquivo_id, `Retenção: foto de teste do Bitfin com mais de ${this.retencaoDias} dias (ADR-021).`, USUARIO_AGENDADOR)
          r.arquivos += 1
        }
        const apagados = await this.banco.transacao(async (tx) => {
          await tx.query(`SET LOCAL monitoramento.expurgo_foto = 'on'`)
          await tx.query(
            `UPDATE foto_execucao SET foto_anterior_id = (SELECT foto_anterior_id FROM foto_execucao WHERE id = $1) WHERE foto_anterior_id = $1`,
            [f.id],
          )
          const c = await tx.query('DELETE FROM foto_cliente WHERE foto_id = $1', [f.id])
          const m = await tx.query('DELETE FROM foto_mapa WHERE foto_id = $1', [f.id])
          await tx.query('DELETE FROM foto_execucao WHERE id = $1', [f.id])
          return { clientes: c.rowCount ?? 0, mapas: m.rowCount ?? 0 }
        })
        r.fotos += 1
        r.clientes += apagados.clientes
        r.mapas += apagados.mapas
        r.ids.push(f.id)
      } catch (e) {
        r.falhas += 1
        this.log.error({ err: e, fotoId: f.id }, 'foto_expurgo_falhou')
      }
    }
    if (r.fotos > 0 || r.falhas > 0) {
      await this.auditoria.registrar({
        acao: 'foto.expurgo',
        resultado: r.falhas > 0 ? 'falha' : 'sucesso',
        atorId: USUARIO_AGENDADOR.id,
        atorEmail: USUARIO_AGENDADOR.email,
        recursoTipo: 'foto_bitfin',
        motivo: `Retenção das fotos de teste: ${this.retencaoDias} dias (ADR-021).`,
        detalhes: { ...r },
      })
      this.log.info({ fotos: r.fotos, clientes: r.clientes, mapas: r.mapas, arquivos: r.arquivos, falhas: r.falhas }, 'foto_expurgo_concluido')
    }
    return r
  }
}
