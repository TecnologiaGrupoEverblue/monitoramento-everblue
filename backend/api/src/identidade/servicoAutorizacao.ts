/**
 * A autorização da Intranet vale DURANTE a sessão, não só na porta.
 *
 * Contrato da Intranet (`docs/central-access.md`): chamar /api/access/v1/me
 * no login, na renovação da sessão e periodicamente; uma resposta positiva
 * pode ficar em cache por no máximo cinco minutos.
 *
 * - Negativa DESATIVA a pessoa (corta todas as sessões dela).
 * - Autoridade fora do ar NÃO é autoridade dizendo sim: passados os cinco
 *   minutos sem conseguir reperguntar, a sessão termina (salvo a tolerância
 *   comprada conscientemente em DIRETORIO_GRACA_MINUTOS).
 * - Conta local (emergência) não passa por aqui: não tem identidade Entra.
 *
 * A revalidação é invisível e acontece entre servidores (chamada assinada por
 * HMAC): não há nova ida ao Entra, pedido de senha ou MFA.
 */
import type { Configuracao } from '../config/configuracao'
import type { AuditoriaRepositorio } from '../repositorios/auditoriaRepositorio'
import type { UsuarioRepositorio } from '../repositorios/usuarioRepositorio'
import { AcessoNegado, AutoridadeIndisponivel } from './erros'
import { complementarPeloGraph, type ClienteGraph } from './graph'
import type { ClienteIntranet } from './intranet'

/** Teto do contrato da Intranet — constante, não configuração. */
export const CACHE_MAXIMO_MS = 5 * 60 * 1000

export class AcessoRevogado extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AcessoRevogado'
  }
}

export class ServicoAutorizacao {
  constructor(
    private readonly cfg: Configuracao,
    private readonly usuarios: UsuarioRepositorio,
    private readonly auditoria: AuditoriaRepositorio,
    private readonly intranet: ClienteIntranet,
    private readonly graph: ClienteGraph,
    private readonly agora: () => number = Date.now,
  ) {}

  /** Deixa seguir, ou lança. Nunca devolve "provavelmente pode". */
  async conferir(usuarioId: string, contexto: { email: string; ip: string | null; destino: string }): Promise<void> {
    if (!this.cfg.diretorio.autorizacaoPeloMe) return
    const estado = await this.usuarios.estadoAutorizacao(usuarioId)
    if (!estado || estado.origem === 'local') return

    const agora = this.agora()
    const autorizadoEm = estado.autorizadoEm ? Date.parse(estado.autorizadoEm) : null
    if (autorizadoEm && agora - autorizadoEm < CACHE_MAXIMO_MS) return

    if (!estado.entraOid) throw new AutoridadeIndisponivel('A sessão não possui identidade Entra vinculada.')

    try {
      const acesso = await this.intranet.validarAcesso(estado.entraOid)
      const { perfil } = await complementarPeloGraph(this.graph, this.cfg.entra.graphPerfil, estado.entraOid, acesso)
      await this.usuarios.marcarAutorizado(usuarioId, acesso.departamento, perfil)
    } catch (erro) {
      if (erro instanceof AcessoNegado) {
        await this.usuarios.revogar(usuarioId)
        await this.auditoria.registrar({
          acao: 'acesso.revogado',
          resultado: 'negado',
          atorId: usuarioId,
          atorEmail: contexto.email,
          origemIp: contexto.ip,
          motivo: erro.message,
          recursoTipo: 'autorizacao',
          recursoId: 'api/access/v1/me',
        })
        throw new AcessoRevogado(erro.message)
      }
      if (erro instanceof AutoridadeIndisponivel) {
        const graca = this.cfg.diretorio.gracaMinutos * 60_000
        if (graca > 0 && autorizadoEm && agora - autorizadoEm < CACHE_MAXIMO_MS + graca) return
        throw erro
      }
      throw erro
    }
  }
}
