/**
 * Foto do Bitfin (1.2) contra PostgreSQL real, com um leitor falso no lugar
 * do SQL Server: execução, recusa fail-closed, posição do comitê pelo mesmo
 * caminho da importação, comparação, agendador e importação desligada.
 */
import { describe, expect, it } from 'vitest'
import type { DadosFotoBitfin } from '@monitoramento/dominio'
import { comporDependencias, type Dependencias } from '../src/composicao'
import { ArmazenamentoMemoria } from '../src/infra/armazenamento'
import type { Banco } from '../src/infra/banco'
import { ErroBitfin, mapearDados, type LeitorBitfin } from '../src/infra/bitfin'
import { CONSULTAS_FOTO, conferirSomenteLeitura, consultaNomesClientes } from '../src/infra/bitfinConsultas'
import { FonteFotoNenhuma } from '../src/identidade/fontesFoto'
import { construirServidor } from '../src/http/servidor'
import { dataLocal, horaLocal } from '../src/servicos/servicoFotoBitfin'
import { configTeste } from './apoio'
import { bancoLimpo, temBanco } from './banco'
import { dadosFotoExemplo } from './fixtures/fotoBitfin'

class LeitorFalso implements LeitorBitfin {
  configurado = true
  leituras = 0
  constructor(public dados: () => DadosFotoBitfin | Error) {}
  async ler() {
    this.leituras += 1
    const d = this.dados()
    if (d instanceof Error) throw d
    return { dados: structuredClone(d), tempoMs: { clientes: 5 } }
  }
  async testar() {
    return { servidorAgora: '2026-10-29T10:00:00.000Z', banco: 'UNLTD_EVERBLUE' }
  }
  async buscarNomes() {
    return new Map<string, string>()
  }
}

async function preparar(dados: () => DadosFotoBitfin | Error = () => dadosFotoExemplo, extra: Record<string, string> = {}) {
  const banco: Banco = await bancoLimpo()
  const leitor = new LeitorFalso(dados)
  const deps: Dependencias = comporDependencias(configTeste({ DIRETORIO_URL: '', DIRETORIO_INTEGRATION_SECRET: '', IMPORTACAO_PLANILHA_HABILITADA: 'false', ...extra }), {
    banco,
    armazenamento: new ArmazenamentoMemoria(),
    fonteFoto: new FonteFotoNenhuma(),
    leitorBitfin: leitor,
  })
  const { rows } = await banco.pool.query(`INSERT INTO usuario (email, nome, perfil, origem) VALUES ('a@grupoeverblue.com.br', 'Analista', 'admin', 'local') RETURNING id`)
  const u = { id: String(rows[0].id), nome: 'Analista', email: 'a@grupoeverblue.com.br' }
  const tirar = async (gravarPosicao: boolean) => {
    const id = await deps.repos.fotos.iniciar({ origem: 'MANUAL', solicitadoPor: u.id, gravarPosicao, versaoRegras: 'teste' })
    return deps.servicos.fotoBitfin.executar(id, { origem: 'MANUAL', solicitante: u, gravarPosicao })
  }
  return { banco, deps, leitor, u, tirar }
}

