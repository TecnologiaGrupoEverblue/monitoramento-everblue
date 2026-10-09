/**
 * Segundo layout (1.1.5): a base do comitê ("Análise da Carteira") é aceita
 * como ela é, convertida para o modelo e validada pela MESMA regra.
 * Fixture SINTÉTICA (nomes e documentos fictícios) com o cabeçalho real da base.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { agingDoVencido, CAMPOS_IMPORTACAO, converterBaseComite, validarLinhasPlanilha } from '@monitoramento/dominio'
import { describe, expect, it } from 'vitest'
import { construirSnapshotParcial, lerPlanilhaImportacao, separarCnpjsRepetidos } from '../src/servicos/servicoImportacao'

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/base-comite-sintetica.xlsx')

describe('base do comitê como segundo layout', () => {
  it('reconhece a aba, converte e valida com a mesma regra do modelo', async () => {
    const leitura = await lerPlanilhaImportacao(readFileSync(FIXTURE), 'xlsx')
    expect(leitura.formato).toBe('BASE_COMITE')
    expect(leitura.colunasFaltando).toEqual([])
    expect(leitura.linhas[0]).toEqual(CAMPOS_IMPORTACAO.map((c) => c.coluna)) // virou o layout do modelo
    const r = separarCnpjsRepetidos(validarLinhasPlanilha(leitura.linhas, leitura.opcoes))

    // Risco vazio não vira 0: a linha é recusada, com o número da linha DA BASE.
    expect(r.comErro).toEqual([{ linha: 9, erros: [expect.stringMatching(/Risco do Cliente/)] }])
    expect(r.validas.map((v) => v.linha)).toEqual([6, 7, 8])

    const [alfa, beta, gama] = r.validas
    expect(alfa).toMatchObject({
      nome: 'Alfa Teste Ltda',
      cnpj: '11.222.333/0001-81', // zero extra e caractere invisível removidos
      carteira: 'EVERBLUE',
      plataforma: 'EVERBLUE',
      status: 'MONITORAMENTO',
      statusProposta: 'APROVADA', // VIGENTE
      validadeProposta: '2026-12-31',
      produtos: ['Faturizacao', 'Comissaria'],
      vencidoDesde: '2026-09-22', // data lida em UTC
      prazoMedioCarteiraDias: 56, // "55,6" + observação
      il30: 81,
      il180: null, // SEM BASE continua sem base
      manifestoPercSemAtuacao: 12,
      percLiquidadoNoPrazo: 90,
      atrasoMedioDias: 3.3,
      recompras: 0,
      prorrogacoesAcima60d: 120000,
      operacoesMesAnterior: 900000,
      operacoesMes: 300000,
      agingDerivadoDoVencido: true,
    })
    expect(alfa.avisos).toContainEqual(expect.stringMatching(/número com observação na célula: usado 55,6/))
    expect(beta).toMatchObject({ carteira: 'QUATTUOR', status: 'NORMAL', gerente: 'Sem Gerente' })
    expect(gama).toMatchObject({ status: 'SAIDA_DE_RISCO', statusProposta: 'SEM_PROPOSTA', documentos: ['33.444.555/0001-10', '33.444.555/0002-00'], il30: null })

    expect(leitura.observacoes.join('\n')).toMatch(/cabeçalho na linha 5/)
    expect(leitura.observacoes.join('\n')).toMatch(/Colunas novas na base, ignoradas: Coluna Nova Teste/)
    expect(leitura.observacoes.join('\n')).toMatch(/Não importadas.*Enquadramento.*Plano de Ação/)
    expect(leitura.observacoes.join('\n')).toMatch(/1 cliente\(s\) com status "QUATTUOR"/)
    expect(leitura.observacoes.join('\n')).toMatch(/1 linha\(s\) sem cliente e sem documento ignoradas/)

    // Aging: calculado na semana escolhida (pode mudar na prévia).
    expect(construirSnapshotParcial(alfa, '2026-10-01', 'c1').agingCarteiraDias).toBe(9)
    expect(construirSnapshotParcial(alfa, '2026-10-08', 'c1').agingCarteiraDias).toBe(16)
    expect(agingDoVencido(null, '2026-10-08')).toBe(0)
  })

  it('colunas em outra ordem funcionam; coluna essencial ausente recusa a carga', () => {
    const cab = ['Gerente', 'Cliente', 'Documento(s)', 'Carteira', 'Grupo Econômico', 'Setor', 'Ramo de atividade', 'Produtos', 'Status do cliente', 'Risco do cliente', 'Limite global', 'Status da proposta', 'Validade', 'Tranche consolidada', 'Em andamento', 'Vencido oficial', 'Vencido desde', 'Prazo médio carteira (dias)', 'IL 30d', 'IL 60d', 'IL 90d', 'IL 120d', 'IL 150d', 'IL 180d', 'Sem atuação manifesto %', 'Inacessível R$', 'Não confirma R$', 'Transação desconhecida R$', 'Lastro inconsistente R$', 'Transação não concluída R$', 'Liquidado no export', 'Recompras R$', '% liquidado no prazo', 'Atraso médio (dias)']
    const valores: Record<string, unknown> = { Gerente: 'G', Cliente: 'Zeta', 'Documento(s)': '55.666.777/0001-30', Carteira: 'EVERBLUE', 'Grupo Econômico': 'GZ', 'Status do cliente': 'NORMAL', 'Risco do cliente': '1.234.567,89', 'Limite global': '10.000', 'Status da proposta': 'VIGENTE' }
    const linha = cab.map((c) => valores[c] ?? 0)
    const c = converterBaseComite([cab, linha])
    const r = validarLinhasPlanilha(c.linhas, { linhasOrigem: c.linhasOrigem, avisosPorLinha: c.avisosPorLinha })
    expect(r.comErro).toEqual([])
    expect(r.validas[0]).toMatchObject({ nome: 'Zeta', gerente: 'G', riscoCliente: 1234567.89, limiteGlobal: 10000, linha: 2 })

    const semIl = converterBaseComite([cab.filter((n) => n !== 'IL 30d'), linha])
    expect(semIl.colunasFaltando).toEqual(['IL 30d (base do comitê)'])
    expect(semIl.linhas).toEqual([])
  })

  it('planilha que não é nenhum dos dois layouts segue como modelo e a validação aponta o que falta', async () => {
    const leitura = await lerPlanilhaImportacao(Buffer.from('a;b;c\n1;2;3'), 'csv')
    expect(leitura.formato).toBe('MODELO')
    expect(validarLinhasPlanilha(leitura.linhas).colunasFaltando.length).toBeGreaterThan(10)
  })
})
