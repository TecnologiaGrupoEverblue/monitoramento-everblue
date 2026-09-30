/**
 * Casos de uso de autenticação — porte do fluxo da IA Everblue.
 *
 * Duas perguntas, respondidas por autoridades diferentes:
 *
 * | Pergunta                                   | Quem responde                               |
 * |--------------------------------------------|---------------------------------------------|
 * | Quem é esta pessoa?                        | Microsoft Entra ID + Microsoft Graph        |
 * | Ela pode usar o Monitoramento? Departamento?| Intranet, por GET /api/access/v1/me        |
 *
 * Só depois do "pode" algo é gravado. O perfil DENTRO do Monitoramento é
 * autoridade desta aplicação (mapeamento de grupos do Entra) e nunca é
 * rebaixado pela ausência de um grupo.
 */
import { NIVEL_PERFIL, type PerfilAcesso } from '@monitoramento/dominio'
import type { Configuracao } from '../config/configuracao'
import type { Banco } from '../infra/banco'
import type { AuditoriaRepositorio } from '../repositorios/auditoriaRepositorio'
import type { UsuarioRepositorio } from '../repositorios/usuarioRepositorio'
import { conferirSenha } from '../seguranca/senha'
import type { AutenticadorEntra, EstadoOidc, IdentidadeEntra } from './entra'
import { AcessoNegado, AutoridadeIndisponivel, ErroAutenticacao } from './erros'
import { complementarPeloGraph, type ClienteGraph, type PerfilCorporativo } from './graph'
import type { AcessoConfirmado, ClienteIntranet } from './intranet'

export interface ContextoRequisicao {
  ip: string | null
  correlationId: string | null
}

export class LoginRecusado extends Error {
  constructor(
    message: string,
    readonly codigo: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'LoginRecusado'
  }
}

export class ServicoLogin {
  constructor(
    private readonly cfg: Configuracao,
    private readonly banco: Banco,
    private readonly entra: AutenticadorEntra,
    private readonly intranet: ClienteIntranet,
    private readonly graph: ClienteGraph,
    private readonly usuarios: UsuarioRepositorio,
    private readonly auditoria: AuditoriaRepositorio,
  ) {}

  /** Conclui o retorno do Entra. Devolve o id do usuário, ou lança `LoginRecusado`. */
  async concluirEntra(codigo: string, estado: EstadoOidc | null, state: string, ctx: ContextoRequisicao): Promise<string> {
    try {
      const identidade = await this.entra.concluir(codigo, estado, state)

      // Quem decide se esta pessoa entra é a INTRANET. O Entra provou QUEM é;
      // o /me responde SE pode. Responder só a primeira deixaria entrar
      // qualquer conta do tenant.
      let acesso: AcessoConfirmado | null = null
      if (this.cfg.diretorio.autorizacaoPeloMe) {
        acesso = await this.intranet.validarAcesso(identidade.oid)
      }

      // Retrato corporativo: da Intranet; o Graph só complementa e nunca bloqueia.
      let perfilCorporativo: PerfilCorporativo | null = null
      let usoGraph = 'nao_usado'
      if (acesso) {
        const r = await complementarPeloGraph(this.graph, this.cfg.entra.graphPerfil, identidade.oid, acesso)
        perfilCorporativo = r.perfil
        usoGraph = r.graph
      }

      const usuarioId = await this.provisionar(identidade, perfilCorporativo, acesso)
      const usuario = await this.usuarios.porId(usuarioId)
      if (!usuario || !usuario.ativo) {
        throw new LoginRecusado('Seu acesso ao Monitoramento está inativo. Procure o administrador.', 'inativo', 403)
      }
      await this.auditoria.registrar({
        acao: 'login.entra',
        atorId: usuarioId,
        atorEmail: usuario.email,
        origemIp: ctx.ip,
        correlationId: ctx.correlationId,
        detalhes: { grupos: identidade.grupos.length, gruposTruncados: identidade.gruposTruncados, autorizadoPelaIntranet: Boolean(acesso), graph: usoGraph },
      })
      return usuarioId
    } catch (erro) {
      const recusa = this.traduzir(erro)
      await this.auditoria.registrar({
        acao: 'login.entra',
        resultado: 'negado',
        origemIp: ctx.ip,
        correlationId: ctx.correlationId,
        motivo: (erro as Error).message,
        detalhes: { codigo: recusa.codigo },
      })
      throw recusa
    }
  }

  private traduzir(erro: unknown): LoginRecusado {
    if (erro instanceof LoginRecusado) return erro
    if (erro instanceof AcessoNegado) return new LoginRecusado(erro.message, erro.codigo, 403)
    // Autoridade fora do ar não vira permissão.
    if (erro instanceof AutoridadeIndisponivel) return new LoginRecusado(erro.message, erro.codigo, 503)
    if (erro instanceof ErroAutenticacao) return new LoginRecusado(erro.message, erro.codigo, 401)
    return new LoginRecusado('Não foi possível concluir o login.', 'falha', 500)
  }

  /** Perfil pelo mapeamento de grupos: o maior nível entre os grupos. */
  private perfilPelosGrupos(identidade: IdentidadeEntra): PerfilAcesso {
    let perfil = this.cfg.entra.perfilPadrao
    for (const grupo of identidade.grupos) {
      const candidato = this.cfg.entra.mapaPerfil.get(grupo.toLowerCase())
      if (candidato && NIVEL_PERFIL[candidato] > NIVEL_PERFIL[perfil]) perfil = candidato
    }
    // ADMIN_EMAIL é o administrador da instalação: garante que exista ao
    // menos uma pessoa capaz de administrar antes do mapeamento de grupos.
    if (this.cfg.adminEmail && identidade.email === this.cfg.adminEmail) perfil = 'admin'
    return perfil
  }