describe('consultas da foto: somente leitura', () => {
  it('nenhuma consulta escreve no Bitfin nem lê senha', () => {
    for (const sql of Object.values(CONSULTAS_FOTO)) expect(() => conferirSomenteLeitura(sql)).not.toThrow()
    expect(() => conferirSomenteLeitura(consultaNomesClientes(3))).not.toThrow()
    expect(() => conferirSomenteLeitura('SELECT 1; DELETE FROM Titulo')).toThrow(/somente leitura/)
    expect(() => conferirSomenteLeitura('SELECT Senha FROM MembroInterno')).toThrow()
    expect(() => conferirSomenteLeitura('SELECT * INTO #x FROM Titulo')).toThrow()
    expect(() => conferirSomenteLeitura("EXEC sp_who")).toThrow()
  })

  it('converte as linhas do SQL Server (datas, nulos, eventos por ocorrência)', () => {
    const vazio = Object.fromEntries(Object.keys(CONSULTAS_FOTO).map((k) => [k, []])) as unknown as Parameters<typeof mapearDados>[0]
    const d = mapearDados(
      {
        ...vazio,
        clientes: [{ ClienteId: 600, Nome: ' CDA ', Documento: '012766216000141', Situacao: 'Monitoramento', RiscoTotalTotal: '2772123.32', IndiceDeLiquidez: null, DataFinalDaLiquidez: new Date('2026-10-28T00:00:00Z') }],
        eventos: [
          { ClienteId: 600, EventoId: 1, Titulo: 'Ata', DataDeCadastro: new Date('2026-10-29T16:00:00Z'), DataOcorrencia: new Date('2026-10-29T16:00:00Z'), Mensagem: 'a' },
          { ClienteId: 600, EventoId: 1, Titulo: 'Ata', DataDeCadastro: new Date('2026-10-29T16:00:00Z'), DataOcorrencia: new Date('2026-10-29T17:00:00Z'), Mensagem: 'b' },
          { ClienteId: 600, EventoId: 2, Titulo: 'Visita', DataDeCadastro: new Date('2026-10-23T15:00:00Z'), DataOcorrencia: null },
        ],
        responsaveis: [{ ClienteId: 600, Papel: 'GERENTE', MembroInternoId: 3, Nome: 'Joice', Email: 'Joice@GrupoEverblue.com.br', Ativo: true }],
      },
      '2026-10-29T10:00:00.000Z',
    )
    expect(d.clientes[0]).toMatchObject({ nome: 'CDA', risco: 2772123.32, indiceLiquidez: null, dataFinalLiquidez: '2026-10-28T00:00:00.000Z' })
    expect(d.eventos).toHaveLength(2)
    expect(d.eventos[0].ocorrencias.map((o) => o.mensagem)).toEqual(['a', 'b'])
    expect(d.eventos[1].ocorrencias).toEqual([])
    expect(d.responsaveis[0].email).toBe('joice@grupoeverblue.com.br')
  })

  it('fuso America/Sao_Paulo no agendador', () => {
    expect(dataLocal(new Date('2026-10-30T02:30:00Z'))).toBe('2026-10-29')
    expect(horaLocal(new Date('2026-10-29T10:30:00Z'))).toEqual({ minutos: 7 * 60 + 30, diaSemana: 4 })
  })
})

