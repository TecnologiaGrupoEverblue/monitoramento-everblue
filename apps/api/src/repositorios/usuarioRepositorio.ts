/** Espelho local das pessoas que a Intranet autorizou (e da conta de emergência). */
import type { PerfilAcesso } from '@monitoramento/dominio'
import type { Executor } from '../infra/banco'

export interface Usuario {
  id: string
  email: string
  nome: string
  cargo: string | null
  perfil: PerfilAcesso
  origem: 'entra' | 'local'
  ativo: boolean
  entraOid: string | null
  departamentoNome: string | null
}

export interface UsuarioComCredencial extends Usuario {
  senhaHash: string | null
  motivoAcessoLocal: string | null
  tentativasFalhas: number
  bloqueadoAte: string | null
}

export interface EstadoAutorizacao {
  origem: 'entra' | 'local'
  entraOid: string | null
  autorizadoEm: string | null
}

const COLUNAS = `id, email, nome, cargo, perfil, origem, ativo, entra_oid, departamento_nome`

function mapear(l: Record<string, unknown>): Usuario {
  return {
    id: String(l.id),
    email: String(l.email),
    nome: String(l.nome),
    cargo: (l.cargo as string | null) ?? null,
    perfil: l.perfil as PerfilAcesso,
    origem: l.origem as 'entra' | 'local',
    ativo: Boolean(l.ativo),
    entraOid: (l.entra_oid as string | null) ?? null,
    departamentoNome: (l.departamento_nome as string | null) ?? null,
  }
}

export class UsuarioRepositorio {
  constructor(private readonly db: Executor) {}

