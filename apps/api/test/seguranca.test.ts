import { describe, expect, it } from 'vitest'
import { Cofre } from '../src/seguranca/cofre'
import { EstadoAssinado } from '../src/seguranca/estadoAssinado'
import { EmissorSessao } from '../src/seguranca/sessao'
import { gerarHashSenha, conferirSenha, senhaAceitavel } from '../src/seguranca/senha'
import { configTeste } from './apoio'

describe('cofre do token delegado', () => {
  it('cifra e decifra; outra chave não abre', () => {
    const cofre = new Cofre('x'.repeat(40))
    const cifrado = cofre.cifrar('token-delegado')
    expect(cifrado).not.toContain('token-delegado')
    expect(cofre.decifrar(cifrado)).toBe('token-delegado')
    expect(new Cofre('y'.repeat(40)).decifrar(cifrado)).toBeNull()
  })
  it('conteúdo adulterado não abre (GCM autenticado)', () => {
    const cofre = new Cofre('x'.repeat(40))
    const partes = cofre.cifrar('abc').split('.')
    partes[2] = Buffer.from('xyz').toString('base64url')
    expect(cofre.decifrar(partes.join('.'))).toBeNull()
    expect(cofre.decifrar(null)).toBeNull()
  })
})

describe('estado assinado do OIDC', () => {
  it('rejeita assinatura alterada e estado vencido', () => {
    const e = new EstadoAssinado('segredo'.repeat(6), 'oidc')
    const valor = e.assinar({ state: 's1' })
    expect(e.ler<{ state: string }>(valor, 600)?.state).toBe('s1')
    const [corpo] = valor.split('.')
    const forjado = `${Buffer.from(JSON.stringify({ state: 'outro', em: Math.floor(Date.now() / 1000) })).toString('base64url')}.${valor.split('.')[1]}`
    expect(e.ler(forjado, 600)).toBeNull()
    expect(e.ler(`${corpo}.xx`, 600)).toBeNull()
    expect(e.ler(valor, -1)).toBeNull()
  })
})

describe('sessão', () => {
  it('emite e lê; segredo diferente não valida', async () => {
    const s = new EmissorSessao('k'.repeat(64), 8)
    const token = await s.emitir('9b2f1c3e-0000-4000-8000-000000000001')
    expect(await s.ler(token)).toBe('9b2f1c3e-0000-4000-8000-000000000001')
    expect(await new EmissorSessao('z'.repeat(64), 8).ler(token)).toBeNull()
    expect(await s.ler('lixo')).toBeNull()
  })
})

describe('senha da conta de emergência', () => {
  it('argon2 confere e recusa senha fraca', async () => {
    const h = await gerarHashSenha('Senha-Forte-2026!')
    expect(await conferirSenha(h, 'Senha-Forte-2026!')).toBe(true)
    expect(await conferirSenha(h, 'errada')).toBe(false)
    expect(senhaAceitavel('curta')).not.toBeNull()
    expect(senhaAceitavel('somenteminusculas')).not.toBeNull()
    expect(senhaAceitavel('Senha-Forte-2026!')).toBeNull()
  })
})

describe('configuração', () => {
  it('deriva o redirect e liga a autorização interna como a IA Everblue', () => {
    const cfg = configTeste()
    expect(cfg.entra.redirectUri).toBe('https://monitoramento.teste/oauth/oidc/callback')
    expect(cfg.diretorio.clientId).toBe('22222222-2222-4222-8222-222222222222')
    expect(cfg.diretorio.autorizacaoPeloMe).toBe(true)
  })
  it('autorização interna exige URL, Client ID e chave forte', () => {
    expect(configTeste({ DIRETORIO_URL: '' }).diretorio.autorizacaoPeloMe).toBe(false)
    expect(configTeste({ DIRETORIO_INTEGRATION_SECRET: '' }).diretorio.autorizacaoPeloMe).toBe(false)
    expect(() => configTeste({ DIRETORIO_INTEGRATION_SECRET: 'curta' })).toThrow(/DIRETORIO_INTEGRATION_SECRET/)
    expect(() => configTeste({ DIRETORIO_CLIENT_ID: '' })).toThrow(/GUID/)
  })
  it('sem DIRETORIO_CLIENT_ID usa o ENTRA_CLIENT_ID, em minúsculas', () => {
    const cfg = configTeste({ DIRETORIO_CLIENT_ID: '', ENTRA_CLIENT_ID: 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE' })
    expect(cfg.diretorio.clientId).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
  })
  it('.env antigo com DIRETORIO_AUDIENCE continua subindo', () => {
    expect(configTeste({ DIRETORIO_AUDIENCE: 'api-antiga', DIRETORIO_ESCOPO: 'api://x/access_as_user' }).diretorio.autorizacaoPeloMe).toBe(true)
  })
  it('produção exige cookie seguro', () => {
    expect(() => configTeste({ AMBIENTE: 'producao' })).toThrow(/COOKIE_SEGURO/)
  })
  it('lista tudo o que falta', () => {
    expect(() => configTeste({ SESSAO_SEGREDO: 'curto' })).toThrow(/SESSAO_SEGREDO/)
  })
  it('mapa de perfil ignora perfil inválido', () => {
    const cfg = configTeste({ ENTRA_MAPA_PERFIL: 'GUID-A=admin;guid-b=chefe;guid-c=analista' })
    expect(cfg.entra.mapaPerfil.get('guid-a')).toBe('admin')
    expect(cfg.entra.mapaPerfil.has('guid-b')).toBe(false)
    expect(cfg.entra.mapaPerfil.get('guid-c')).toBe('analista')
  })
})
