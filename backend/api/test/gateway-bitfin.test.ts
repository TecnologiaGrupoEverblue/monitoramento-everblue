/**
 * Gateway do Bitfin — Padrão Corporativo de Conexões (ADR-020), cenários do
 * plano de testes T03–T14 aplicáveis, sem SQL Server real: o dublê do driver
 * se comporta como o mssql/tedious (cancel() faz a consulta rejeitar com
 * ECANCEL; nada é mais permissivo que o driver).
 */
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { classificarErroMssql, executarComando, type ComandoSql } from '../src/infra/bitfin'
import { consultaNomesClientes, consultasMapa, CONSULTAS_FOTO, parametrosDocumentos } from '../src/infra/bitfinConsultas'
import { ErroBitfin, GatewayLegado, type ConfigGateway, type EventoIntegracao, type Prazo } from '../src/infra/gatewayLegado'
import { comporDependencias } from '../src/composicao'
import { construirServidor } from '../src/http/servidor'
import { ArmazenamentoMemoria } from '../src/infra/armazenamento'
import { FonteFotoNenhuma } from '../src/identidade/fontesFoto'
import { configTeste } from './apoio'
import { bancoLimpo, temBanco } from './banco'

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))
const cfg = (extra: Partial<ConfigGateway> = {}): ConfigGateway => ({
  filaMax: 2,
  disjuntorFalhas: 3,
  disjuntorAbertoMs: 1_000,
  classes: {
    foto: { consultaMs: 200, prazoMs: 2_000, esperaFilaMs: 500 },
    nomes: { consultaMs: 200, prazoMs: 1_000, esperaFilaMs: 100 },
    diagnostico: { consultaMs: 200, prazoMs: 1_000, esperaFilaMs: 100 },
  },
  ...extra,
})

function gateway(extra: Partial<ConfigGateway> = {}, relogio?: { t: number }) {
  const eventos: EventoIntegracao[] = []
  const logs: { nivel: string; msg: string; o: object }[] = []
  const g = new GatewayLegado(
    cfg(extra),
    async (e) => {
      eventos.push(e)
    },
    { info: (o, msg) => logs.push({ nivel: 'info', msg, o }), error: (o, msg) => logs.push({ nivel: 'error', msg, o }) },
    relogio ? () => relogio.t : Date.now,
  )
  return { g, eventos, logs }
}

/** Dublê do mssql.Request: query demora `ms`; cancel() rejeita com ECANCEL
 * (como o tedious após o ATTENTION) — ou não rejeita, se `ignoraCancel`. */
class ComandoFalso implements ComandoSql {
  cancelado = false
  entradas: [string, unknown][] = []
  private rejeitar: ((e: unknown) => void) | null = null
  constructor(
    private readonly ms: number,
    private readonly opcoes: { ignoraCancel?: boolean; linhas?: unknown[] } = {},
  ) {}
  input(nome: string, _tipo: unknown, valor: unknown) {
    this.entradas.push([nome, valor])
    return this
  }
  query(): Promise<{ recordset?: unknown[] }> {
    return new Promise((resolve, reject) => {
      this.rejeitar = reject
      setTimeout(() => resolve({ recordset: this.opcoes.linhas ?? [{ x: 1 }] }), this.ms)
    })
  }
  cancel() {
    this.cancelado = true
    if (!this.opcoes.ignoraCancel) this.rejeitar?.(Object.assign(new Error('Canceled.'), { code: 'ECANCEL', name: 'RequestError' }))
  }
}

const prazo = (consultaMs: number, totalMs = 5_000): Prazo => {
  const ate = performance.now() + totalMs
  return { ate, consultaMs, restanteMs: () => Math.max(0, ate - performance.now()) }
}

