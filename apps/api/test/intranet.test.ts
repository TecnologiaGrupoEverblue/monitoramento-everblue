/**
 * Compatibilidade da chamada Monitoramento → Intranet (`/api/access/v1/me`).
 *
 * Duas provas independentes:
 * 1. o vetor fixo da IA Everblue (`test_assinatura_interna.py`) — mesma
 *    entrada, mesma assinatura;
 * 2. o VERIFICADOR REAL da Intranet (cópia em `test/contrato/`) aceita o que
 *    o Monitoramento assina, e recusa adulteração, atraso e outra aplicação.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { AcessoNegado, AutoridadeIndisponivel } from '../src/identidade/erros'
import { CAMINHO_ME, ClienteIntranet } from '../src/identidade/intranet'
import { configTeste, json, simularFetch } from './apoio'
import { deriveDirectoryIntegrationSecret, verifyInternalDirectoryRequest } from './contrato/intranet-directory-internal-auth'

const CLIENTE = '22222222-2222-4222-8222-222222222222'
const OID = '33333333-3333-4333-8333-333333333333'
const MESTRE = 'mestre-da-intranet-com-mais-de-32-caracteres-0123456789'

let restaurar = () => {}
afterEach(() => restaurar())

function pedido(cabecalhos: Record<string, string>, caminho = CAMINHO_ME) {
  return new Request(`https://intranet.grupoeverblue.com.br${caminho}`, { method: 'GET', headers: cabecalhos })
}

describe('assinatura interna HMAC (contrato v1 da Intranet)', () => {
  it('reproduz o vetor de compatibilidade da IA Everblue', () => {
    const cliente = new ClienteIntranet(configTeste(), () => 1780156800 * 1000, () => 'nonce_valido_com_mais_de_16')
    const h = cliente.cabecalhosAssinados(CAMINHO_ME, OID)
    expect(h['X-Everblue-Client-Id']).toBe(CLIENTE)
    expect(h['X-Everblue-User-Oid']).toBe(OID)
    expect(h['X-Everblue-Timestamp']).toBe('1780156800')
    expect(h['X-Everblue-Signature']).toBe('9162f85e4f64a06a4454bcbbb86cc1be54ed3fc7ffa94f6c494a234fc273fae9')
  })

  it('o verificador real da Intranet aceita a chave derivada para este Client ID', () => {
    const derivada = deriveDirectoryIntegrationSecret(CLIENTE, { ACCESS_API_MASTER_SECRET: MESTRE })
    expect(derivada).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const agora = 1_790_000_000
    const cliente = new ClienteIntranet(configTeste({ DIRETORIO_INTEGRATION_SECRET: derivada }), () => agora * 1000)
    const verificado = verifyInternalDirectoryRequest(pedido(cliente.cabecalhosAssinados(CAMINHO_ME, OID.toUpperCase())), {
      nowSeconds: agora,
      environment: { ACCESS_API_MASTER_SECRET: MESTRE },
    })
    expect(verificado).toMatchObject({ clientId: CLIENTE, userObjectId: OID })
  })

  it('recusa: outro oid, assinatura vencida, chave de outra aplicação', () => {
    const agora = 1_790_000_000
    const env = { ACCESS_API_MASTER_SECRET: MESTRE }
    const derivada = deriveDirectoryIntegrationSecret(CLIENTE, env)
    const cliente = new ClienteIntranet(configTeste({ DIRETORIO_INTEGRATION_SECRET: derivada }), () => agora * 1000)

    const adulterado = { ...cliente.cabecalhosAssinados(CAMINHO_ME, OID), 'X-Everblue-User-Oid': '44444444-4444-4444-8444-444444444444' }
    expect(() => verifyInternalDirectoryRequest(pedido(adulterado), { nowSeconds: agora, environment: env })).toThrow('INTERNAL_AUTH_SIGNATURE_INVALID')

    expect(() => verifyInternalDirectoryRequest(pedido(cliente.cabecalhosAssinados(CAMINHO_ME, OID)), { nowSeconds: agora + 91, environment: env })).toThrow(
      'INTERNAL_AUTH_EXPIRED',
    )

    const outra = deriveDirectoryIntegrationSecret('55555555-5555-4555-8555-555555555555', env)
    const intruso = new ClienteIntranet(configTeste({ DIRETORIO_INTEGRATION_SECRET: outra }), () => agora * 1000)
    expect(() => verifyInternalDirectoryRequest(pedido(intruso.cabecalhosAssinados(CAMINHO_ME, OID)), { nowSeconds: agora, environment: env })).toThrow(
      'INTERNAL_AUTH_SIGNATURE_INVALID',
    )
  })

  it('a assinatura cobre o caminho: a do /me não vale para a /photo', () => {
    const agora = 1_790_000_000
    const env = { ACCESS_API_MASTER_SECRET: MESTRE }
    const cliente = new ClienteIntranet(configTeste({ DIRETORIO_INTEGRATION_SECRET: deriveDirectoryIntegrationSecret(CLIENTE, env) }), () => agora * 1000)
    expect(() => verifyInternalDirectoryRequest(pedido(cliente.cabecalhosAssinados(CAMINHO_ME, OID), '/api/access/v1/photo'), { nowSeconds: agora, environment: env })).toThrow(
      'INTERNAL_AUTH_SIGNATURE_INVALID',
    )
  })

  it('cada chamada leva um nonce novo', () => {
    const cliente = new ClienteIntranet(configTeste())
    const a = cliente.cabecalhosAssinados(CAMINHO_ME, OID)['X-Everblue-Nonce']
    const b = cliente.cabecalhosAssinados(CAMINHO_ME, OID)['X-Everblue-Nonce']
    expect(a).toMatch(/^[A-Za-z0-9_-]{16,128}$/)
    expect(a).not.toBe(b)
  })
})

describe('respostas do /me', () => {
  function responder(status: number, corpo: unknown) {
    const f = simularFetch(async () => json(status, corpo))
    restaurar = f.restaurar
    return f
  }
  const cliente = () => new ClienteIntranet(configTeste())

  it('liberado: devolve o retrato corporativo e nunca envia Authorization', async () => {
    const f = responder(200, {
      allowed: true,
      user: { id: 'u-1', entraObjectId: OID, name: 'Pessoa', email: 'Pessoa@grupoeverblue.com.br', jobTitle: 'Analista', department: { id: 'd-1', name: 'Risco', slug: 'risco' } },
    })
    const acesso = await cliente().validarAcesso(OID)
    expect(acesso).toMatchObject({ usuarioExternoId: 'u-1', email: 'pessoa@grupoeverblue.com.br', cargo: 'Analista', departamento: { externoId: 'd-1', nome: 'Risco' } })
    const cabecalhos = f.chamadas[0].init?.headers as Record<string, string>
    expect(f.chamadas[0].url).toBe('https://intranet.teste/api/access/v1/me')
    expect(Object.keys(cabecalhos).map((k) => k.toLowerCase())).not.toContain('authorization')
    expect(cabecalhos['X-Everblue-Signature']).toMatch(/^[0-9a-f]{64}$/)
  })

  it('departamento legado (só nome) é aceito', async () => {
    responder(200, { allowed: true, user: { id: 'u-1', entraObjectId: OID, name: 'P', email: 'p@x', department: { id: null, name: 'Tesouraria', slug: null } } })
    expect((await cliente().validarAcesso(OID)).departamento).toEqual({ externoId: null, nome: 'Tesouraria', slug: '' })
  })

  it('SYSTEM_ACCESS_DENIED é negativa (AcessoNegado)', async () => {
    responder(403, { allowed: false, error: 'SYSTEM_ACCESS_DENIED' })
    await expect(cliente().validarAcesso(OID)).rejects.toBeInstanceOf(AcessoNegado)
  })

  it.each([
    [401, 'INTERNAL_AUTH_SIGNATURE_INVALID'],
    [401, 'INTERNAL_AUTH_REPLAYED'],
    [403, 'APPLICATION_NOT_AUTHORIZED'],
    [503, 'INTERNAL_AUTH_CONFIGURATION_MISSING'],
    [429, 'RATE_LIMITED'],
    [500, 'INTERNAL_ERROR'],
  ])('%i %s não vira permissão nem negativa sobre a pessoa', async (status, codigo) => {
    responder(status, { allowed: false, error: codigo })
    await expect(cliente().validarAcesso(OID)).rejects.toBeInstanceOf(AutoridadeIndisponivel)
  })

  it('resposta sobre outra identidade é recusada', async () => {
    responder(200, { allowed: true, user: { id: 'u-1', entraObjectId: '44444444-4444-4444-8444-444444444444' } })
    await expect(cliente().validarAcesso(OID)).rejects.toThrow(/identidade diferente/)
  })

  it('sem chave configurada não chama a rede', async () => {
    const f = responder(200, {})
    await expect(new ClienteIntranet(configTeste({ DIRETORIO_INTEGRATION_SECRET: '' })).validarAcesso(OID)).rejects.toBeInstanceOf(AutoridadeIndisponivel)
    expect(f.chamadas).toHaveLength(0)
  })

  it('foto usa a mesma assinatura e valida tipo', async () => {
    const f = simularFetch(async () => new Response(Buffer.from([0xff, 0xd8, 0xff]), { status: 200, headers: { 'content-type': 'image/jpeg' } }))
    restaurar = f.restaurar
    expect(await cliente().obterFoto(OID)).toMatchObject({ tipo: 'image/jpeg' })
    expect((f.chamadas[0].init?.headers as Record<string, string>)['X-Everblue-User-Oid']).toBe(OID)
    expect(await cliente().obterFoto(null)).toBeNull()
  })
})
