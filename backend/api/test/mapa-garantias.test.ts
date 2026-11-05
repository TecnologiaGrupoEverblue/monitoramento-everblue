/** Mapa de Garantias (1.2) contra PostgreSQL real: base lida na foto, cálculo,
 * destinatários, PDF, envio diário uma vez por dia, aviso de falha e rotas. */
import { describe, expect, it } from 'vitest'
import type { DadosFotoBitfin, DadosMapaBitfin } from '@monitoramento/dominio'
import { comporDependencias } from '../src/composicao'
import { ArmazenamentoMemoria } from '../src/infra/armazenamento'
import type { LeitorBitfin } from '../src/infra/bitfin'
import type { EnviadorEmail, MensagemEmail } from '../src/infra/email'
import { consultasMapa, documentoBitfin } from '../src/infra/bitfinConsultas'
import { FonteFotoNenhuma } from '../src/identidade/fontesFoto'
import { construirServidor } from '../src/http/servidor'
import { USUARIO_AGENDADOR } from '../src/servicos/servicoFotoBitfin'
import { configTeste } from './apoio'
import { bancoLimpo, temBanco } from './banco'
import { dadosFotoExemplo, dadosMapaExemplo } from './fixtures/fotoBitfin'

class EmailFalso implements EnviadorEmail {
  ligado = true
  descricao = 'falso'
  enviados: MensagemEmail[] = []
  falharPara = new Set<string>()
  async enviar(m: MensagemEmail) {
    if (m.para.some((p) => this.falharPara.has(p))) throw new Error('caixa cheia')
    this.enviados.push(m)
  }
}

async function preparar(opcoes: { falharLeitura?: () => boolean; emailLigado?: boolean } = {}) {
  const banco = await bancoLimpo()
  const email = new EmailFalso()
  email.ligado = opcoes.emailLigado ?? true
  const leitor: LeitorBitfin = {
    configurado: true,
    async ler(o?: { documentosMapa?: string[] }) {
      if (opcoes.falharLeitura?.()) throw new Error('Bitfin fora do ar')
      const docs = new Set((o?.documentosMapa ?? []).map((d) => documentoBitfin(d)))
      const mapa: DadosMapaBitfin | undefined = docs.size
        ? { ...structuredClone(dadosMapaExemplo), clientes: dadosMapaExemplo.clientes.filter((c) => docs.has(documentoBitfin(c.documento))) }
        : undefined
      return { dados: structuredClone(dadosFotoExemplo) as DadosFotoBitfin, mapa, tempoMs: {} }
    },
    async testar() {
      return { servidorAgora: '', banco: '' }
    },
    async buscarNomes(documentos: string[]) {
      if (opcoes.falharLeitura?.()) throw new Error('Bitfin fora do ar')
      const m = new Map<string, string>()
      for (const d of documentos) {
        const c = dadosMapaExemplo.clientes.find((x) => documentoBitfin(x.documento) === documentoBitfin(d))
        if (c) m.set(d, c.nome)
      }
      return m
    },
  }
  const deps = comporDependencias(configTeste({ DIRETORIO_URL: '', DIRETORIO_INTEGRATION_SECRET: '' }), { banco, armazenamento: new ArmazenamentoMemoria(), fonteFoto: new FonteFotoNenhuma(), leitorBitfin: leitor, email })
  const { rows } = await banco.pool.query(`INSERT INTO usuario (email, nome, perfil, origem) VALUES ('esp@grupoeverblue.com.br', 'Especialista', 'admin', 'local') RETURNING id`)
  const u = { id: String(rows[0].id), nome: 'Especialista', email: 'esp@grupoeverblue.com.br' }
  const agendada = async () => {
    const id = await deps.repos.fotos.iniciar({ origem: 'AGENDADA', solicitadoPor: USUARIO_AGENDADOR.id, gravarPosicao: false, versaoRegras: 't' })
    return deps.servicos.fotoBitfin.executar(id, { origem: 'AGENDADA', solicitante: USUARIO_AGENDADOR, gravarPosicao: false })
  }
  return { banco, deps, email, u, agendada }
}

