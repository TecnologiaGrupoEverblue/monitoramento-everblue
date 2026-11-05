/**
 * Foto do Bitfin, Mapa de Garantias e Parâmetros só para Administrador,
 * Diretoria e Gerente (perfil de acesso da Intranet) — decisão de 30/10/2026.
 * O bloqueio é no servidor; a tela só esconde o menu.
 */
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { comporDependencias } from '../src/composicao'
import { construirServidor } from '../src/http/servidor'
import { ArmazenamentoMemoria } from '../src/infra/armazenamento'
import { FonteFotoNenhuma } from '../src/identidade/fontesFoto'
import { configTeste } from './apoio'
import { bancoLimpo, temBanco } from './banco'

const ROTAS_GESTAO = [
  '/api/v1/foto-bitfin/situacao',
  '/api/v1/foto-bitfin/execucoes',
  '/api/v1/foto-bitfin/agendamento',
  '/api/v1/mapa-garantias',
  '/api/v1/mapa-garantias/envios',
  '/api/v1/configuracoes/alertas',
  '/api/v1/configuracoes/regras',
]

describe.skipIf(!temBanco)('acesso às áreas de gestão pelo perfil da Intranet', () => {
  it('Administrador, Diretoria e Gerente entram; Analista, RH, Suporte e sem perfil não', async () => {
    const banco = await bancoLimpo()
    const deps = comporDependencias(configTeste({ DIRETORIO_URL: 'https://intranet.teste' }), { banco, armazenamento: new ArmazenamentoMemoria(), fonteFoto: new FonteFotoNenhuma() })
    const app = await construirServidor(deps)
    try {
      const criar = async (nivel: string | null, origem: 'entra' | 'local' = 'entra', perfil = 'leitor') => {
        const { rows } = await banco.pool.query(
          `INSERT INTO usuario (email, nome, perfil, origem, entra_oid, autorizado_em, nivel_acesso_codigo, nivel_acesso_nome)
           VALUES ($1, 'Pessoa', $2, $3, $4, now(), $5, $5) RETURNING id`,
          [`${randomUUID()}@grupoeverblue.com.br`, perfil, origem, origem === 'entra' ? randomUUID() : null, nivel],
        )
        return `emon_sessao=${await deps.sessao.emitir(rows[0].id)}`
      }
      const status = async (cookie: string, url: string) => (await app.inject({ method: 'GET', url, headers: { cookie } })).statusCode

      for (const nivel of ['admin', 'director', 'manager']) {
        const cookie = await criar(nivel)
        for (const url of ROTAS_GESTAO) expect(await status(cookie, url), `${nivel} ${url}`).toBe(200)
        const s = (await app.inject({ method: 'GET', url: '/api/v1/sessao', headers: { cookie } })).json()
        expect(s.acessoGestao).toBe(true)
        expect(s.nivelAcesso.codigo).toBe(nivel)
      }
      for (const nivel of ['user', 'hr', 'support', null]) {
        const cookie = await criar(nivel, 'entra', 'admin') // nem o perfil interno admin abre: quem decide é a Intranet
        for (const url of ROTAS_GESTAO) {
          const r = await app.inject({ method: 'GET', url, headers: { cookie } })
          expect(r.statusCode, `${nivel} ${url}`).toBe(403)
          expect(r.json().codigo).toBe('acesso_gestao')
        }
        expect((await app.inject({ method: 'GET', url: '/api/v1/sessao', headers: { cookie } })).json().acessoGestao).toBe(false)
        // O resto do sistema continua aberto, inclusive os dados do Bitfin no checklist do cliente.
        expect(await status(cookie, '/api/v1/cadastros/gerentes')).toBe(200)
        expect(await status(cookie, `/api/v1/clientes/${randomUUID()}/bitfin`)).not.toBe(403)
      }
      const negadas = await banco.pool.query(`SELECT count(*)::int AS n FROM auditoria WHERE acao = 'acesso.negado' AND motivo LIKE 'perfil da Intranet%'`)
      expect(negadas.rows[0].n).toBe(4 * ROTAS_GESTAO.length)

      // Conta de emergência local com perfil admin: acesso de quando a Intranet está fora.
      const emergencia = await criar(null, 'local', 'admin')
      expect(await status(emergencia, '/api/v1/foto-bitfin/situacao')).toBe(200)
      const localAnalista = await criar(null, 'local', 'analista')
      expect(await status(localAnalista, '/api/v1/foto-bitfin/situacao')).toBe(403)
    } finally {
      await app.close()
      await banco.encerrar()
    }
  })

  it('a lista de perfis é configurável e validada', () => {
    expect(configTeste().niveisAcessoGestao).toEqual(['admin', 'director', 'manager'])
    expect(configTeste({ NIVEIS_ACESSO_GESTAO: 'admin, Director' }).niveisAcessoGestao).toEqual(['admin', 'director'])
    expect(() => configTeste({ NIVEIS_ACESSO_GESTAO: ' , ' })).toThrow(/vazio/)
    expect(() => configTeste({ NIVEIS_ACESSO_GESTAO: 'admin;drop' })).toThrow(/inválido/)
  })
})