describe('executarComando: teto por comando com cancelamento real', () => {
  it('T03 consulta lenta: chama cancel() no driver e devolve QUERY_TIMEOUT', async () => {
    const req = new ComandoFalso(1_000)
    const e = await executarComando(req, 'SELECT 1', prazo(50), 'teste').catch((x) => x)
    expect(req.cancelado).toBe(true)
    expect(e).toBeInstanceOf(ErroBitfin)
    expect(e.codigo).toBe('DB_LEGACY_QUERY_TIMEOUT')
  })

  it('não começa comando com o prazo total esgotado', async () => {
    const req = new ComandoFalso(10)
    const e = await executarComando(req, 'SELECT 1', prazo(50, 0), 'teste').catch((x) => x)
    expect(e.codigo).toBe('DB_LEGACY_QUERY_TIMEOUT')
    expect(req.cancelado).toBe(false)
  })

  it('T14 comando de escrita nunca chega ao driver', async () => {
    const req = new ComandoFalso(10)
    await expect(executarComando(req, 'UPDATE Cliente SET Nome = 1', prazo(50), 'teste')).rejects.toThrow(/somente leitura/)
  })

  it('classifica o erro do driver sem expor o texto ao usuário', () => {
    const cred = classificarErroMssql(Object.assign(new Error("Login failed for user 'Everblue'."), { code: 'ELOGIN', name: 'ConnectionError' }), 'conexao')
    expect(cred.codigo).toBe('DB_LEGACY_CREDENTIAL')
    expect(cred.message).not.toContain('Everblue')
    expect(cred.detalhe).toContain('Login failed')
    expect(classificarErroMssql(Object.assign(new Error('x'), { code: 'ESOCKET', name: 'ConnectionError' }), 'c').codigo).toBe('DB_LEGACY_CONNECT_ERROR')
    expect(classificarErroMssql(Object.assign(new Error('x'), { code: 'ETIMEOUT', name: 'RequestError' }), 'c').codigo).toBe('DB_LEGACY_QUERY_TIMEOUT')
    const sqlErr = classificarErroMssql(Object.assign(new Error('Snapshot isolation transaction failed accessing database'), { number: 3952, name: 'RequestError' }), 'clientes')
    expect(sqlErr.codigo).toBe('DB_LEGACY_QUERY_ERROR')
    expect(sqlErr.message).not.toMatch(/Snapshot|database/i)
  })
})

