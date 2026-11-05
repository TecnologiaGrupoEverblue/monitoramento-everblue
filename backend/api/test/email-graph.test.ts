/** E-mail do Mapa pelo Microsoft 365 no modelo da Intranet (GRAPH_MAIL_*). */
import { afterEach, describe, expect, it } from 'vitest'
import { EnvioGraph, criarEnviadorEmail } from '../src/infra/email'
import { configTeste, json, simularFetch } from './apoio'

const TENANT = '3c056c2f-3e7f-416b-957a-83da99863cf1'
const APP_EMAIL = '11111111-1111-4111-8111-111111111111'
const graph = (extra: Record<string, string> = {}) =>
  configTeste({
    EMAIL_TRANSPORTE: 'graph',
    EMAIL_REMETENTE: 'No-Reply@GrupoEverblue.com.br',
    GRAPH_MAIL_TENANT_ID: TENANT,
    GRAPH_MAIL_CLIENT_ID: APP_EMAIL,
    GRAPH_MAIL_CLIENT_SECRET: 'segredo-do-email',
    ...extra,
  })
const mensagem = { para: ['waldomiro.silva@grupoeverblue.com.br'], assunto: 'Teste', html: '<p>t</p>', texto: 't', anexos: [{ nome: 'mapa.pdf', tipo: 'application/pdf', conteudo: Buffer.from('%PDF') }] }

let restaurar: (() => void) | null = null
afterEach(() => {
  restaurar?.()
  restaurar = null
})

describe('configuração do e-mail (GRAPH_MAIL_*)', () => {
  it('usa a App Registration de e-mail, não a do login', () => {
    const c = graph()
    expect(c.email.graph).toMatchObject({ tenantId: TENANT, clientId: APP_EMAIL, clientSecret: 'segredo-do-email', origem: 'GRAPH_MAIL' })
    expect(c.email.remetente).toBe('no-reply@grupoeverblue.com.br')
    expect(criarEnviadorEmail(c).descricao).toContain('GRAPH_MAIL')
  })

  it('sem GRAPH_MAIL_* cai nas credenciais ENTRA_*', () => {
    const c = configTeste({ ENTRA_TENANT_ID: TENANT, ENTRA_CLIENT_ID: APP_EMAIL, EMAIL_TRANSPORTE: 'graph', EMAIL_REMETENTE: 'no-reply@grupoeverblue.com.br' })
    expect(c.email.graph.origem).toBe('ENTRA')
    expect(c.email.graph.clientId).toBe(APP_EMAIL)
  })

  it('recusa GRAPH_MAIL_* preenchido pela metade', () => {
    expect(() => graph({ GRAPH_MAIL_CLIENT_SECRET: '' })).toThrow(/vão juntos/)
  })

  it('recusa graph sem credencial válida ou com ID fora do formato GUID', () => {
    expect(() => graph({ GRAPH_MAIL_CLIENT_ID: 'nao-e-guid' })).toThrow(/GUID/)
    expect(() => graph({ EMAIL_REMETENTE: '' })).toThrow(/EMAIL_REMETENTE/)
  })

  it('transporte desligado não exige nada', () => {
    expect(() => configTeste({ EMAIL_TRANSPORTE: 'desligado' })).not.toThrow()
  })
})

describe('envio pelo Graph', () => {
  it('pede token com as credenciais de e-mail e envia como a caixa remetente (202)', async () => {
    const f = simularFetch((url) => (url.includes('/oauth2/') ? json(200, { access_token: 'tok', expires_in: 3600 }) : new Response(null, { status: 202 })))
    restaurar = f.restaurar
    await new EnvioGraph(graph().email).enviar(mensagem)
    expect(f.chamadas[0]!.url).toBe(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`)
    const corpoToken = new URLSearchParams(String(f.chamadas[0]!.init!.body))
    expect(corpoToken.get('client_id')).toBe(APP_EMAIL)
    expect(corpoToken.get('grant_type')).toBe('client_credentials')
    expect(f.chamadas[1]!.url).toBe('https://graph.microsoft.com/v1.0/users/no-reply%40grupoeverblue.com.br/sendMail')
    const corpo = JSON.parse(String(f.chamadas[1]!.init!.body))
    expect(corpo.message.attachments[0]).toMatchObject({ name: 'mapa.pdf', contentBytes: Buffer.from('%PDF').toString('base64') })
  })

  it('403 do Graph diz o que falta (Mail.Send / política da caixa) sem ecoar o corpo', async () => {
    const f = simularFetch((url) =>
      url.includes('/oauth2/') ? json(200, { access_token: 'tok', expires_in: 3600 }) : json(403, { error: { code: 'ErrorAccessDenied', message: 'Access is denied. segredo-interno' } }),
    )
    restaurar = f.restaurar
    const erro = await new EnvioGraph(graph().email).enviar(mensagem).catch((e: Error) => e)
    expect((erro as Error).message).toMatch(/HTTP 403, ErrorAccessDenied — falta a permissão Mail.Send/)
    expect((erro as Error).message).not.toContain('segredo-interno')
  })

  it('segredo inválido no Entra aparece com o código AADSTS', async () => {
    const f = simularFetch(() => json(401, { error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.' }))
    restaurar = f.restaurar
    const erro = await new EnvioGraph(graph().email).enviar(mensagem).catch((e: Error) => e)
    expect((erro as Error).message).toMatch(/HTTP 401, AADSTS7000215 — segredo do cliente inválido/)
  })
})
