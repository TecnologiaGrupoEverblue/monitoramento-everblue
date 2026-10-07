/**
 * Revisão 1.1.1 (skill de desenvolvimento Everblue): bomba de descompressão,
 * validação semântica, auditoria com valor anterior, atraso automático sem
 * duplicidade sob concorrência e "não avaliado" em vez de silêncio.
 */
import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { classificarCliente, limiaresDe, validarNovoLimiar, type SnapshotSemanal } from '@monitoramento/dominio'
import { comporDependencias } from '../src/composicao'
import { ArmazenamentoMemoria } from '../src/infra/armazenamento'
import { FonteFotoNenhuma } from '../src/identidade/fontesFoto'
import { inspecionarZip } from '../src/servicos/inspecaoZip'
import { configTeste } from './apoio'
import { bancoLimpo, temBanco } from './banco'

/** ZIP mínimo (uma entrada, deflate) montado à mão — o suficiente para o leitor de diretório central. */
function zipCom(nome: string, conteudo: Buffer): Buffer {
  const dados = deflateRawSync(conteudo)
  const n = Buffer.from(nome)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(8, 8)
  local.writeUInt32LE(dados.length, 18)
  local.writeUInt32LE(conteudo.length, 22)
  local.writeUInt16LE(n.length, 26)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(8, 10)
  central.writeUInt32LE(dados.length, 20)
  central.writeUInt32LE(conteudo.length, 24)
  central.writeUInt16LE(n.length, 28)
  const inicioCentral = local.length + n.length + dados.length
  const fim = Buffer.alloc(22)
  fim.writeUInt32LE(0x06054b50, 0)
  fim.writeUInt16LE(1, 8)
  fim.writeUInt16LE(1, 10)
  fim.writeUInt32LE(central.length + n.length, 12)
  fim.writeUInt32LE(inicioCentral, 16)
  return Buffer.concat([local, n, dados, central, n, fim])
}

describe('inspeção de ZIP antes de ler a planilha', () => {
  it('aceita conteúdo normal e recusa bomba de descompressão', () => {
    expect(inspecionarZip(zipCom('xl/sheet1.xml', Buffer.from('<a>1</a>'.repeat(1000))))).toMatchObject({ ok: true, entradas: 1 })
    const bomba = zipCom('xl/sheet1.xml', Buffer.alloc(50 * 1024 * 1024, 0))
    expect(bomba.length).toBeLessThan(200_000)
    expect(inspecionarZip(bomba)).toMatchObject({ ok: false, motivo: 'taxa de compressão suspeita' })
    expect(inspecionarZip(Buffer.from('não é zip'.repeat(5)))).toMatchObject({ ok: false })
  })
})

describe('validação semântica dos limiares', () => {
  it('recusa fora da faixa e ordem invertida', () => {
    expect(validarNovoLimiar('VENCIDO_CRITICO_PERC', 150, [])).toMatch(/máximo/)
    expect(validarNovoLimiar('IL30_CRITICO', 80, [])).toMatch(/crítico precisa ser menor/) // atenção = 70
    expect(validarNovoLimiar('RISCO_CRITICO_VALOR', 100_000, [])).toMatch(/aumento de risco/) // atenção = 250 mil
    expect(validarNovoLimiar('IL30_CRITICO', 60, [])).toBeNull()
  })
})

describe('classificação aponta o que não avaliou', () => {
  it('dado ausente aparece como não avaliado, não como regular silencioso', () => {
    const s = { riscoCliente: 1e6, riscoGrupo: 1e6, limiteGlobal: 2e6, statusProposta: 'APROVADA', trancheConsolidada: 0, valorEmAndamento: 0, vencidoOficial: 0, il30: null, il60: null, il90: null, recompras: 0, manifestoInacessivel: 0, manifestoNaoConfirma: 0, manifestoTransacaoDesconhecida: 0, manifestoLastroInconsistente: 0, manifestoTransacaoNaoConcluida: 0 } as unknown as SnapshotSemanal
    const c = classificarCliente({ status: 'NORMAL', carteiraApartada: false, atual: s, anterior: null }, limiaresDe([]))
    expect(c.criticidade).toBe('REGULAR')
    expect(c.naoAvaliados).toEqual(expect.arrayContaining(['Variação de risco (sem posição anterior)', 'Liquidez 30 dias (sem base)', 'Prorrogações acima de 60 dias (não informadas)']))
  })
})

describe.skipIf(!temBanco)('regras de negócio no banco', () => {
  it('atraso automático gera um evento só, mesmo com leituras simultâneas; prazo e semana validados', async () => {
    const banco = await bancoLimpo()
    try {
      const deps = comporDependencias(configTeste({ DIRETORIO_URL: '', DIRETORIO_INTEGRATION_SECRET: '' }), { banco, armazenamento: new ArmazenamentoMemoria(), fonteFoto: new FonteFotoNenhuma() })
      await banco.pool.query(`
        INSERT INTO grupo_economico VALUES ('g1', 'G'); INSERT INTO gerente VALUES ('ge1', 'Ger', NULL); INSERT INTO plataforma VALUES ('p1', 'P');
        INSERT INTO cliente (id, nome, cnpj, grupo_economico_id, gerente_id, plataforma_id, setor, ramo_atividade, status, prioridade, criticidade, responsavel)
        VALUES ('c1', 'Um', '11.111.111/0001-11', 'g1', 'ge1', 'p1', 'S', 'R', 'MONITORAMENTO', 'MEDIA', 'ATENCAO', 'Ger');
        INSERT INTO plano_acao (id, cliente_id, decisao_atual, data_decisao_atual, prazo_regularizacao, plano, responsavel, status, data_limite)
        VALUES ('pl1', 'c1', 'Reduzir', '2026-01-01', '2026-01-10', 'Plano', 'Ger', 'EM_DIA', '2026-01-10');`)
      await Promise.all(Array.from({ length: 5 }, () => deps.repos.planos.listarTodos()))
      const { rows } = await banco.pool.query(`SELECT usuario, justificativa FROM evento_historico WHERE cliente_id = 'c1' AND tipo = 'PLANO_ACAO'`)
      expect(rows).toHaveLength(1)
      expect(rows[0].justificativa).toMatch(/atrasado automaticamente/)

      const ator = { id: '00000000-0000-4000-8000-000000000001', nome: 'A', email: 'a@x' }
      await expect(deps.servicos.planos.registrarAndamento('pl1', { dataLimite: '2025-12-31' }, ator)).rejects.toThrow(/anterior à data da decisão/)
      await expect(deps.servicos.restritivos.gravar('c1', '2026-09-24', [{ tipo: 'PEFIN', quantidade: 1, valor: 1 }], ator)).rejects.toThrow(/Não há posição/)
    } finally {
      await banco.encerrar()
    }
  })
})
