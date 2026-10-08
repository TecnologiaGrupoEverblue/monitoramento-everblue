/**
 * Alerta de indisponibilidade da Intranet (1.1.4).
 *
 * O login e a revalidação das sessões dependem da chamada assinada ao /me da
 * Intranet (fail-closed). Quando ela falha — rede, certificado, assinatura,
 * Intranet fora do ar — ninguém entra, e antes só se descobria quando alguém
 * tentava. O monitor:
 *   - acompanha TODA consulta real à Intranet (login e revalidação);
 *   - faz uma verificação periódica com identidade sintética (a mesma do
 *     `cli testar-intranet`): resposta "pessoa não liberada" prova que a
 *     Intranet e a assinatura estão funcionando;
 *   - na MUDANÇA de estado, registra log de erro/retomada e um evento de
 *     auditoria (histórico de quando caiu e quando voltou);
 *   - expõe o estado em /api/health/intranet (200 ok / 503 indisponível) para
 *     a tela de login, o aviso no sistema e qualquer ferramenta de monitoração.
 * O motivo técnico fica no log e na auditoria, não na resposta pública.
 */
import type { AuditoriaRepositorio } from '../repositorios/auditoriaRepositorio'
import type { ClienteIntranet, ResultadoConsultaIntranet } from './intranet'

export type SituacaoIntranet = 'OK' | 'INDISPONIVEL' | 'NAO_CONFIGURADA' | 'DESCONHECIDA'

export interface EstadoIntranet {
  situacao: SituacaoIntranet
  /** Desde quando está na situação atual (ISO). */
  desde: string | null
  /** Última consulta (real ou periódica) à Intranet (ISO). */
  verificadoEm: string | null
  /** Motivo técnico — só para log, auditoria e administradores. */
  motivo: string | null
}

export type AvisoMudanca = (estado: EstadoIntranet, anterior: SituacaoIntranet) => void

/** Identidade que não existe no cadastro: a Intranet responde 403 SYSTEM_ACCESS_DENIED. */
const OID_SINTETICO = '00000000-0000-4000-8000-000000000001'

export class MonitorIntranet {
  private estado: EstadoIntranet
  private timer: NodeJS.Timeout | null = null
  private readonly avisos: AvisoMudanca[] = []

  constructor(
    private readonly intranet: ClienteIntranet,
    private readonly auditoria: Pick<AuditoriaRepositorio, 'registrar'> | null,
    private readonly relogio: () => Date = () => new Date(),
  ) {
    this.estado = intranet.ativo
      ? { situacao: 'DESCONHECIDA', desde: null, verificadoEm: null, motivo: null }
      : { situacao: 'NAO_CONFIGURADA', desde: null, verificadoEm: null, motivo: null }
    intranet.observar((r) => this.registrar(r))
  }

  atual(): EstadoIntranet {
    return { ...this.estado }
  }

  aoMudar(fn: AvisoMudanca): void {
    this.avisos.push(fn)
  }

  /** Uma verificação agora (também usada pela rotina periódica). */
  async verificar(): Promise<EstadoIntranet> {
    if (!this.intranet.ativo) return this.atual()
    // O resultado chega pelo observador do cliente; aqui só se engole o erro.
    await this.intranet.validarAcesso(OID_SINTETICO).catch(() => undefined)
    return this.atual()
  }

  iniciar(intervaloMs: number): void {
    if (!this.intranet.ativo || intervaloMs <= 0 || this.timer) return
    void this.verificar()
    this.timer = setInterval(() => void this.verificar(), intervaloMs)
    this.timer.unref() // não segura o encerramento do processo
  }

  parar(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private registrar(r: ResultadoConsultaIntranet) {
    const agora = this.relogio().toISOString()
    const nova: SituacaoIntranet = r.ok ? 'OK' : 'INDISPONIVEL'
    const anterior = this.estado.situacao
    this.estado = {
      situacao: nova,
      desde: nova === anterior ? this.estado.desde : agora,
      verificadoEm: agora,
      motivo: r.ok ? null : r.motivo,
    }
    // Alerta só na MUDANÇA (e na primeira falha após subir), nunca a cada consulta.
    const mudou = nova !== anterior && !(anterior === 'DESCONHECIDA' && nova === 'OK')
    if (!mudou) return
    const estado = this.atual()
    for (const fn of this.avisos) {
      try {
        fn(estado, anterior)
      } catch {
        // aviso nunca derruba a validação
      }
    }
    void this.auditoria
      ?.registrar({
        acao: nova === 'OK' ? 'intranet.restabelecida' : 'intranet.indisponivel',
        resultado: nova === 'OK' ? 'sucesso' : 'falha',
        recursoTipo: 'integracao',
        recursoId: 'intranet',
        motivo: estado.motivo,
        detalhes: { anterior, desde: estado.desde },
      })
      .catch(() => undefined)
  }
}