describe.skipIf(!temBanco)('foto do Bitfin (PostgreSQL real)', () => {
  it('foto sem posição: guarda clientes e detalhe, não toca nos snapshots', async () => {
    const { banco, deps, tirar } = await preparar()
    try {
      const f = await tirar(false)
      expect(f.status).toBe('CONCLUIDA')
      expect(f.posicaoSemanal).toBe('NAO_SOLICITADA')
      expect(f.clientes).toBe(3)
      expect(f.arquivoId).not.toBeNull()
      const clientes = await deps.repos.fotos.clientesDaFoto(f.id)
      expect(clientes.map((c) => c.nome).sort()).toEqual(['Action Line Do Brasil Ltda', 'Cia. Distrib. de Alum. S A', 'Fex Agro Coml. Ltda'])
      expect(clientes.find((c) => c.bitfinClienteId === 600)!.detalhe.eventos).toHaveLength(1)
      expect((await banco.pool.query('SELECT count(*)::int AS n FROM snapshot_semanal')).rows[0].n).toBe(0)
      // A foto é append-only no banco.
      await expect(banco.pool.query(`UPDATE foto_cliente SET risco = 0 WHERE foto_id = $1`, [f.id])).rejects.toThrow(/append-only/)
      const aud = await banco.pool.query(`SELECT acao FROM auditoria WHERE recurso_id = $1 ORDER BY em`, [f.id])
      expect(aud.rows.map((r) => r.acao)).toContain('foto.concluida')
    } finally {
      await banco.encerrar()
    }
  })

  it('retenção (ADR-021): foto que gravou posição ou gerou Mapa é permanente; teste sai após 90 dias', async () => {
    const { banco, deps, u, tirar } = await preparar()
    try {
      const a = await tirar(true) // grava posição → permanente
      const b = await tirar(false) // teste
      const c = await tirar(false) // teste que gerou Mapa enviado → permanente
      const d = await tirar(false) // teste recente
      expect(a.posicaoSemanal).toBe('GRAVADA')
      await deps.repos.mapa.registrarEnvio({ loteId: '11111111-1111-4111-8111-111111111111', fotoId: c.id, origem: 'MANUAL', solicitadoPor: u.id, destinatario: 'x@grupoeverblue.com.br', papeis: ['COPIA'], clientes: [], status: 'NAO_ENVIADO', mensagem: null, arquivoId: null })
      await banco.pool.query(`UPDATE foto_execucao SET iniciado_em = now() - interval '100 days' WHERE id = ANY($1)`, [[a.id, b.id, c.id]])

      // Proteções no banco: sem a sessão de expurgo nada sai; permanente nunca sai.
      await expect(banco.pool.query('DELETE FROM foto_cliente WHERE foto_id = $1', [b.id])).rejects.toThrow(/append-only/)
      await expect(banco.pool.query('DELETE FROM foto_execucao WHERE id = $1', [b.id])).rejects.toThrow(/não pode ser apagada/)
      await expect(
        banco.transacao(async (tx) => {
          await tx.query(`SET LOCAL monitoramento.expurgo_foto = 'on'`)
          await tx.query('DELETE FROM foto_cliente WHERE foto_id = $1', [a.id])
        }),
      ).rejects.toThrow(/append-only/)
      // Leitura bruta protegida também na Central de Arquivos.
      const ator = { id: u.id, email: u.email }
      await expect(deps.servicos.arquivos.expurgar(a.arquivoId!, 'teste', ator)).rejects.toMatchObject({ codigo: 'foto_protegida' })
      await expect(deps.servicos.arquivos.excluir(d.arquivoId!, 'teste', ator)).rejects.toMatchObject({ codigo: 'foto_protegida' })
      await expect(banco.pool.query(`UPDATE arquivo SET situacao = 'EXCLUIDO' WHERE id = $1`, [c.arquivoId])).rejects.toThrow(/protegida/)

      const r = await deps.servicos.expurgoFotos.executar()
      expect(r).toMatchObject({ fotos: 1, arquivos: 1, falhas: 0, ids: [b.id] })
      expect(r.clientes).toBe(3)
      const restantes = (await deps.repos.fotos.listar()).map((e) => e.id).sort()
      expect(restantes).toEqual([a.id, c.id, d.id].sort())
      expect((await deps.repos.fotos.porId(c.id))!.fotoAnteriorId).toBe(a.id) // corrente religada
      expect((await banco.pool.query(`SELECT situacao FROM arquivo WHERE id = $1`, [b.arquivoId])).rows[0].situacao).toBe('EXPURGADO')
      expect((await banco.pool.query(`SELECT count(*)::int AS n FROM foto_cliente WHERE foto_id = $1`, [a.id])).rows[0].n).toBe(3)
      expect((await banco.pool.query(`SELECT count(*)::int AS n FROM snapshot_semanal`)).rows[0].n).toBe(3)
      const aud = await banco.pool.query(`SELECT detalhes FROM auditoria WHERE acao = 'foto.expurgo'`)
      expect(aud.rows[0].detalhes.ids).toEqual([b.id])
      // Rodar de novo não apaga mais nada.
      expect((await deps.servicos.expurgoFotos.executar()).fotos).toBe(0)
      // Uma vez por dia, a partir das 03:00 de Brasília.
      expect(await deps.servicos.expurgoFotos.talvezExecutar(new Date('2026-11-05T05:00:00Z'))).toBeNull()
      expect(await deps.servicos.expurgoFotos.talvezExecutar(new Date('2026-11-05T07:00:00Z'))).not.toBeNull()
      expect(await deps.servicos.expurgoFotos.talvezExecutar(new Date('2026-11-05T20:00:00Z'))).toBeNull()
    } finally {
      await banco.encerrar()
    }
  })

  it('posição do comitê: grava pelo caminho da importação; a última foto da semana substitui até a ata (ADR-023)', async () => {
    let il = 91.73
    const { banco, deps, tirar } = await preparar(() => ({ ...dadosFotoExemplo, clientes: dadosFotoExemplo.clientes.map((c) => (c.documento.includes('12766216') || c.documento.includes('12.766.216') ? { ...c, indiceLiquidez: il } : c)) }))
    try {
      const f1 = await tirar(true)
      expect(f1.status).toBe('CONCLUIDA')
      expect(f1.posicaoSemanal).toBe('GRAVADA')
      expect(f1.totais?.snapshots).toBe(3)
      const cda = (await deps.repos.clientes.listar()).find((c) => c.cnpj === '12.766.216/0001-41')!
      expect(cda.status).toBe('MONITORAMENTO')
      const snap = (await deps.repos.snapshots.porCliente(cda.id))[0]
      expect(snap.semanaRef).toBe(f1.semanaRef)
      expect(snap.riscoCliente).toBe(2772123.32)
      expect(snap.valorEmAndamento).toBe(1433514.05)
      expect(snap.manifestoInacessivel).toBe(0)
      expect(snap.il30).toBe(91.73)
      expect(snap.prazoMedioCarteiraDias).toBe(37.89)
      const action = (await deps.repos.clientes.listar()).find((c) => c.cnpj === '02.379.828/0001-28')!
      expect((await deps.repos.snapshots.porCliente(action.id))[0].percLiquidadoNoPrazo).toBeNull()
      const imp = await banco.pool.query(`SELECT formato, status FROM importacao WHERE id = $1`, [f1.importacaoId])
      expect(imp.rows[0]).toEqual({ formato: 'BITFIN', status: 'CONFIRMADA' })
      // cliente criado pela posição é ligado à foto pelo documento
      expect((await deps.repos.fotos.clientesDaFoto(f1.id)).every((c) => c.clienteId === null)).toBe(true)
      expect((await deps.repos.fotos.ultimoDetalheDoCliente(action.id))!.detalhe.nome).toBe('Action Line Do Brasil Ltda')
      expect((await deps.repos.fotos.ultimoDetalheDoCliente(cda.id))!.detalhe.limite.total).toBe(6000000)

      const alertasAntes = (await banco.pool.query('SELECT count(*)::int AS n FROM alerta')).rows[0].n
      // Segunda foto na mesma semana, com o Bitfin já mudado: substitui.
      il = 95.5
      const f2 = await tirar(true)
      expect(f2.posicaoSemanal).toBe('GRAVADA')
      expect(f2.fotoAnteriorId).toBe(f1.id)
      expect(f2.mensagem).toContain('substituída por esta foto')
      expect((await banco.pool.query('SELECT count(*)::int AS n FROM snapshot_semanal')).rows[0].n).toBe(3)
      const novo = (await deps.repos.snapshots.porCliente(cda.id)).find((x) => x.semanaRef === f1.semanaRef)!
      expect(novo.il30).toBe(95.5)
      // A anterior fica no histórico, com a importação que a substituiu.
      const hist = await banco.pool.query(`SELECT il30::float AS il30, substituido_por_importacao FROM snapshot_semanal_substituido WHERE cliente_id = $1`, [cda.id])
      expect(hist.rows).toEqual([{ il30: 91.73, substituido_por_importacao: f2.importacaoId }])
      expect((await banco.pool.query('SELECT count(*)::int AS n FROM classificacao_semanal')).rows[0].n).toBe(3)
      expect((await banco.pool.query('SELECT count(*)::int AS n FROM classificacao_semanal_substituida')).rows[0].n).toBe(3)
      // Alertas que já estavam abertos não se repetem.
      expect((await banco.pool.query('SELECT count(*)::int AS n FROM alerta')).rows[0].n).toBe(alertasAntes)

      // Fora da sessão de substituição o banco continua recusando.
      await expect(banco.pool.query('DELETE FROM snapshot_semanal WHERE cliente_id = $1', [cda.id])).rejects.toThrow(/append-only/)
      await expect(banco.pool.query('UPDATE snapshot_semanal SET il30 = 1 WHERE cliente_id = $1', [cda.id])).rejects.toThrow(/append-only/)
      // Comitê da semana com ata: nem a sessão de substituição apaga.
      await banco.pool.query(`INSERT INTO comite (id, data, status) VALUES ('cmt_ata', $1, 'REALIZADO')`, [f1.semanaRef])
      await expect(
        banco.transacao(async (tx) => {
          await tx.query(`SET LOCAL monitoramento.substituicao_posicao = 'on'`)
          await tx.query('DELETE FROM snapshot_semanal WHERE cliente_id = $1', [cda.id])
        }),
      ).rejects.toThrow(/append-only/)
      // E uma nova foto não troca a posição travada: fica só no histórico.
      il = 70
      const f3 = await tirar(true)
      expect(f3.posicaoSemanal).toBe('JA_EXISTIA')
      expect(f3.mensagem).toContain('já tem ata')
      expect((await deps.repos.snapshots.porCliente(cda.id)).find((x) => x.semanaRef === f1.semanaRef)!.il30).toBe(95.5)
    } finally {
      await banco.encerrar()
    }
  })

  it('fail-closed: situação desconhecida recusa a foto inteira; nada vai para a posição', async () => {
    const { banco, deps, tirar } = await preparar(() => ({ ...dadosFotoExemplo, clientes: dadosFotoExemplo.clientes.map((c, i) => (i === 1 ? { ...c, situacao: 'Bloqueado' } : c)) }))
    try {
      const f = await tirar(true)
      expect(f.status).toBe('RECUSADA')
      expect(f.posicaoSemanal).toBe('NAO_GRAVADA')
      expect(f.recusas.join(' ')).toContain('Bloqueado')
      expect((await banco.pool.query('SELECT count(*)::int AS n FROM snapshot_semanal')).rows[0].n).toBe(0)
      expect(await deps.repos.fotos.clientesDaFoto(f.id)).toEqual([])
      expect(f.arquivoId).not.toBeNull() // a leitura bruta fica guardada para auditoria
    } finally {
      await banco.encerrar()
    }
  })

  it('Bitfin fora do ar: execução FALHOU, sem posição, e a próxima foto é liberada', async () => {
    let falhar = true
    const { banco, deps, tirar } = await preparar(() => (falhar ? new ErroBitfin('DB_LEGACY_CONNECT_ERROR', 'Failed to connect to 192.168.0.180:1433', 'conexao') : dadosFotoExemplo))
    try {
      const f = await tirar(true)
      expect(f.status).toBe('FALHOU')
      // Ao usuário: mensagem do catálogo + código; nunca o texto do driver (ADR-020).
      expect(f.mensagem).toContain('Não foi possível conectar ao Bitfin')
      expect(f.mensagem).toContain('DB_LEGACY_CONNECT_ERROR')
      expect(f.mensagem).not.toContain('192.168.0.180')
      falhar = false
      expect((await tirar(false)).status).toBe('CONCLUIDA')
      expect((await deps.repos.fotos.listar()).map((e) => e.status)).toEqual(['CONCLUIDA', 'FALHOU'])
    } finally {
      await banco.encerrar()
    }
  })

  it('uma foto por vez e execução interrompida liberada', async () => {
    const { banco, deps, u } = await preparar()
    try {
      await deps.repos.fotos.iniciar({ origem: 'MANUAL', solicitadoPor: u.id, gravarPosicao: false, versaoRegras: 't' })
      await expect(deps.servicos.fotoBitfin.solicitar({ origem: 'MANUAL', solicitante: u, gravarPosicao: false })).rejects.toMatchObject({ status: 409, codigo: 'foto_em_andamento' })
      await banco.pool.query(`UPDATE foto_execucao SET iniciado_em = now() - interval '2 hours'`)
      expect(await deps.repos.fotos.encerrarInterrompidas(30)).toBe(1)
      expect((await deps.repos.fotos.listar())[0].status).toBe('FALHOU')
    } finally {
      await banco.encerrar()
    }
  })

  it('comparação com a foto anterior: novo, mantido e saiu', async () => {
    let dados = dadosFotoExemplo
    const { banco, deps, tirar } = await preparar(() => dados)
    try {
      await tirar(false)
      dados = {
        ...dadosFotoExemplo,
        clientes: dadosFotoExemplo.clientes.filter((c) => c.clienteId !== 253).map((c) => (c.clienteId === 600 ? { ...c, risco: 2800000, riscoVencido: 50000 } : c)),
        contas: dadosFotoExemplo.contas.filter((c) => c.clienteId !== 253),
      }
      const f2 = await tirar(false)
      const cmp = await deps.servicos.fotoBitfin.comparar(f2.id)
      const cda = cmp.clientes.find((c) => c.documento === '12.766.216/0001-41')!
      expect(cda).toMatchObject({ situacao: 'MANTIDO', risco: 2800000, riscoAnterior: 2772123.32, vencido: 50000, vencidoAnterior: 37264.57 })
      expect(cmp.clientes.find((c) => c.documento === '11.011.716/0001-00')!.situacao).toBe('SAIU')
      expect(f2.divergencias.some((d) => d.campo === 'Risco')).toBe(true) // risco ≠ soma das contas, registrado
    } finally {
      await banco.encerrar()
    }
  })

  it('agendador: dispara uma vez por dia no horário configurado (fuso de São Paulo)', async () => {
    const { banco, deps, u } = await preparar()
    try {
      const agendador = deps.agendadorFoto
      // desligado: não dispara
      expect(await agendador.verificar(new Date('2026-10-29T11:00:00Z'))).toBeNull()
      await deps.repos.fotos.salvarAgendamento({ ativo: true, horario: '07:30', diasSemana: [1, 2, 3, 4, 5], diaPosicaoSemanal: 4 }, u.id)
      // 07:00 em São Paulo (10:00 UTC): cedo
      expect(await agendador.verificar(new Date('2026-10-29T10:00:00Z'))).toBeNull()
      // 08:00 em São Paulo: dispara, quinta = dia da posição do comitê
      const id = await agendador.verificar(new Date('2026-10-29T11:00:00Z'))
      expect(id).not.toBeNull()
      // mesma data: não dispara de novo
      expect(await agendador.verificar(new Date('2026-10-29T15:00:00Z'))).toBeNull()
      // aguarda a execução em segundo plano
      for (let i = 0; i < 100 && (await deps.repos.fotos.porId(id!))!.status === 'EXECUTANDO'; i++) await new Promise((r) => setTimeout(r, 50))
      const f = (await deps.repos.fotos.porId(id!))!
      expect(f).toMatchObject({ origem: 'AGENDADA', status: 'CONCLUIDA', gravarPosicao: true, posicaoSemanal: 'GRAVADA', solicitadoPorNome: 'Agendador do Monitoramento' })
      // sábado não está nos dias
      expect(await agendador.verificar(new Date('2026-10-31T11:00:00Z'))).toBeNull()
    } finally {
      await banco.encerrar()
    }
  })

  it('agendador: com foto manual em andamento devolve o dia e tenta de novo; execução pendurada é liberada', async () => {
    const { banco, deps, u } = await preparar()
    try {
      await deps.repos.fotos.salvarAgendamento({ ativo: true, horario: '07:30', diasSemana: [0, 1, 2, 3, 4, 5, 6], diaPosicaoSemanal: null }, u.id)
      await deps.repos.fotos.iniciar({ origem: 'MANUAL', solicitadoPor: u.id, gravarPosicao: false, versaoRegras: 't' })
      expect(await deps.agendadorFoto.verificar(new Date('2026-10-29T11:00:00Z'))).toBeNull()
      expect((await deps.repos.fotos.agendamento()).ultimaExecucaoEm).toBeNull() // dia devolvido
      // a manual ficou pendurada (queda do serviço): a próxima verificação libera e dispara
      await banco.pool.query(`UPDATE foto_execucao SET iniciado_em = now() - interval '2 hours'`)
      const id = await deps.agendadorFoto.verificar(new Date('2026-10-29T11:01:00Z'))
      expect(id).not.toBeNull()
      for (let i = 0; i < 100 && (await deps.repos.fotos.porId(id!))!.status === 'EXECUTANDO'; i++) await new Promise((r) => setTimeout(r, 50))
      expect((await deps.repos.fotos.porId(id!))!.status).toBe('CONCLUIDA')
    } finally {
      await banco.encerrar()
    }
  })

  it('HTTP: importação por planilha desligada (410) e foto pela API', async () => {
    const { banco, deps } = await preparar()
    const app = await construirServidor(deps)
    try {
      const r = await app.inject({ method: 'POST', url: '/api/v1/importacoes/00000000-0000-4000-8000-000000000000/confirmar', payload: { semanaRef: '2026-10-29' } })
      // sem sessão: 401 antes da regra; com sessão o desligamento responde 410 (abaixo)
      expect(r.statusCode).toBe(401)
      const { rows } = await banco.pool.query(`SELECT id FROM usuario WHERE email = 'a@grupoeverblue.com.br'`)
      const cookie = `emon_sessao=${await deps.sessao.emitir(rows[0].id)}`
      const origin = 'https://monitoramento.teste'
      const desligada = await app.inject({ method: 'POST', url: '/api/v1/importacoes/00000000-0000-4000-8000-000000000000/confirmar', payload: { semanaRef: '2026-10-29' }, headers: { cookie, origin } })
      expect(desligada.statusCode).toBe(410)
      expect(desligada.json().codigo).toBe('importacao_desativada')
      const sit = await app.inject({ method: 'GET', url: '/api/v1/foto-bitfin/situacao', headers: { cookie } })
      expect(sit.json()).toMatchObject({ configurado: true, planilhaHabilitada: false, emAndamento: null })
      const pedido = await app.inject({ method: 'POST', url: '/api/v1/foto-bitfin', payload: { gravarPosicao: false }, headers: { cookie, origin } })
      expect(pedido.statusCode).toBe(202)
      const id = pedido.json().id
      for (let i = 0; i < 100 && (await deps.repos.fotos.porId(id))!.status === 'EXECUTANDO'; i++) await new Promise((r) => setTimeout(r, 50))
      const exec = await app.inject({ method: 'GET', url: `/api/v1/foto-bitfin/execucoes/${id}`, headers: { cookie } })
      expect(exec.json().status).toBe('CONCLUIDA')
      const ag = await app.inject({ method: 'PUT', url: '/api/v1/foto-bitfin/agendamento', payload: { ativo: true, horario: '07:30', diasSemana: [1, 2], diaPosicaoSemanal: 5 }, headers: { cookie, origin } })
      expect(ag.statusCode).toBe(422)
      const ok = await app.inject({ method: 'PUT', url: '/api/v1/foto-bitfin/agendamento', payload: { ativo: true, horario: '07:30', diasSemana: [0, 1, 2, 3, 4, 5, 6], diaPosicaoSemanal: 4 }, headers: { cookie, origin } })
      expect(ok.statusCode).toBe(204)
      expect((await deps.repos.fotos.agendamento()).diasSemana).toEqual([0, 1, 2, 3, 4, 5, 6])
    } finally {
      await app.close()
      await banco.encerrar()
    }
  })
})
