import { CAMPOS_IMPORTACAO, somarLinhasDoMesmoCliente, validarLinhasPlanilha, type LinhaValidada } from '@monitoramento/dominio'
import { describe, expect, it } from 'vitest'
import { agruparLinhasDoMesmoCliente } from '../src/servicos/servicoImportacao'

// Caso real de 23/10/2026: Mauro Siqueira de Moura Junior Ltda, cadastrada como
// um cliente só com as filiais 0002-28 e 0005-70, veio em duas linhas (20 e 21).
const cabecalho = CAMPOS_IMPORTACAO.map((c) => c.coluna)
function linha(cnpj: string, extra: Partial<Record<string, string>> = {}): string[] {
  const valores: Record<string, string> = {
    Cliente: 'Mauro Siqueira de Moura Junior Ltda', CNPJ: cnpj, 'Grupo Econômico': 'Grupo M', Gerente: 'Gerente M',
    'Plataforma Comercial': 'Plataforma M', Setor: 'Indústria', 'Ramo de Atividade': 'Metal', 'Produtos (separados por ;)': 'Desconto de Duplicatas',
    'Status (NORMAL, MONITORAMENTO, SAIDA_DE_RISCO, JURIDICO)': 'NORMAL',
    'Status da Proposta (EM_ANALISE, APROVADA, VENCIDA, REPROVADA)': 'APROVADA', ...extra,
  }
  return cabecalho.map((c) => valores[c] ?? '1')
}
function duasFiliais(): LinhaValidada[] {
  const r = validarLinhasPlanilha([
    cabecalho,
    linha('31.404.784/0002-28', { 'Risco do Cliente (R$)': '1735900', 'Vencido Oficial (R$)': '100000', 'IL 30 dias (%)': '80' }),
    linha('31.404.784/0005-70', {
      'Risco do Cliente (R$)': '1396526.47', 'Vencido Oficial (R$)': '50000', 'IL 30 dias (%)': '40',
      'Status (NORMAL, MONITORAMENTO, SAIDA_DE_RISCO, JURIDICO)': 'MONITORAMENTO', 'Aging da Carteira (dias)': '45',
    }),
  ])
  expect(r.comErro).toEqual([])
  return r.validas
}

describe('linhas diferentes do mesmo cliente', () => {
  it('somam valores, ponderam percentuais e mantêm o pior status', () => {
    const [a, b] = duasFiliais()
    const s = somarLinhasDoMesmoCliente([b, a])
    expect(s.linha).toBe(a.linha)
    expect(s.riscoCliente).toBeCloseTo(3132426.47)
    expect(s.vencidoOficial).toBe(150000)
    expect(s.status).toBe('MONITORAMENTO')
    expect(s.agingCarteiraDias).toBe(45)
    expect(s.il30).toBeCloseTo((80 * 1735900 + 40 * 1396526.47) / 3132426.47)
    expect(s.documentos).toEqual(['31.404.784/0002-28', '31.404.784/0005-70'])
    expect(s.avisos?.some((x) => /foram somadas/.test(x))).toBe(true)
  })

  it('percentual ausente em todas as linhas continua ausente (não vira 0)', () => {
    const [a, b] = duasFiliais()
    const s = somarLinhasDoMesmoCliente([{ ...a, il180: null }, { ...b, il180: null }])
    expect(s.il180).toBeNull()
  })

  it('a prévia junta as duas linhas numa posição só para o cliente existente', () => {
    const [a, b] = duasFiliais()
    const cliente = { id: 'cli_mauro' }
    const outra = { ...a, linha: 99, cnpj: '11.111.111/0001-11', documentos: ['11.111.111/0001-11'] }
    const linhas = [
      { linha: a, existente: cliente, documentosNovos: [] as string[] },
      { linha: outra, existente: { id: 'cli_outro' }, documentosNovos: [] as string[] },
      { linha: b, existente: cliente, documentosNovos: [] as string[] },
    ]
    agruparLinhasDoMesmoCliente(linhas, () => false)
    expect(linhas).toHaveLength(2)
    expect(linhas.filter((l) => l.existente.id === 'cli_mauro')).toHaveLength(1)
    expect(linhas[0].linha.riscoCliente).toBeCloseTo(3132426.47)
    expect(linhas[1].linha.linha).toBe(99)
  })

  it('clientes novos não são juntados', () => {
    const [a, b] = duasFiliais()
    const linhas = [
      { linha: a, existente: null, documentosNovos: ['31.404.784/0002-28'] },
      { linha: b, existente: null, documentosNovos: ['31.404.784/0005-70'] },
    ]
    agruparLinhasDoMesmoCliente(linhas, () => true)
    expect(linhas).toHaveLength(2)
  })
})
