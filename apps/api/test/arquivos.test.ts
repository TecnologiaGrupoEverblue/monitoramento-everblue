import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { comporDependencias, type Dependencias } from '../src/composicao'
import { construirServidor } from '../src/http/servidor'
import { ArmazenamentoMemoria } from '../src/infra/armazenamento'
import type { Banco } from '../src/infra/banco'
import { carregarDemonstracao } from '../src/infra/cargaDemonstracao'
import { FonteFotoNenhuma } from '../src/identidade/fontesFoto'
import { gerarCsv } from '../src/servicos/servicoExportacao'
import { slugCategoria } from '../src/servicos/servicoArquivos'
import { detectarTipo } from '../src/servicos/tipoArquivo'
import { configTeste } from './apoio'
import { bancoLimpo, temBanco } from './banco'

describe('tipo real, CSV e chave', () => {
  it('detecta o tipo pelo conteúdo, não pela extensão', () => {
    expect(detectarTipo(Buffer.from('%PDF-1.7 ...'), 'contrato.pdf')).toEqual({ mime: 'application/pdf', divergente: false })
    expect(detectarTipo(Buffer.from('MZ\x90\x00'), 'contrato.pdf')).toEqual({ mime: 'application/x-msdownload', divergente: true })
    expect(detectarTipo(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2]), 'posicao.xlsx').mime).toContain('spreadsheetml')
    expect(detectarTipo(Buffer.from('a;b\n1;2'), 'dados.csv').mime).toBe('text/csv')
    expect(detectarTipo(Buffer.from([0, 1, 2, 3, 0, 9]), 'x.bin').mime).toBe('application/octet-stream')
  })
  it('CSV neutraliza fórmula e usa vírgula decimal', () => {
    const csv = gerarCsv(['a', 'b'], [['=HYPERLINK("x")', 1234.5]]).toString('utf8')
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain(`"'=HYPERLINK(""x"")";1234,5`)
  })
  it('categoria vira prefixo seguro', () => {
    expect(slugCategoria('Atas / Comitê 2026')).toBe('atas-comite-2026')
    expect(slugCategoria('../../etc')).toBe('etc')
  })
})

