import { CAMPOS_IMPORTACAO } from '@monitoramento/dominio'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { comporDependencias, type Dependencias } from '../src/composicao'
import { construirServidor } from '../src/http/servidor'
import { ArmazenamentoMemoria } from '../src/infra/armazenamento'
import type { Banco } from '../src/infra/banco'
import { carregarDemonstracao } from '../src/infra/cargaDemonstracao'
import { FonteFotoNenhuma } from '../src/identidade/fontesFoto'
import { gerarHashSenha } from '../src/seguranca/senha'
import { configTeste } from './apoio'
import { bancoLimpo, temBanco } from './banco'

describe.skipIf(!temBanco)('API HTTP', () => {
  let banco: Banco
  let deps: Dependencias
  let app: FastifyInstance
  let armazenamento: ArmazenamentoMemoria
  const ORIGEM = 'https://monitoramento.teste'

  beforeEach(async () => {
    banco = await bancoLimpo()
    await carregarDemonstracao(banco, () => {})
    armazenamento = new ArmazenamentoMemoria()
    // Sem Intranet configurada: a revalidação não se aplica a estes testes de rota.
    deps = comporDependencias(configTeste({ DIRETORIO_URL: '', DIRETORIO_INTEGRATION_SECRET: '' }), { banco, armazenamento, fonteFoto: new FonteFotoNenhuma() })
    app = await construirServidor(deps, { log: false })
  })
  afterEach(async () => {
    await app.close()
    await banco.encerrar()
  })

  async function sessaoCom(perfil: 'leitor' | 'analista' | 'admin'): Promise<string> {
    const { rows } = await banco.pool.query(
      `INSERT INTO usuario (email, nome, perfil, origem, senha_hash, motivo_acesso_local) VALUES ($1, $2, $3, 'local', $4, 'teste') RETURNING id`,
      [`${perfil}@grupoeverblue.com.br`, `Pessoa ${perfil}`, perfil, await gerarHashSenha('Senha-Forte-2026!')],
    )
    return `emon_sessao=${await deps.sessao.emitir(rows[0].id)}`
  }

  it('saúde responde sem sessão; negócio exige sessão', async () => {
    expect((await app.inject({ url: '/api/health' })).json()).toMatchObject({ status: 'ok', banco: 'ok' })
    const r = await app.inject({ url: '/api/v1/dashboard/kpis' })
    expect(r.statusCode).toBe(401)
    expect(r.headers['content-type']).toContain('application/problem+json')
  })

  it('login de emergência: senha errada não revela a conta; certa abre sessão auditada como exceção', async () => {
    await sessaoCom('admin')
    const errado = await app.inject({ method: 'POST', url: '/api/v1/autenticacao/emergencia', headers: { origin: ORIGEM }, payload: { email: 'admin@grupoeverblue.com.br', senha: 'x' } })
    expect(errado.statusCode).toBe(401)
    expect(errado.json().detail).toBe('E-mail ou senha inválidos.')
    const certo = await app.inject({ method: 'POST', url: '/api/v1/autenticacao/emergencia', headers: { origin: ORIGEM }, payload: { email: 'admin@grupoeverblue.com.br', senha: 'Senha-Forte-2026!' } })
    expect(certo.statusCode).toBe(200)
    expect(String(certo.headers['set-cookie'])).toMatch(/emon_sessao=.*HttpOnly/)
    const { rows } = await banco.pool.query(`SELECT resultado FROM auditoria WHERE acao = 'login.emergencia' ORDER BY id`)
    expect(rows.map((r) => r.resultado)).toEqual(['negado', 'excecao'])
  })

  it('leitor lê, mas não altera — e a negativa fica na auditoria', async () => {
    const cookie = await sessaoCom('leitor')
    expect((await app.inject({ url: '/api/v1/dashboard/kpis', headers: { cookie } })).statusCode).toBe(200)
    const clienteId = (await banco.pool.query('SELECT id FROM cliente LIMIT 1')).rows[0].id
    const r = await app.inject({ method: 'PUT', url: `/api/v1/checklist/${clienteId}/2026-09-28/VENCIDOS`, headers: { cookie, origin: ORIGEM }, payload: { parecer: 'x' } })
    expect(r.statusCode).toBe(403)
    expect((await banco.pool.query(`SELECT count(*)::int n FROM auditoria WHERE acao = 'acesso.negado'`)).rows[0].n).toBe(1)
  })

  it('requisição de outra origem é recusada (CSRF)', async () => {
    const cookie = await sessaoCom('admin')
    const r = await app.inject({ method: 'POST', url: '/api/v1/comites/decisoes', headers: { cookie, origin: 'https://site-malicioso.example' }, payload: {} })
    expect(r.statusCode).toBe(403)
    expect(r.json().codigo).toBe('origem_invalida')
  })

  it('entrada inválida é recusada com mensagem clara', async () => {
    const cookie = await sessaoCom('admin')
    const r = await app.inject({ url: `/api/v1/dashboard/risco-por-dimensao?dimensao=senha`, headers: { cookie } })
    expect(r.statusCode).toBe(400)
    const s = await app.inject({ url: `/api/v1/clientes/enriquecidos?status=QUALQUER`, headers: { cookie } })
    expect(s.statusCode).toBe(400)
  })

  it('checklist grava o autor da sessão, não o texto vindo da tela', async () => {
    const cookie = await sessaoCom('analista')
    const clienteId = (await banco.pool.query('SELECT id FROM cliente LIMIT 1')).rows[0].id
    const r = await app.inject({
      method: 'PUT',
      url: `/api/v1/checklist/${clienteId}/2026-09-28/VENCIDOS`,
      headers: { cookie, origin: ORIGEM },
      payload: { parecer: 'Vencido sob controle', gravidade: 'AMARELO', gravidadeManual: true, atualizadoPor: 'Outra Pessoa' },
    })
    expect(r.statusCode).toBe(204)
    const item = (await app.inject({ url: `/api/v1/checklist/${clienteId}/2026-09-28`, headers: { cookie } })).json().find((i: { item: string }) => i.item === 'VENCIDOS')
    expect(item).toMatchObject({ parecer: 'Vencido sob controle', gravidade: 'AMARELO', persistido: true, atualizadoPor: 'Pessoa analista' })
  })

  it('decisão do comitê cria plano + evento juntos; ata sai uma vez só', async () => {
    const cookie = await sessaoCom('analista')
    const clienteId = (await banco.pool.query(`SELECT id FROM cliente WHERE status = 'MONITORAMENTO' LIMIT 1`)).rows[0].id
    const proximo = (await app.inject({ url: '/api/v1/comites/proximo', headers: { cookie } })).json()
    const d = await app.inject({ method: 'POST', url: '/api/v1/comites/decisoes', headers: { cookie, origin: ORIGEM }, payload: { clienteId, decisao: 'Reduzir limite', plano: 'Renegociar', prazo: '2026-10-30', responsavel: 'Gerente X' } })
    expect(d.statusCode).toBe(200)
    expect(d.json()).toMatchObject({ comiteOrigemId: proximo.id, responsavel: 'Gerente X' })
    const ev = (await banco.pool.query(`SELECT usuario FROM evento_historico WHERE cliente_id = $1 AND tipo = 'DECISAO_COMITE' ORDER BY data DESC LIMIT 1`, [clienteId])).rows[0]
    expect(ev.usuario).toBe('Pessoa analista')
    const ata = await app.inject({ method: 'POST', url: `/api/v1/comites/${proximo.id}/ata`, headers: { cookie, origin: ORIGEM } })
    expect(ata.statusCode).toBe(200)
    expect(ata.json().pendencias.length).toBeGreaterThan(0)
    const denovo = await app.inject({ method: 'POST', url: `/api/v1/comites/${proximo.id}/ata`, headers: { cookie, origin: ORIGEM } })
    expect(denovo.statusCode).toBe(409)
    const novoProximo = (await app.inject({ url: '/api/v1/comites/proximo', headers: { cookie } })).json()
    expect(novoProximo.id).not.toBe(proximo.id)
  })

  it('importação: original no bucket, prévia, confirmação única e histórico imutável', async () => {
    const cookie = await sessaoCom('analista')
    const cabecalho = CAMPOS_IMPORTACAO.map((c) => c.coluna)
    const existente = (await banco.pool.query(`SELECT c.nome, c.cnpj FROM cliente c LIMIT 1`)).rows[0]
    const valores = (nome: string, cnpj: string) =>
      cabecalho.map((c) =>
        ({ Cliente: nome, CNPJ: cnpj, 'Status (NORMAL, MONITORAMENTO, SAIDA_DE_RISCO, JURIDICO)': 'MONITORAMENTO', 'Status da Proposta (EM_ANALISE, APROVADA, VENCIDA, REPROVADA)': 'APROVADA', 'Produtos (separados por ;)': 'Desconto de Duplicatas', 'Grupo Econômico': 'Grupo Novo', Gerente: 'Gerente Novo', 'Plataforma Comercial': 'Plataforma Nova', Setor: 'Serviços', 'Ramo de Atividade': 'Consultoria' })[c] ?? '100',
      )
    const csv = [cabecalho, valores(existente.nome, existente.cnpj), valores('Cliente Novo S.A.', '99.999.999/0001-99')].map((l) => l.map((v) => `"${v}"`).join(';')).join('\n')
    const limite = '----limite'
    const corpo = `--${limite}\r\nContent-Disposition: form-data; name="semanaRef"\r\n\r\n2026-10-05\r\n--${limite}\r\nContent-Disposition: form-data; name="arquivo"; filename="posicao.csv"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n--${limite}--\r\n`
    const envio = await app.inject({ method: 'POST', url: '/api/v1/importacoes', headers: { cookie, origin: ORIGEM, 'content-type': `multipart/form-data; boundary=${limite}` }, payload: corpo })
    expect(envio.statusCode).toBe(200)
    const previa = envio.json()
    expect(previa.totais).toMatchObject({ clientesNovos: 1, clientesAtualizados: 1 })
    expect([...armazenamento.objetos.keys()][0]).toMatch(/^importados\/planilhas\/\d{4}\/\d{2}\/[0-9a-f-]+\.csv$/)

    const ok = await app.inject({ method: 'POST', url: `/api/v1/importacoes/${previa.importacaoId}/confirmar`, headers: { cookie, origin: ORIGEM }, payload: { semanaRef: '2026-10-05' } })
    expect(ok.json()).toMatchObject({ snapshotsGravados: 2, clientesCriados: 1 })
    const dup = await app.inject({ method: 'POST', url: `/api/v1/importacoes/${previa.importacaoId}/confirmar`, headers: { cookie, origin: ORIGEM }, payload: { semanaRef: '2026-10-05' } })
    expect(dup.statusCode).toBe(409)
    await expect(banco.pool.query(`UPDATE snapshot_semanal SET risco_cliente = 0`)).rejects.toThrow(/append-only/)
    await expect(banco.pool.query(`DELETE FROM auditoria`)).rejects.toThrow(/append-only/)
  })

  it('arquivo que não é planilha é recusado pelo conteúdo', async () => {
    const cookie = await sessaoCom('analista')
    const limite = '----b'
    const corpo = Buffer.concat([
      Buffer.from(`--${limite}\r\nContent-Disposition: form-data; name="semanaRef"\r\n\r\n2026-10-05\r\n--${limite}\r\nContent-Disposition: form-data; name="arquivo"; filename="planilha.xlsx"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01]),
      Buffer.from(`\r\n--${limite}--\r\n`),
    ])
    const r = await app.inject({ method: 'POST', url: '/api/v1/importacoes', headers: { cookie, origin: ORIGEM, 'content-type': `multipart/form-data; boundary=${limite}` }, payload: corpo })
    expect(r.statusCode).toBe(415)
  })
})
