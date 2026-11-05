import { describe, expect, it } from 'vitest'
import {
  esquemaAgendamentoFoto,
  esquemaAgendamentoFotoCorpo,
  esquemaAndamentoPlano,
  esquemaConfigMapaCliente,
  esquemaCpfCnpj,
  esquemaDecisaoComite,
  esquemaEmail,
  esquemaEtiquetasArquivo,
  esquemaRestritivos,
  lerEtiquetas,
  lerValorBr,
} from '../src'

/** Esquemas compartilhados entre a API e os formulários: a mesma regra nos
 * dois lados (skill Everblue, Front-end React). */
describe('esquemas compartilhados', () => {
  it('CPF/CNPJ: aceita com ou sem máscara, confere dígito verificador e devolve só dígitos', () => {
    expect(esquemaCpfCnpj.parse('11.222.333/0001-81')).toBe('11222333000181')
    expect(esquemaCpfCnpj.parse(' 529.982.247-25 ')).toBe('52998224725')
    expect(esquemaCpfCnpj.safeParse('11.222.333/0001-82').success).toBe(false)
    expect(esquemaCpfCnpj.safeParse('111.111.111-11').success).toBe(false)
    expect(esquemaCpfCnpj.safeParse('11.111.111/0001-11').success).toBe(false)
    expect(esquemaCpfCnpj.safeParse('123').success).toBe(false)
  })

  it('e-mail: normaliza e recusa inválido', () => {
    expect(esquemaEmail.parse('  Fulano@GrupoEverblue.com.br ')).toBe('fulano@grupoeverblue.com.br')
    expect(esquemaEmail.safeParse('fulano@').success).toBe(false)
  })

  it('lerValorBr: padrão brasileiro, milhares, decimal com ponto e texto inválido', () => {
    expect(lerValorBr('1.234,56')).toBe(1234.56)
    expect(lerValorBr('R$ 1.234,56')).toBe(1234.56)
    expect(lerValorBr('1234,5')).toBe(1234.5)
    expect(lerValorBr('10.000')).toBe(10000)
    expect(lerValorBr('1.234.567')).toBe(1234567)
    expect(lerValorBr('1234.5')).toBe(1234.5)
    expect(lerValorBr('12')).toBe(12)
    expect(lerValorBr('')).toBeNull()
    expect(lerValorBr('abc')).toBeNull()
    expect(lerValorBr('1,2,3')).toBeNull()
    expect(lerValorBr('12.34,5')).toBeNull()
  })

  it('agendamento da foto: dia da posição precisa ser um dos dias da foto (tela); a API aceita o corpo e responde 422', () => {
    const base = { ativo: true, horario: '08:00', diasSemana: [1, 3], diaPosicaoSemanal: 5 }
    expect(esquemaAgendamentoFoto.safeParse(base).success).toBe(false)
    expect(esquemaAgendamentoFotoCorpo.safeParse(base).success).toBe(true)
    expect(esquemaAgendamentoFoto.safeParse({ ...base, diaPosicaoSemanal: 3 }).success).toBe(true)
    expect(esquemaAgendamentoFoto.safeParse({ ...base, horario: '25:00', diaPosicaoSemanal: null }).success).toBe(false)
    expect(esquemaAgendamentoFoto.safeParse({ ...base, diasSemana: [], diaPosicaoSemanal: null }).success).toBe(false)
  })

  it('andamento do plano e decisão: campos obrigatórios e corpo estrito', () => {
    expect(esquemaAndamentoPlano.safeParse({ responsavel: '  ' }).success).toBe(false)
    expect(esquemaAndamentoPlano.safeParse({ dataLimite: '31/12/2026' }).success).toBe(false)
    expect(esquemaAndamentoPlano.safeParse({ extra: 1 }).success).toBe(false)
    expect(esquemaDecisaoComite.safeParse({ clienteId: 'cli_1', decisao: '', prazo: '2026-12-01' }).success).toBe(false)
    expect(esquemaDecisaoComite.parse({ clienteId: 'cli_1', decisao: ' Manter ', prazo: '2026-12-01' })).toEqual({
      clienteId: 'cli_1',
      decisao: 'Manter',
      plano: '',
      prazo: '2026-12-01',
      responsavel: '',
    })
  })

  it('restritivos e Mapa: limites numéricos e textos mínimos', () => {
    expect(esquemaRestritivos.safeParse({ linhas: [{ tipo: 'PEFIN', quantidade: 1.5, valor: 10 }] }).success).toBe(false)
    expect(esquemaRestritivos.safeParse({ linhas: [{ tipo: 'PEFIN', quantidade: 2, valor: -1 }] }).success).toBe(false)
    expect(esquemaRestritivos.safeParse({ linhas: [{ tipo: 'PEFIN', quantidade: 2, valor: 10 }] }).success).toBe(true)
    const config = { contasGraficas: null, deducoes: [{ valor: 10, justificativa: 'ok' }], concentracaoExcedida: null, sacadoComRestricao: null }
    expect(esquemaConfigMapaCliente.safeParse(config).success).toBe(false)
    expect(esquemaConfigMapaCliente.safeParse({ ...config, deducoes: [{ valor: 10, justificativa: 'Título em disputa' }] }).success).toBe(true)
  })

  it('etiquetas do arquivo: uma por linha, chave=valor, no máximo 30', () => {
    expect(lerEtiquetas('cliente=ACME\n\nano = 2026\nurl=a=b')).toEqual({ cliente: 'ACME', ano: '2026', url: 'a=b' })
    const muitas = Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`k${i}`, 'v']))
    expect(esquemaEtiquetasArquivo.safeParse(muitas).success).toBe(false)
  })
})