describe('gateway: fila limitada, single-flight, disjuntor e auditoria', () => {
  it('T04 fila cheia: recusa imediata, sem executar', async () => {
    const { g, eventos } = gateway({ filaMax: 1 })
    let executadas = 0
    const lento = () => g.executar('foto.leitura', {}, async () => (executadas++, await espera(150), { valor: 1, linhas: 1 }))
    const a = lento()
    const b = lento()
    await espera(10)
    const c = await g.executar('mapa.nomes', {}, async () => (executadas++, { valor: 1, linhas: 1 })).catch((e) => e)
    expect(c.codigo).toBe('DB_LEGACY_QUEUE_FULL')
    await Promise.all([a, b])
    expect(executadas).toBe(2)
    expect(eventos.find((e) => e.categoriaErro === 'DB_LEGACY_QUEUE_FULL')).toMatchObject({ status: 'RECUSADA', tentativas: 0 })
  })

  it('espera máxima na fila: sai sem executar SQL', async () => {
    const { g } = gateway()
    let executouB = false
    const a = g.executar('foto.leitura', {}, async () => (await espera(250), { valor: 1, linhas: 1 }))
    await espera(5)
    const b = await g.executar('mapa.nomes', {}, async () => ((executouB = true), { valor: 1, linhas: 1 })).catch((e) => e)
    expect(b.codigo).toBe('DB_LEGACY_QUEUE_TIMEOUT')
    expect(executouB).toBe(false)
    await a
  })

  it('T05 single-flight: pedidos idênticos = uma execução física', async () => {
    const { g, eventos } = gateway()
    let fisicas = 0
    const trabalho = async () => (fisicas++, await espera(50), { valor: 'ok', linhas: 1 })
    const [r1, r2, r3] = await Promise.all([g.executar('mapa.nomes', {}, trabalho, 'a,b'), g.executar('mapa.nomes', {}, trabalho, 'a,b'), g.executar('mapa.nomes', {}, trabalho, 'a,b')])
    expect([r1, r2, r3]).toEqual(['ok', 'ok', 'ok'])
    expect(fisicas).toBe(1)
    expect(eventos).toHaveLength(1)
    expect(eventos[0]).toMatchObject({ requisicoesLogicas: 3, tentativas: 1, status: 'SUCESSO' })
  })

  it('T06 chaves diferentes não compartilham resultado', async () => {
    const { g } = gateway()
    const r = await Promise.all([g.executar('mapa.nomes', {}, async () => ({ valor: 'A', linhas: 1 }), 'a'), g.executar('mapa.nomes', {}, async () => ({ valor: 'B', linhas: 1 }), 'b')])
    expect(r).toEqual(['A', 'B'])
  })

  it('T07/T08 disjuntor: abre após falhas, recusa sem SQL, sonda uma vez e fecha', async () => {
    const relogio = { t: 0 }
    const { g, logs } = gateway({}, relogio)
    const falha = async () => {
      throw new ErroBitfin('DB_LEGACY_CONNECT_ERROR', 'ECONNREFUSED 10.0.0.1')
    }
    for (let i = 0; i < 3; i++) await g.executar('foto.leitura', {}, falha).catch(() => {})
    expect(g.estado().disjuntor).toBe('OPEN')
    let tocou = false
    const fechado = await g.executar('foto.leitura', {}, async () => ((tocou = true), { valor: 1, linhas: 1 })).catch((e) => e)
    expect(fechado.codigo).toBe('DB_LEGACY_CIRCUIT_OPEN')
    expect(tocou).toBe(false)
    relogio.t = 1_001
    expect(g.estado().disjuntor).toBe('HALF_OPEN')
    // Uma sondagem por vez: a segunda é recusada.
    const sonda = g.executar('foto.leitura', {}, async () => (await espera(30), { valor: 'ok', linhas: 1 }))
    const segunda = await g.executar('mapa.nomes', {}, async () => ({ valor: 1, linhas: 1 })).catch((e) => e)
    expect(segunda.codigo).toBe('DB_LEGACY_CIRCUIT_OPEN')
    expect(await sonda).toBe('ok')
    expect(g.estado().disjuntor).toBe('CLOSED')
    expect(logs.filter((l) => l.msg === 'bitfin_disjuntor_mudou').map((l) => (l.o as { para: string }).para)).toEqual(['OPEN', 'HALF_OPEN', 'CLOSED'])
    // Detalhe do driver só no log, nunca no erro devolvido.
    expect(JSON.stringify(logs.filter((l) => l.msg === 'bitfin_erro_detalhe'))).toContain('ECONNREFUSED')
  })

  it('T09 credencial inválida abre na hora (sem tempestade); erro de SQL não abre', async () => {
    const { g } = gateway()
    await g.executar('foto.leitura', {}, async () => {
      throw new ErroBitfin('DB_LEGACY_QUERY_ERROR')
    }).catch(() => {})
    await g.executar('foto.leitura', {}, async () => {
      throw new ErroBitfin('DB_LEGACY_QUERY_ERROR')
    }).catch(() => {})
    await g.executar('foto.leitura', {}, async () => {
      throw new ErroBitfin('DB_LEGACY_QUERY_ERROR')
    }).catch(() => {})
    expect(g.estado().disjuntor).toBe('CLOSED')
    await g.executar('foto.leitura', {}, async () => {
      throw new ErroBitfin('DB_LEGACY_CREDENTIAL')
    }).catch(() => {})
    expect(g.estado().disjuntor).toBe('OPEN')
  })

  it('T12 a vaga só é liberada quando a execução física termina (driver lento para cancelar)', async () => {
    const { g } = gateway({ classes: { ...cfg().classes, foto: { consultaMs: 30, prazoMs: 2_000, esperaFilaMs: 1_000 }, nomes: { consultaMs: 200, prazoMs: 2_000, esperaFilaMs: 1_000 } } })
    const req = new ComandoFalso(200, { ignoraCancel: true })
    const inicio = performance.now()
    const a = g.executar('foto.leitura', {}, async (p) => ({ valor: await executarComando(req, 'SELECT 1', p, 't'), linhas: 1 })).catch((e) => e)
    await espera(5)
    let admitidoEm = 0
    const b = g.executar('mapa.nomes', {}, async () => ((admitidoEm = performance.now() - inicio), { valor: 1, linhas: 1 }))
    expect((await a).codigo).toBe('DB_LEGACY_QUERY_TIMEOUT')
    await b.catch(() => {})
    expect(req.cancelado).toBe(true)
    expect(admitidoEm).toBeGreaterThanOrEqual(190)
  })

  it('T13 falha ao gravar a auditoria: operação segue, sem loop', async () => {
    const logs: string[] = []
    const g = new GatewayLegado(
      cfg(),
      async () => {
        throw new Error('banco fora')
      },
      { info: () => {}, error: (_o, m) => logs.push(m) },
    )
    expect(await g.executar('mapa.nomes', {}, async () => ({ valor: 7, linhas: 1 }))).toBe(7)
    expect(logs.filter((m) => m === 'bitfin_auditoria_falhou')).toHaveLength(1)
  })

  it('T14 operação fora do catálogo é recusada', async () => {
    const { g } = gateway()
    await expect(g.executar('qualquer.coisa' as never, {}, async () => ({ valor: 1, linhas: 1 }))).rejects.toMatchObject({ codigo: 'DB_FORBIDDEN_OPERATION' })
  })

  it('T16 drenagem no shutdown: recusa a fila e espera a execução em curso', async () => {
    const { g } = gateway()
    let terminou = false
    const a = g.executar('foto.leitura', {}, async () => (await espera(80), (terminou = true), { valor: 1, linhas: 1 }))
    await espera(5)
    const b = g.executar('mapa.nomes', {}, async () => ({ valor: 1, linhas: 1 })).catch((e) => e)
    await g.drenar(1_000)
    expect(terminou).toBe(true)
    expect((await b).codigo).toBe('DB_LEGACY_QUEUE_FULL')
    await a
  })
})