describe('consultas do mapa', () => {
  it('documentos entram como parâmetro, nunca no texto; somente leitura', () => {
    const c = consultasMapa(3)
    expect(c.titulos).toContain('@d0, @d1, @d2')
    expect(c.titulos).not.toMatch(/[1-9]\d{10,}/)
    expect(documentoBitfin('93.894.954/0001-76')).toBe('093894954000176')
    expect(() => consultasMapa(0)).toThrow()
  })
})

describe.skipIf(!temBanco)('Mapa de Garantias (PostgreSQL real)', () => {
  it('foto agendada lê o mapa e envia: cada responsável os seus, cópias tudo, uma vez por dia', async () => {
    const { banco, deps, email, u, agendada } = await preparar()
    try {
      await deps.repos.mapa.incluirCliente('93894954000176', null, u.id)
      await deps.repos.mapa.incluirCliente('26054318000149', null, u.id)
      await deps.repos.mapa.incluirCliente('11111111000111', null, u.id) // não existe no Bitfin
      await deps.repos.mapa.incluirCopia('especialista@grupoeverblue.com.br', u.id)
      const f = await agendada()
      expect(f.status).toBe('CONCLUIDA')

      const m = (await deps.servicos.mapaGarantias.calcular())!
      expect(m.linhas.map((l) => l.nome)).toEqual(['Ddc Life Servicos de Escritorio Ltda', 'GF Pneus Comercial e Distribuidora Ltda'])
      expect(m.naoEncontrados).toEqual(['11111111000111'])
      const ddc = m.linhas[0]
      expect(ddc).toMatchObject({ exigibilidade: 189406.13, cobrancaVinculada: 278758.42, efeitoVagao: 16821.32, totalContasGraficas: 4286.78 })
      const gf = m.linhas[1]
      expect(gf).toMatchObject({ exigibilidade: 800000, efeitoVagao: 60000, totalManifesto: 16799.58, garantiasValidas: 883200.42 })

      const para = email.enviados.map((e) => e.para[0]).sort()
      expect(para).toEqual(['diretor@grupoeverblue.com.br', 'especialista@grupoeverblue.com.br', 'gerente.ddc@grupoeverblue.com.br', 'gerente.gf@grupoeverblue.com.br'])
      const gerenteGf = email.enviados.find((e) => e.para[0] === 'gerente.gf@grupoeverblue.com.br')!
      expect(gerenteGf.html).toContain('GF Pneus')
      expect(gerenteGf.html).not.toContain('Ddc Life')
      expect(gerenteGf.anexos[0].conteudo.subarray(0, 4).toString()).toBe('%PDF')
      const copia = email.enviados.find((e) => e.para[0] === 'especialista@grupoeverblue.com.br')!
      expect(copia.html).toContain('Ddc Life')
      expect(copia.html).toContain('Não encontrados no Bitfin')
      const envios = await deps.repos.mapa.envios()
      expect(envios.every((e) => e.status === 'ENVIADO' && e.origem === 'AGENDADO')).toBe(true)
      expect(envios[0].arquivoId).not.toBeNull()

      // segunda foto agendada no mesmo dia: não reenvia
      await banco.pool.query(`UPDATE foto_agendamento SET ultima_execucao_em = NULL`)
      await agendada()
      expect(email.enviados).toHaveLength(4)
      // registro de envio é append-only
      await expect(banco.pool.query(`DELETE FROM mapa_envio`)).rejects.toThrow(/append-only/)
    } finally {
      await banco.encerrar()
    }
  })

  it('foto agendada falhou: mapa não sai com dado velho e as cópias são avisadas', async () => {
    let falhar = false
    const { banco, deps, email, u, agendada } = await preparar({ falharLeitura: () => falhar })
    try {
      await deps.repos.mapa.incluirCliente('93894954000176', null, u.id)
      await deps.repos.mapa.incluirCopia('especialista@grupoeverblue.com.br', u.id)
      falhar = true
      const f = await agendada()
      expect(f.status).toBe('FALHOU')
      expect(email.enviados).toHaveLength(1)
      expect(email.enviados[0].assunto).toContain('NÃO enviado')
      expect(await deps.servicos.mapaGarantias.calcular()).toBeNull()
    } finally {
      await banco.encerrar()
    }
  })

  it('mapa do dia que não pode ser montado (nenhum cliente no Bitfin): cópias avisadas', async () => {
    const { banco, deps, email, u, agendada } = await preparar()
    try {
      await deps.repos.mapa.incluirCliente('11111111000111', null, u.id)
      await deps.repos.mapa.incluirCopia('especialista@grupoeverblue.com.br', u.id)
      expect((await agendada()).status).toBe('CONCLUIDA')
      expect(email.enviados).toHaveLength(1)
      expect(email.enviados[0].assunto).toBe('Mapa de Garantias NÃO enviado hoje')
      expect(email.enviados[0].texto).toContain('Nenhum cliente do mapa foi encontrado')
    } finally {
      await banco.encerrar()
    }
  })

  it('envio desligado ou com erro fica registrado como tal, nunca como enviado', async () => {
    const { banco, deps, email, u } = await preparar({ emailLigado: false })
    try {
      await deps.repos.mapa.incluirCliente('93894954000176', null, u.id)
      await deps.servicos.fotoBitfin.executar(await deps.repos.fotos.iniciar({ origem: 'MANUAL', solicitadoPor: u.id, gravarPosicao: false, versaoRegras: 't' }), { origem: 'MANUAL', solicitante: u, gravarPosicao: false })
      const r = await deps.servicos.mapaGarantias.enviar({ origem: 'MANUAL', solicitante: u })
      expect(r).toMatchObject({ enviados: 0, naoEnviados: 2 })
      expect((await deps.repos.mapa.envios()).map((e) => e.status)).toEqual(['NAO_ENVIADO', 'NAO_ENVIADO'])
      email.ligado = true
      email.falharPara.add('diretor@grupoeverblue.com.br')
      const r2 = await deps.servicos.mapaGarantias.enviar({ origem: 'MANUAL', solicitante: u })
      expect(r2).toMatchObject({ enviados: 1, falhas: 1 })
    } finally {
      await banco.encerrar()
    }
  })

  it('Bitfin fora do ar na inclusão: inclui com o nome pendente e avisa', async () => {
    const { banco, deps } = await preparar({ falharLeitura: () => true })
    try {
      const { rows } = await banco.pool.query(`SELECT id FROM usuario WHERE email = 'esp@grupoeverblue.com.br'`)
      const r = await deps.servicos.mapaGarantias.incluirCliente('93894954000176', rows[0].id)
      expect(r).toMatchObject({ situacao: 'INCLUIDO', nome: null })
      expect(r.aviso).toMatch(/próxima foto/)
    } finally {
      await banco.encerrar()
    }
  })

  it('HTTP: incluir por CNPJ, duplicado, dedução manual com responsável, PDF', async () => {
    const { banco, deps } = await preparar()
    const app = await construirServidor(deps)
    try {
      const { rows } = await banco.pool.query(`SELECT id FROM usuario WHERE email = 'esp@grupoeverblue.com.br'`)
      const headers = { cookie: `emon_sessao=${await deps.sessao.emitir(rows[0].id)}`, origin: 'https://monitoramento.teste' }
      // Nome (razão social) vem do Bitfin na inclusão; quem estava sem nome é preenchido junto.
      await deps.repos.mapa.incluirCliente('26054318000149', null, rows[0].id)
      const inc = await app.inject({ method: 'POST', url: '/api/v1/mapa-garantias/clientes', payload: { documento: '93.894.954/0001-76' }, headers })
      expect(inc.statusCode).toBe(201)
      const nomeEsperado = dadosMapaExemplo.clientes.find((c) => documentoBitfin(c.documento) === documentoBitfin('93894954000176'))!.nome
      expect(inc.json()).toMatchObject({ documento: '93894954000176', nome: nomeEsperado, aviso: null })
      const lista = await deps.repos.mapa.clientes()
      expect(lista.find((c) => c.documento === '93894954000176')!.nome).toBe(nomeEsperado)
      expect(lista.find((c) => c.documento === '26054318000149')!.nome).toBeTruthy()
      // Não existe no Bitfin: recusa (CNPJ digitado errado não entra).
      const errado = await app.inject({ method: 'POST', url: '/api/v1/mapa-garantias/clientes', payload: { documento: '11.222.333/0001-81' }, headers })
      expect(errado.statusCode).toBe(422)
      expect(errado.json().codigo).toBe('nao_encontrado_bitfin')
      // Dígito verificador errado nem chega ao Bitfin (esquema compartilhado com a tela).
      expect((await app.inject({ method: 'POST', url: '/api/v1/mapa-garantias/clientes', payload: { documento: '11.111.111/0001-11' }, headers })).statusCode).toBe(400)
      expect((await app.inject({ method: 'POST', url: '/api/v1/mapa-garantias/clientes', payload: { documento: '93894954000176' }, headers })).statusCode).toBe(409)
      expect((await app.inject({ method: 'POST', url: '/api/v1/mapa-garantias/clientes', payload: { documento: '123' }, headers })).statusCode).toBe(400)
      expect((await app.inject({ method: 'POST', url: '/api/v1/mapa-garantias/copias', payload: { email: 'Especialista@GrupoEverblue.com.br' }, headers })).statusCode).toBe(201)
      const cfg = await app.inject({
        method: 'PUT',
        url: '/api/v1/mapa-garantias/clientes/93894954000176/config',
        payload: { contasGraficas: null, deducoes: [{ valor: 9533.3, justificativa: 'Títulos já regularizados' }], concentracaoExcedida: 'Sacado X acima de 30%', sacadoComRestricao: null },
        headers,
      })
      expect(cfg.statusCode).toBe(204)
      await deps.servicos.fotoBitfin.executar(await deps.repos.fotos.iniciar({ origem: 'MANUAL', solicitadoPor: rows[0].id, gravarPosicao: false, versaoRegras: 't' }), {
        origem: 'MANUAL',
        solicitante: { id: rows[0].id, nome: 'Especialista', email: 'esp@grupoeverblue.com.br' },
        gravarPosicao: false,
      })
      const tela = (await app.inject({ method: 'GET', url: '/api/v1/mapa-garantias', headers })).json()
      expect(tela.copias.map((c: { email: string }) => c.email)).toEqual(['especialista@grupoeverblue.com.br'])
      const gf = tela.calculado.linhas.find((l: { documento: string }) => l.documento.replace(/\D/g, '').endsWith('93894954000176'))
      expect(gf.deducoesManuais).toBe(9533.3)
      expect(gf.deducoes[0]).toMatchObject({ responsavel: 'Especialista', justificativa: 'Títulos já regularizados' })
      expect(gf.concentracaoExcedida.texto).toBe('Sacado X acima de 30%')
      const pdf = await app.inject({ method: 'GET', url: '/api/v1/mapa-garantias/pdf', headers })
      expect(pdf.headers['content-type']).toBe('application/pdf')
      expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF')
      expect((await app.inject({ method: 'DELETE', url: '/api/v1/mapa-garantias/clientes/93894954000176', headers })).statusCode).toBe(204)
    } finally {
      await app.close()
      await banco.encerrar()
    }
  })
})