  async porId(id: string, executor: Executor = this.db): Promise<Usuario | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null
    const { rows } = await executor.query(`SELECT ${COLUNAS} FROM usuario WHERE id = $1`, [id])
    return rows[0] ? mapear(rows[0]) : null
  }

  async porOid(oid: string, executor: Executor = this.db): Promise<Usuario | null> {
    const { rows } = await executor.query(`SELECT ${COLUNAS} FROM usuario WHERE entra_oid = $1`, [oid])
    return rows[0] ? mapear(rows[0]) : null
  }

  async porEmail(email: string, executor: Executor = this.db): Promise<Usuario | null> {
    const { rows } = await executor.query(`SELECT ${COLUNAS} FROM usuario WHERE lower(email) = lower($1)`, [email])
    return rows[0] ? mapear(rows[0]) : null
  }

  async credencialPorEmail(email: string): Promise<UsuarioComCredencial | null> {
    const { rows } = await this.db.query(
      `SELECT ${COLUNAS}, senha_hash, motivo_acesso_local, tentativas_falhas, bloqueado_ate
         FROM usuario WHERE lower(email) = lower($1)`,
      [email],
    )
    const l = rows[0]
    if (!l) return null
    return {
      ...mapear(l),
      senhaHash: l.senha_hash ?? null,
      motivoAcessoLocal: l.motivo_acesso_local ?? null,
      tentativasFalhas: Number(l.tentativas_falhas ?? 0),
      bloqueadoAte: l.bloqueado_ate ?? null,
    }
  }

  async estadoAutorizacao(id: string): Promise<EstadoAutorizacao | null> {
    const { rows } = await this.db.query(
      `SELECT origem, entra_oid, autorizado_em FROM usuario WHERE id = $1`,
      [id],
    )
    const l = rows[0]
    if (!l) return null
    return {
      origem: l.origem,
      entraOid: l.entra_oid ?? null,
      autorizadoEm: l.autorizado_em ?? null,
    }
  }

  async criarEntra(
    dados: {
      email: string
      nome: string
      cargo: string | null
      perfil: PerfilAcesso
      entraOid: string
      grupos: string[]
      departamentoExternoId: string | null
      departamentoNome: string | null
    },
    executor: Executor = this.db,
  ): Promise<string> {
    const { rows } = await executor.query(
      `INSERT INTO usuario (email, nome, cargo, perfil, origem, entra_oid, entra_grupos,
                            departamento_externo_id, departamento_nome, sincronizado_em, ultimo_acesso_em)
       VALUES ($1, $2, $3, $4, 'entra', $5, $6::jsonb, $7, $8, now(), now())
       RETURNING id`,
      [dados.email, dados.nome, dados.cargo, dados.perfil, dados.entraOid, JSON.stringify(dados.grupos), dados.departamentoExternoId, dados.departamentoNome],
    )
    return String(rows[0].id)
  }

  /** Atualiza o espelho num login confirmado pela Intranet. `origem` só cai
   * para 'entra' — uma conta local declarada continua podendo entrar por
   * senha, porque quem decide isso é `motivo_acesso_local`. */
  async atualizarNoLogin(
    id: string,
    dados: {
      email: string
      nome: string
      cargo: string | null
      perfil: PerfilAcesso
      entraOid: string
      grupos: string[]
      departamentoExternoId: string | null
      departamentoNome: string | null
      reativar: boolean
    },
    executor: Executor = this.db,
  ): Promise<void> {
    await executor.query(
      `UPDATE usuario
          SET email = $2, nome = $3, cargo = $4, perfil = $5, entra_oid = $6, entra_grupos = $7::jsonb,
              departamento_externo_id = $8, departamento_nome = $9,
              origem = 'entra',
              ativo = CASE WHEN $10::boolean THEN TRUE ELSE ativo END,
              sincronizado_em = now(), ultimo_acesso_em = now(), tentativas_falhas = 0,
              atualizado_em = now()
        WHERE id = $1`,
      [id, dados.email, dados.nome, dados.cargo, dados.perfil, dados.entraOid, JSON.stringify(dados.grupos), dados.departamentoExternoId, dados.departamentoNome, dados.reativar],
    )
  }

  /** Guarda (ou limpa) o token delegado. Token guardado SEMPRE tem vencimento. */
  /** Resultado do login: a decisão positiva da Intranet vale como autorização
   * recente (cache de até 5 min). Apaga qualquer token delegado de versões
   * anteriores — desde a 1.0.2 nenhum é guardado. */
  async registrarAutorizacaoNoLogin(id: string, autorizadoPelaIntranet: boolean, executor: Executor = this.db): Promise<void> {
    await executor.query(
      `UPDATE usuario
          SET entra_token_cifrado = NULL, entra_token_expira_em = NULL,
              autorizado_em = CASE WHEN $2::boolean THEN now() ELSE NULL END
        WHERE id = $1`,
      [id, autorizadoPelaIntranet],
    )
  }

  async marcarAutorizado(id: string, departamento: { externoId: string | null; nome: string } | null, perfilCorporativo: { nome: string; email: string; cargo: string | null } | null): Promise<void> {
    await this.db.query(
      `UPDATE usuario
          SET autorizado_em = now(),
              departamento_externo_id = $2::text, departamento_nome = $3::text,
              nome = COALESCE($4::text, nome), email = COALESCE($5::text, email),
              cargo = CASE WHEN $4::text IS NULL THEN cargo ELSE $6::text END,
              sincronizado_em = now()
        WHERE id = $1`,
      [id, departamento?.externoId ?? null, departamento?.nome ?? null, perfilCorporativo?.nome ?? null, perfilCorporativo?.email ?? null, perfilCorporativo?.cargo ?? null],
    )
  }

  /** Negativa da Intranet: desativa e apaga o token (corta todas as sessões). */
  async revogar(id: string): Promise<void> {
    await this.db.query(
      `UPDATE usuario SET ativo = FALSE, entra_token_cifrado = NULL, entra_token_expira_em = NULL, autorizado_em = NULL WHERE id = $1`,
      [id],
    )
  }

  async encerrarSessao(id: string): Promise<void> {
    await this.db.query(
      `UPDATE usuario SET entra_token_cifrado = NULL, entra_token_expira_em = NULL, autorizado_em = NULL WHERE id = $1`,
      [id],
    )
  }

  async registrarFalhaLogin(id: string, tentativas: number, bloqueioAte: Date | null): Promise<void> {
    await this.db.query(`UPDATE usuario SET tentativas_falhas = $2, bloqueado_ate = $3 WHERE id = $1`, [id, tentativas, bloqueioAte])
  }

  async registrarLoginLocal(id: string): Promise<void> {
    await this.db.query(`UPDATE usuario SET tentativas_falhas = 0, bloqueado_ate = NULL, ultimo_acesso_em = now() WHERE id = $1`, [id])
  }

  /** Cria ou redefine a conta de emergência (roteiro operacional). */
  async definirContaEmergencia(email: string, nome: string, senhaHash: string, motivo: string): Promise<string> {
    const { rows } = await this.db.query(
      `INSERT INTO usuario (email, nome, perfil, origem, senha_hash, motivo_acesso_local, ativo)
       VALUES ($1, $2, 'admin', 'local', $3, $4, TRUE)
       ON CONFLICT ((lower(email))) DO UPDATE
         SET senha_hash = EXCLUDED.senha_hash, motivo_acesso_local = EXCLUDED.motivo_acesso_local,
             ativo = TRUE, tentativas_falhas = 0, bloqueado_ate = NULL, atualizado_em = now()
       RETURNING id`,
      [email.toLowerCase(), nome, senhaHash, motivo],
    )
    return String(rows[0].id)
  }
}