describe('consultas: normalização no parâmetro, nunca na coluna', () => {
  it('nenhuma função sobre Entidade.Documento ou pesCNPJCPF no filtro', () => {
    const todas = [...Object.values(CONSULTAS_FOTO), ...Object.values(consultasMapa(2)), consultaNomesClientes(2)].join('\n')
    expect(todas).not.toMatch(/RIGHT\('0+'\s*\+\s*e\.Documento/)
    expect(todas).not.toMatch(/REPLACE\(.*pesCNPJCPF/)
    expect(consultaNomesClientes(2)).toMatch(/WHERE e\.Documento IN \(@d0, @d1, @d2, @d3\)/)
  })

  it('valores na ordem do SQL: 15 dígitos (como gravado) e depois só dígitos', () => {
    expect(parametrosDocumentos(['04.707.547/0001-82', '427.281.478-84'])).toEqual(['004707547000182', '000042728147884', '04707547000182', '42728147884'])
    const sqlMapa = consultasMapa(2).clientes
    expect((sqlMapa.match(/@d\d+/g) ?? []).length).toBe(parametrosDocumentos(['1', '2']).length)
  })
})

describe.skipIf(!temBanco)('auditoria persistente e /api/health/dependencies', () => {
  it('grava a execução sem PII e expõe o estado só para a área de gestão', async () => {
    const banco = await bancoLimpo()
    const deps = comporDependencias(configTeste(), { banco, armazenamento: new ArmazenamentoMemoria(), fonteFoto: new FonteFotoNenhuma() })
    const app = await construirServidor(deps)
    try {
      await deps.repos.integracao.registrar({
        id: randomUUID(),
        correlationId: 'c1',
        integracao: 'bitfin',
        operacao: 'mapa.nomes',
        atorRef: 'u1',
        status: 'SUCESSO',
        iniciadoEm: new Date().toISOString(),
        concluidoEm: new Date().toISOString(),
        duracaoMs: 12,
        esperaFilaMs: 0,
        tentativas: 1,
        requisicoesLogicas: 2,
        categoriaErro: null,
        estadoDisjuntor: 'CLOSED',
        linhas: 3,
        dadosDe: null,
      })
      expect((await deps.repos.integracao.ultimas(5))[0]).toMatchObject({ operacao: 'mapa.nomes', requisicoesLogicas: 2 })
      await expect(banco.pool.query('DELETE FROM integracao_execucao')).rejects.toThrow(/append-only/)

      const criar = async (perfil: string, origem: 'local' | 'entra', nivel: string | null) => {
        const { rows } = await banco.pool.query(
          `INSERT INTO usuario (email, nome, perfil, origem, entra_oid, autorizado_em, nivel_acesso_codigo) VALUES ($1, 'P', $2, $3, $4, now(), $5) RETURNING id`,
          [`${randomUUID()}@grupoeverblue.com.br`, perfil, origem, origem === 'entra' ? randomUUID() : null, nivel],
        )
        return `emon_sessao=${await deps.sessao.emitir(rows[0].id)}`
      }
      const ok = await app.inject({ method: 'GET', url: '/api/health/dependencies', headers: { cookie: await criar('admin', 'local', null) } })
      expect(ok.statusCode).toBe(200)
      const corpo = ok.json()
      expect(corpo.dependencias.postgres.estado).toBe('UP')
      expect(corpo.dependencias.bitfin).toMatchObject({ estado: 'UNKNOWN', configurado: false, disjuntor: 'CLOSED' })
      expect(JSON.stringify(corpo)).not.toMatch(/senha|password|BITFIN_SERVIDOR/i)
      const negado = await app.inject({ method: 'GET', url: '/api/health/dependencies', headers: { cookie: await criar('leitor', 'entra', 'user') } })
      expect(negado.statusCode).toBe(403)
      expect((await app.inject({ method: 'GET', url: '/api/health/dependencies' })).statusCode).toBe(401)
    } finally {
      await app.close()
      await banco.encerrar()
    }
  })
})
