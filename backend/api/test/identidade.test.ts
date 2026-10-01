import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { comporDependencias, type Dependencias } from '../src/composicao'
import { ArmazenamentoMemoria } from '../src/infra/armazenamento'
import type { Banco } from '../src/infra/banco'
import { AutoridadeIndisponivel } from '../src/identidade/erros'
import { AcessoRevogado } from '../src/identidade/servicoAutorizacao'
import { LoginRecusado } from '../src/identidade/servicoLogin'
import { FonteFotoNenhuma } from '../src/identidade/fontesFoto'
import { configTeste, json, simularFetch } from './apoio'
import { bancoLimpo, temBanco } from './banco'

const OID = '00000000-aaaa-4bbb-8ccc-000000000001'
let chaves: Awaited<ReturnType<typeof generateKeyPair>>
let jwk: Record<string, unknown>

beforeAll(async () => {
  chaves = await generateKeyPair('RS256')
  jwk = { ...(await exportJWK(chaves.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }
})

async function idToken(nonce: string, extra: Record<string, unknown> = {}) {
  return new SignJWT({ oid: OID, preferred_username: 'Pessoa.Teste@grupoeverblue.com.br', name: 'Pessoa Teste', nonce, groups: [], ...extra })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer('https://login.microsoftonline.com/tenant/v2.0')
    .setAudience('cliente-monitoramento')
    .setSubject('sub-1')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(chaves.privateKey)
}

type RespostaMe = { status: number; corpo: unknown }

let graphFalha = false
function cenario(me: () => RespostaMe, nonceAtual: () => string) {
  return simularFetch(async (url) => {
    if (url.endsWith('/discovery/v2.0/keys')) return json(200, { keys: [jwk] })
    if (url.endsWith('/oauth2/v2.0/token')) {
      return json(200, { id_token: await idToken(nonceAtual()), access_token: 'access-token-graph-nao-usado', expires_in: 3600 })
    }
    if (url.endsWith('/api/access/v1/me')) {
      const r = me()
      return json(r.status, r.corpo)
    }
    if (url.includes('graph.microsoft.com') && graphFalha) return json(403, { error: { code: 'Authorization_RequestDenied' } })
    if (url.includes('graph.microsoft.com')) return json(200, { id: OID, displayName: 'Pessoa Teste', mail: 'pessoa.teste@grupoeverblue.com.br', jobTitle: 'Analista de Risco' })
    return json(404, {})
  })
}

const permitido: RespostaMe = { status: 200, corpo: { allowed: true, user: { id: 'u-1', entraObjectId: OID, department: { id: 'd-1', name: 'Risco', slug: 'risco' } } } }
const negado: RespostaMe = { status: 403, corpo: { error: 'SYSTEM_ACCESS_DENIED' } }

describe.skipIf(!temBanco)('login corporativo (Entra + Intranet), como na IA Everblue', () => {
  let banco: Banco
  let deps: Dependencias
  let restaurar = () => {}

  beforeEach(async () => {
    banco = await bancoLimpo()
    deps = comporDependencias(configTeste({ ADMIN_EMAIL: 'admin@grupoeverblue.com.br' }), { banco, armazenamento: new ArmazenamentoMemoria(), fonteFoto: new FonteFotoNenhuma() })
  })
  afterEach(async () => {
    graphFalha = false
    restaurar()
    await banco.encerrar()
  })
  afterAll(() => restaurar())

  async function logar(resposta: RespostaMe) {
    const { url, estado } = deps.entra.montarAutorizacao('/monitoramento')
    expect(url).toContain('scope=openid+profile+email&')
    expect(url).toContain('code_challenge_method=S256')
    const f = cenario(() => resposta, () => estado.nonce)
    restaurar = f.restaurar
    return { chamadas: f.chamadas, id: await deps.login.concluirEntra('codigo', estado, estado.state, { ip: '10.0.0.1', correlationId: 'c1' }) }
  }

  it('Intranet libera: cria o espelho com departamento e cargo; nenhum token guardado', async () => {
    const { id, chamadas } = await logar(permitido)
    const { rows } = await banco.pool.query('SELECT * FROM usuario WHERE id = $1', [id])
    expect(rows[0]).toMatchObject({ email: 'pessoa.teste@grupoeverblue.com.br', departamento_nome: 'Risco', cargo: 'Analista de Risco', perfil: 'leitor', ativo: true })
    expect(rows[0].entra_token_cifrado).toBeNull()
    expect(rows[0].autorizado_em).toBeTruthy()
    // O /me vai ASSINADO com o oid do ID token — sem Bearer.
    const me = chamadas.find((c) => c.url.endsWith('/api/access/v1/me'))!
    const h = me.init?.headers as Record<string, string>
    expect(h['X-Everblue-User-Oid']).toBe(OID)
    expect(h['X-Everblue-Client-Id']).toBe('22222222-2222-4222-8222-222222222222')
    expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain('authorization')
  })

  it('token de versão anterior é apagado no login', async () => {
    const { id } = await logar(permitido)
    await banco.pool.query(`UPDATE usuario SET entra_token_cifrado = 'antigo', entra_token_expira_em = now() + interval '1 hour' WHERE id = $1`, [id])
    restaurar()
    await logar(permitido)
    const u = (await banco.pool.query('SELECT entra_token_cifrado, entra_token_expira_em FROM usuario WHERE id = $1', [id])).rows[0]
    expect(u).toEqual({ entra_token_cifrado: null, entra_token_expira_em: null })
  })

  it('Graph recusado (403) NÃO bloqueia: entra com o retrato da Intranet', async () => {
    graphFalha = true
    const completo: RespostaMe = { status: 200, corpo: { allowed: true, user: { id: 'u-1', entraObjectId: OID, name: 'Pessoa Intranet', email: 'pessoa.teste@grupoeverblue.com.br', jobTitle: null, department: { id: 'd-1', name: 'Risco', slug: 'risco' } } } }
    const { id } = await logar(completo)
    const u = (await banco.pool.query('SELECT nome, email, cargo, departamento_nome, ativo FROM usuario WHERE id = $1', [id])).rows[0]
    expect(u).toEqual({ nome: 'Pessoa Intranet', email: 'pessoa.teste@grupoeverblue.com.br', cargo: null, departamento_nome: 'Risco', ativo: true })
    const a = (await banco.pool.query(`SELECT resultado, detalhes FROM auditoria WHERE acao = 'login.entra'`)).rows[0]
    expect(a).toMatchObject({ resultado: 'sucesso', detalhes: { graph: 'indisponivel' } })
  })

  it('retrato completo na Intranet dispensa o Graph', async () => {
    const completo: RespostaMe = { status: 200, corpo: { allowed: true, user: { id: 'u-1', entraObjectId: OID, name: 'Pessoa Intranet', email: 'pessoa.teste@grupoeverblue.com.br', jobTitle: 'Gerente', department: { id: 'd-1', name: 'Risco', slug: 'risco' } } } }
    const { id, chamadas } = await logar(completo)
    expect(chamadas.some((c) => c.url.includes('graph.microsoft.com'))).toBe(false)
    expect((await banco.pool.query('SELECT cargo FROM usuario WHERE id = $1', [id])).rows[0].cargo).toBe('Gerente')
  })

  it('Intranet nega: recusa com sem_acesso e NADA é gravado sobre a pessoa', async () => {
    await expect(logar(negado)).rejects.toMatchObject({ codigo: 'sem_acesso', status: 403 })
    expect((await banco.pool.query('SELECT count(*)::int n FROM usuario')).rows[0].n).toBe(0)
    const { rows } = await banco.pool.query(`SELECT resultado FROM auditoria WHERE acao = 'login.entra'`)
    expect(rows.map((r) => r.resultado)).toEqual(['negado'])
  })

  it('Intranet fora do ar não vira permissão', async () => {
    await expect(logar({ status: 500, corpo: {} })).rejects.toBeInstanceOf(LoginRecusado)
    expect((await banco.pool.query('SELECT count(*)::int n FROM usuario')).rows[0].n).toBe(0)
  })

  it('state divergente é recusado antes de qualquer troca de código', async () => {
    const { estado } = deps.entra.montarAutorizacao('/')
    const f = cenario(() => permitido, () => estado.nonce)
    restaurar = f.restaurar
    await expect(deps.login.concluirEntra('codigo', estado, 'state-forjado', { ip: null, correlationId: null })).rejects.toMatchObject({ codigo: 'expirado' })
    expect(f.chamadas).toHaveLength(0)
  })

  it('perfil nunca é rebaixado pela ausência de grupo', async () => {
    const { id } = await logar(permitido)
    await banco.pool.query(`UPDATE usuario SET perfil = 'gestor' WHERE id = $1`, [id])
    restaurar()
    await logar(permitido)
    expect((await banco.pool.query('SELECT perfil FROM usuario WHERE id = $1', [id])).rows[0].perfil).toBe('gestor')
  })

  describe('revalidação durante a sessão (cache máximo de 5 minutos)', () => {
    it('dentro de 5 min não pergunta; depois pergunta; negativa revoga', async () => {
      const { id } = await logar(permitido)
      restaurar()
      let resposta = permitido
      const f = cenario(() => resposta, () => '')
      restaurar = f.restaurar
      await deps.autorizacao.conferir(id, { email: 'x', ip: null, destino: '/' })
      expect(f.chamadas.filter((c) => c.url.endsWith('/me'))).toHaveLength(0)

      await banco.pool.query(`UPDATE usuario SET autorizado_em = now() - interval '6 minutes' WHERE id = $1`, [id])
      await deps.autorizacao.conferir(id, { email: 'x', ip: null, destino: '/' })
      expect(f.chamadas.filter((c) => c.url.endsWith('/me'))).toHaveLength(1)

      await banco.pool.query(`UPDATE usuario SET autorizado_em = now() - interval '6 minutes' WHERE id = $1`, [id])
      resposta = negado
      await expect(deps.autorizacao.conferir(id, { email: 'x', ip: null, destino: '/' })).rejects.toBeInstanceOf(AcessoRevogado)
      const u = (await banco.pool.query('SELECT ativo, entra_token_cifrado FROM usuario WHERE id = $1', [id])).rows[0]
      expect(u).toEqual({ ativo: false, entra_token_cifrado: null })
    })

    it('revalida sem token e sem ida ao Entra; Intranet fora do ar encerra', async () => {
      const { id } = await logar(permitido)
      restaurar()
      let resposta: RespostaMe = permitido
      const f = cenario(() => resposta, () => '')
      restaurar = f.restaurar
      await banco.pool.query(`UPDATE usuario SET autorizado_em = now() - interval '6 minutes' WHERE id = $1`, [id])
      await deps.autorizacao.conferir(id, { email: 'x', ip: null, destino: '/x' })
      expect(f.chamadas.some((c) => c.url.includes('login.microsoftonline.com'))).toBe(false)

      await banco.pool.query(`UPDATE usuario SET autorizado_em = now() - interval '6 minutes' WHERE id = $1`, [id])
      resposta = { status: 502, corpo: {} }
      await expect(deps.autorizacao.conferir(id, { email: 'x', ip: null, destino: '/x' })).rejects.toBeInstanceOf(AutoridadeIndisponivel)
    })

    it('graça configurada tolera a Intranet fora do ar pelo tempo comprado', async () => {
      deps = comporDependencias(configTeste({ ADMIN_EMAIL: 'admin@grupoeverblue.com.br', DIRETORIO_GRACA_MINUTOS: '10' }), { banco, armazenamento: new ArmazenamentoMemoria(), fonteFoto: new FonteFotoNenhuma() })
      const { id } = await logar(permitido)
      restaurar()
      const f = cenario(() => ({ status: 502, corpo: {} }), () => '')
      restaurar = f.restaurar
      await banco.pool.query(`UPDATE usuario SET autorizado_em = now() - interval '6 minutes' WHERE id = $1`, [id])
      await deps.autorizacao.conferir(id, { email: 'x', ip: null, destino: '/x' })
      await banco.pool.query(`UPDATE usuario SET autorizado_em = now() - interval '16 minutes' WHERE id = $1`, [id])
      await expect(deps.autorizacao.conferir(id, { email: 'x', ip: null, destino: '/x' })).rejects.toBeInstanceOf(AutoridadeIndisponivel)
    })
  })
})