describe.skipIf(!temBanco)('Central de Arquivos — ciclo de vida', () => {
  let banco: Banco
  let deps: Dependencias
  let app: FastifyInstance
  let armazenamento: ArmazenamentoMemoria
  const ORIGEM = 'https://monitoramento.teste'
  const sessoes: Record<string, string> = {}

  async function montar(extra: Record<string, string> = {}) {
    armazenamento = new ArmazenamentoMemoria()
    deps = comporDependencias(configTeste({ DIRETORIO_URL: '', DIRETORIO_INTEGRATION_SECRET: '', ...extra }), { banco, armazenamento, fonteFoto: new FonteFotoNenhuma() })
    app = await construirServidor(deps, { log: false })
    for (const perfil of ['leitor', 'analista', 'admin'] as const) {
      const { rows } = await banco.pool.query(
        `INSERT INTO usuario (email, nome, perfil, origem) VALUES ($1, $2, $3, 'local')
         ON CONFLICT ((lower(email))) DO UPDATE SET perfil = EXCLUDED.perfil RETURNING id`,
        [`${perfil}@grupoeverblue.com.br`, `Pessoa ${perfil}`, perfil],
      )
      sessoes[perfil] = `emon_sessao=${await deps.sessao.emitir(rows[0].id)}`
    }
  }

  beforeEach(async () => {
    banco = await bancoLimpo()
    await carregarDemonstracao(banco, () => {})
    await montar()
  })
  afterEach(async () => {
    await app.close()
    await banco.encerrar()
  })

  async function multipart(campos: Record<string, string>, nome: string, conteudo: Buffer) {
    const form = new FormData()
    for (const [k, v] of Object.entries(campos)) form.append(k, v)
    form.append('arquivo', new Blob([conteudo]), nome)
    const r = new Response(form)
    return { payload: Buffer.from(await r.arrayBuffer()), tipo: r.headers.get('content-type')! }
  }

  async function enviar(perfil: string, url: string, campos: Record<string, string>, nome: string, conteudo: Buffer) {
    const m = await multipart(campos, nome, conteudo)
    return app.inject({ method: 'POST', url, headers: { cookie: sessoes[perfil], origin: ORIGEM, 'content-type': m.tipo }, payload: m.payload })
  }
  const get = (perfil: string, url: string) => app.inject({ url, headers: { cookie: sessoes[perfil] } })
  const post = (perfil: string, url: string, payload: unknown = {}) =>
    app.inject({ method: 'POST', url, headers: { cookie: sessoes[perfil], origin: ORIGEM }, payload: payload as object })

  it('envia QUALQUER tipo, versiona, restaura versão e baixa cada versão', async () => {
    const leitorNaoEnvia = await enviar('leitor', '/api/v1/arquivos', {}, 'a.txt', Buffer.from('x'))
    expect(leitorNaoEnvia.statusCode).toBe(403)

    const v1 = Buffer.from('MZ-executavel-de-teste')
    const r = await enviar('analista', '/api/v1/arquivos', { finalidade: 'anexo', categoria: 'Evidências', descricao: 'Contrato', tags: '{"cliente":"c1"}', recursoTipo: 'cliente', recursoId: 'c1' }, 'ferramenta.exe', v1)
    expect(r.statusCode).toBe(201)
    const arquivo = r.json()
    expect(arquivo).toMatchObject({ finalidade: 'anexo', categoria: 'Evidências', situacao: 'ATIVO', versaoAtual: 1, mime: 'application/x-msdownload', tamanhoBytes: v1.length, tags: { cliente: 'c1' }, recursoTipo: 'cliente' })
    expect(arquivo).not.toHaveProperty('chaveObjeto')

    const v2 = Buffer.from('%PDF-1.7 segunda versão')
    const r2 = await enviar('analista', `/api/v1/arquivos/${arquivo.id}/versoes`, { comentario: 'assinado' }, 'contrato.pdf', v2)
    expect(r2.statusCode).toBe(201)
    expect(r2.json()).toMatchObject({ versaoAtual: 2, mime: 'application/pdf', nomeOriginal: 'contrato.pdf' })

    const b1 = await get('leitor', `/api/v1/arquivos/${arquivo.id}/conteudo?versao=1`)
    expect(b1.statusCode).toBe(200)
    expect(b1.rawPayload.equals(v1)).toBe(true)
    expect(b1.headers['content-disposition']).toMatch(/^attachment; filename="ferramenta.exe"/)
    expect(b1.headers['x-content-type-options']).toBe('nosniff')
    const atual = await get('leitor', `/api/v1/arquivos/${arquivo.id}/conteudo?visualizar=1`)
    expect(atual.rawPayload.equals(v2)).toBe(true)
    expect(atual.headers['content-disposition']).toMatch(/^inline/)

    const restaurada = await post('analista', `/api/v1/arquivos/${arquivo.id}/versoes/1/restaurar`)
    expect(restaurada.json()).toMatchObject({ versaoAtual: 3, nomeOriginal: 'ferramenta.exe' })
    expect((await get('leitor', `/api/v1/arquivos/${arquivo.id}/conteudo`)).rawPayload.equals(v1)).toBe(true)
    expect((await get('leitor', `/api/v1/arquivos/${arquivo.id}/versoes`)).json().map((v: { numero: number }) => v.numero)).toEqual([3, 2, 1])
  })

  it('arquiva, exclui logicamente, reativa e expurga com trilha completa', async () => {
    const r = await enviar('analista', '/api/v1/arquivos', { finalidade: 'processado', categoria: 'atas' }, 'ata.pdf', Buffer.from('%PDF-ata'))
    const { id } = r.json()
    await enviar('analista', `/api/v1/arquivos/${id}/versoes`, {}, 'ata-v2.pdf', Buffer.from('%PDF-ata-2'))

    expect((await post('analista', `/api/v1/arquivos/${id}/arquivar`)).json().situacao).toBe('ARQUIVADO')
    expect((await get('leitor', '/api/v1/arquivos')).json().itens.map((a: { id: string }) => a.id)).toContain(id)

    expect((await post('analista', `/api/v1/arquivos/${id}/excluir`, { motivo: 'x' })).statusCode).toBe(400)
    const excluido = await post('analista', `/api/v1/arquivos/${id}/excluir`, { motivo: 'Enviado no cliente errado' })
    expect(excluido.json()).toMatchObject({ situacao: 'EXCLUIDO', motivoExclusao: 'Enviado no cliente errado' })
    expect((await get('leitor', '/api/v1/arquivos')).json().itens.map((a: { id: string }) => a.id)).not.toContain(id)
    expect((await get('leitor', '/api/v1/arquivos?situacao=EXCLUIDO')).json().total).toBe(1)
    // Excluído logicamente continua recuperável — conteúdo intacto.
    expect((await get('leitor', `/api/v1/arquivos/${id}/conteudo`)).statusCode).toBe(200)
    expect((await post('analista', `/api/v1/arquivos/${id}/reativar`)).json().situacao).toBe('ATIVO')

    // Retenção vigente impede o expurgo; só admin expurga.
    const patch = await app.inject({ method: 'PATCH', url: `/api/v1/arquivos/${id}`, headers: { cookie: sessoes.analista, origin: ORIGEM }, payload: { retencaoAte: '2999-12-31', tags: { lote: '7' } } })
    expect(patch.json()).toMatchObject({ retencaoAte: '2999-12-31', tags: { lote: '7' } })
    expect((await post('analista', `/api/v1/arquivos/${id}/expurgar`, { motivo: 'Pedido do titular (LGPD)' })).statusCode).toBe(403)
    expect((await post('admin', `/api/v1/arquivos/${id}/expurgar`, { motivo: 'Pedido do titular (LGPD)' })).json().codigo).toBe('em_retencao')
    await app.inject({ method: 'PATCH', url: `/api/v1/arquivos/${id}`, headers: { cookie: sessoes.analista, origin: ORIGEM }, payload: { retencaoAte: null } })

    const antes = armazenamento.objetos.size
    const expurgado = await post('admin', `/api/v1/arquivos/${id}/expurgar`, { motivo: 'Pedido do titular (LGPD)' })
    expect(expurgado.json().situacao).toBe('EXPURGADO')
    expect(armazenamento.objetos.size).toBe(antes - 2) // as duas versões saíram do bucket
    expect((await get('leitor', `/api/v1/arquivos/${id}/conteudo`)).statusCode).toBe(410)
    expect((await post('analista', `/api/v1/arquivos/${id}/reativar`)).statusCode).toBe(409)

    const acoes = (await get('leitor', `/api/v1/arquivos/${id}/eventos`)).json().map((e: { acao: string }) => e.acao).reverse()
    expect(acoes).toEqual(['enviado', 'nova_versao', 'arquivado', 'excluido', 'baixado', 'reativado', 'metadados_alterados', 'metadados_alterados', 'expurgado'])
    await expect(banco.pool.query('UPDATE arquivo_versao SET comentario = $1', ['x'])).rejects.toThrow(/append-only/)
    await expect(banco.pool.query('DELETE FROM arquivo_evento')).rejects.toThrow(/append-only/)
    const { rows } = await banco.pool.query(`SELECT resultado, motivo FROM auditoria WHERE acao = 'arquivo.expurgado'`)
    expect(rows).toEqual([{ resultado: 'sucesso', motivo: 'Pedido do titular (LGPD)' }])
  })

  it('exportação é gerada, guardada no MinIO e entregue pela Central de Arquivos', async () => {
    expect((await get('leitor', '/api/v1/exportacoes')).json().map((e: { chave: string }) => e.chave)).toEqual(['carteira', 'planos-de-acao'])
    const r = await post('analista', '/api/v1/exportacoes/carteira', { status: 'MONITORAMENTO' })
    expect(r.statusCode).toBe(201)
    const arq = r.json()
    expect(arq).toMatchObject({ finalidade: 'exportado', categoria: 'carteira', mime: 'text/csv', tags: { exportacao: 'carteira', status: 'MONITORAMENTO' } })
    const csv = (await get('leitor', `/api/v1/arquivos/${arq.id}/conteudo`)).body
    expect(csv.split('\r\n')[0]).toContain('Cliente;CNPJ;Grupo econômico')
    expect((await get('leitor', '/api/v1/arquivos?finalidade=exportado')).json().total).toBe(1)
    expect((await post('analista', '/api/v1/exportacoes/nao-existe')).statusCode).toBe(404)
    expect((await post('analista', '/api/v1/exportacoes/carteira', { status: 'INVENTADO' })).statusCode).toBe(400)
  })

  it('planilha importada entra no ciclo de vida, vinculada à importação', async () => {
    const cabecalho = (await import('@monitoramento/dominio')).CAMPOS_IMPORTACAO.map((c) => c.coluna)
    const csv = [cabecalho.map((c) => `"${c}"`).join(';')].join('\n')
    const m = await multipart({ semanaRef: '2026-09-21' }, 'posicao.csv', Buffer.from(csv))
    const r = await app.inject({ method: 'POST', url: '/api/v1/importacoes', headers: { cookie: sessoes.analista, origin: ORIGEM, 'content-type': m.tipo }, payload: m.payload })
    expect(r.statusCode).toBe(200)
    const lista = (await get('leitor', '/api/v1/arquivos?finalidade=importado')).json()
    expect(lista.itens[0]).toMatchObject({ categoria: 'planilha-semanal', recursoTipo: 'importacao', recursoId: r.json().importacaoId, versaoAtual: 1 })
    expect((await get('leitor', `/api/v1/arquivos/${lista.itens[0].id}/conteudo`)).body).toBe(csv)
  })

  it('limite de tamanho (quando configurado) e extensões bloqueadas não deixam resto no bucket', async () => {
    await app.close()
    await montar({ ARQUIVOS_MAX_MB: '1', ARQUIVOS_EXTENSOES_BLOQUEADAS: 'bat, .cmd' })
    const grande = await enviar('analista', '/api/v1/arquivos', {}, 'grande.bin', Buffer.alloc(1024 * 1024 + 10, 1))
    expect(grande.statusCode).toBe(413)
    const bloqueado = await enviar('analista', '/api/v1/arquivos', {}, 'script.BAT', Buffer.from('echo'))
    expect(bloqueado.statusCode).toBe(415)
    expect(armazenamento.objetos.size).toBe(0)
    expect((await banco.pool.query('SELECT count(*)::int AS n FROM arquivo')).rows[0].n).toBe(0)
  })

  it('sem limite configurado, arquivo grande passa em fluxo', async () => {
    const tamanho = 30 * 1024 * 1024
    const r = await enviar('analista', '/api/v1/arquivos', { finalidade: 'importado', categoria: 'extratos' }, 'extrato.ofx', Buffer.alloc(tamanho, 65))
    expect(r.statusCode).toBe(201)
    expect(r.json().tamanhoBytes).toBe(tamanho)
  })
})
