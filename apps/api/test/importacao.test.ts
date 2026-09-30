import { CAMPOS_IMPORTACAO, validarLinhasPlanilha } from '@monitoramento/dominio'
import { describe, expect, it } from 'vitest'
import { detectarFormato, lerLinhasPlanilha, nomeSeguro, separarCnpjsRepetidos } from '../src/servicos/servicoImportacao'
import { readFileSync } from 'node:fs'

const cabecalho = CAMPOS_IMPORTACAO.map((c) => c.coluna)
function linha(cnpj: string, extra: Partial<Record<string, string>> = {}): string[] {
  const valores: Record<string, string> = {
    Cliente: 'Empresa Teste', CNPJ: cnpj, 'Grupo Econômico': 'Grupo T', Gerente: 'Gerente T', 'Plataforma Comercial': 'Plataforma T',
    Setor: 'Serviços', 'Ramo de Atividade': 'Consultoria', 'Produtos (separados por ;)': 'Desconto de Duplicatas',
    'Status (NORMAL, MONITORAMENTO, SAIDA_DE_RISCO, JURIDICO)': 'MONITORAMENTO',
    'Status da Proposta (EM_ANALISE, APROVADA, VENCIDA, REPROVADA)': 'APROVADA', ...extra,
  }
  return cabecalho.map((c) => valores[c] ?? '1')
}

describe('leitura e validação da planilha', () => {
  it('detecta formato pelo conteúdo, não pela extensão', () => {
    expect(detectarFormato(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1]))).toBe('xlsx')
    expect(detectarFormato(Buffer.from('a;b\n1;2'))).toBe('csv')
    expect(detectarFormato(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0]))).toBeNull()
    expect(detectarFormato(Buffer.alloc(0))).toBeNull()
  })
  it('nome de arquivo sem caminho nem controle', () => {
    expect(nomeSeguro('../../etc/passwd')).toBe('passwd')
    expect(nomeSeguro('C:\\x\\plan\u0000ilha.xlsx')).toBe('planilha.xlsx')
  })
  it('CSV com ; e formato brasileiro', async () => {
    const csv = [cabecalho, linha('11.111.111/0001-11', { 'Risco do Cliente (R$)': '1.234.567,89' })].map((l) => l.map((v) => `"${v}"`).join(';')).join('\n')
    const linhas = await lerLinhasPlanilha(Buffer.from(csv), 'csv')
    const r = validarLinhasPlanilha(linhas)
    expect(r.colunasFaltando).toEqual([])
    expect(r.validas[0].riscoCliente).toBeCloseTo(1234567.89)
    expect(r.validas[0].produtos).toEqual(['Desconto de Duplicatas'])
  })
  it('CNPJ repetido na mesma planilha vira erro, não duplicidade', () => {
    const r = separarCnpjsRepetidos(validarLinhasPlanilha([cabecalho, linha('11.111.111/0001-11'), linha('11111111000111')]))
    expect(r.validas).toHaveLength(1)
    expect(r.comErro[0].erros[0]).toMatch(/repetido/)
  })
  it('lê a planilha modelo oficial (.xlsx)', async () => {
    const conteudo = readFileSync(new URL('../../web/public/modelos/modelo_importacao_semanal.xlsx', import.meta.url))
    expect(detectarFormato(conteudo)).toBe('xlsx')
    const r = validarLinhasPlanilha(await lerLinhasPlanilha(conteudo, 'xlsx'))
    expect(r.colunasFaltando).toEqual([])
    expect(r.comErro).toEqual([])
    expect(r.validas.length).toBeGreaterThan(0)
  })
})