  private async provisionar(identidade: IdentidadeEntra, perfilCorporativo: PerfilCorporativo | null, acesso: AcessoConfirmado | null): Promise<string> {
    const perfilMapeado = this.perfilPelosGrupos(identidade)
    // Ordem de autoridade para o retrato: Graph (quando ligado), depois o
    // cadastro corporativo da Intranet, depois as claims do token.
    const nome = perfilCorporativo?.nome || acesso?.nome || identidade.nome
    const email = perfilCorporativo?.email || acesso?.email || identidade.email
    const cargo = perfilCorporativo?.cargo ?? acesso?.cargo ?? null
    const departamento = acesso?.departamento ?? null

    return this.banco.transacao(async (tx) => {
      // Por `oid` primeiro: é o vínculo estável. Só então por e-mail, que
      // cobre a conta criada antes da integração.
      const existente = (await this.usuarios.porOid(identidade.oid, tx)) ?? (await this.usuarios.porEmail(identidade.email, tx))

      if (existente) {
        const perfilFinal = NIVEL_PERFIL[perfilMapeado] > NIVEL_PERFIL[existente.perfil] ? perfilMapeado : existente.perfil
        await this.usuarios.atualizarNoLogin(
          existente.id,
          {
            email,
            nome,
            cargo: cargo ?? existente.cargo,
            perfil: perfilFinal,
            entraOid: identidade.oid,
            grupos: identidade.grupos,
            departamentoExternoId: departamento?.externoId ?? null,
            departamentoNome: departamento?.nome ?? existente.departamentoNome,
            // Só a Intranet reativa: o ato de entrar, sozinho, não reativa ninguém.
            reativar: Boolean(acesso),
          },
          tx,
        )
        await this.usuarios.registrarAutorizacaoNoLogin(existente.id, Boolean(acesso), tx)
        return existente.id
      }

      // Sem autorização pela Intranet configurada, não há autoridade que
      // autorize alguém novo — e o login sozinho não é autoridade. Recusa, e
      // NADA é gravado sobre a pessoa (a tentativa fica na auditoria).
      if (!acesso) {
        throw new LoginRecusado(
          'Sua conta não está cadastrada no Monitoramento. O cadastro vem do Controle de Acessos da Intranet — procure o administrador para solicitar a liberação.',
          'nao_cadastrado',
          403,
        )
      }

      const novoId = await this.usuarios.criarEntra(
        {
          email,
          nome,
          cargo,
          perfil: perfilMapeado,
          entraOid: identidade.oid,
          grupos: identidade.grupos,
          departamentoExternoId: departamento?.externoId ?? null,
          departamentoNome: departamento?.nome ?? null,
        },
        tx,
      )
      await this.usuarios.registrarAutorizacaoNoLogin(novoId, true, tx)
      return novoId
    })
  }

  /** Acesso de emergência (conta local declarada). Mensagens não revelam se o
   * e-mail existe, para evitar enumeração de contas. */
  async autenticarEmergencia(email: string, senha: string, ctx: ContextoRequisicao): Promise<string> {
    const generico = new LoginRecusado('E-mail ou senha inválidos.', 'credencial', 401)
    const conta = await this.usuarios.credencialPorEmail(email)
    const declarada = Boolean(conta && (conta.motivoAcessoLocal || conta.origem === 'local'))
    if (!conta || !conta.ativo || !declarada || !conta.senhaHash) {
      await this.auditoria.registrar({ acao: 'login.emergencia', resultado: 'negado', atorEmail: email, origemIp: ctx.ip, motivo: 'credencial inexistente ou inativa' })
      throw generico
    }
    if (conta.bloqueadoAte && new Date(conta.bloqueadoAte) > new Date()) {
      await this.auditoria.registrar({ acao: 'login.emergencia', resultado: 'negado', atorId: conta.id, atorEmail: email, origemIp: ctx.ip, motivo: 'conta bloqueada por tentativas' })
      throw new LoginRecusado('Conta temporariamente bloqueada. Tente novamente mais tarde.', 'bloqueado', 429)
    }
    if (!(await conferirSenha(conta.senhaHash, senha))) {
      const tentativas = conta.tentativasFalhas + 1
      const bloqueio = tentativas >= this.cfg.login.maxTentativas ? new Date(Date.now() + this.cfg.login.bloqueioMinutos * 60_000) : null
      await this.usuarios.registrarFalhaLogin(conta.id, tentativas, bloqueio)
      await this.auditoria.registrar({ acao: 'login.emergencia', resultado: 'negado', atorId: conta.id, atorEmail: email, origemIp: ctx.ip, motivo: 'senha incorreta', detalhes: { tentativas } })
      throw generico
    }
    await this.usuarios.registrarLoginLocal(conta.id)
    // Resultado `excecao`, não `sucesso`: é o único caminho que não passa pela
    // autoridade da Intranet, e quem audita precisa enxergá-lo separado.
    await this.auditoria.registrar({ acao: 'login.emergencia', resultado: 'excecao', atorId: conta.id, atorEmail: conta.email, origemIp: ctx.ip, correlationId: ctx.correlationId })
    return conta.id
  }
}
