/** Orçamento agregado de conexões e limites do Bitfin validados no boot (ADR-020). */
import { describe, expect, it } from 'vitest'
import { configTeste } from './apoio'

describe('configuração de conexões', () => {
  it('recusa pool da API que estoura o orçamento aprovado do PostgreSQL', () => {
    expect(() => configTeste({ DATABASE_POOL_MAX: '40', DATABASE_CONEXOES_APROVADAS: '40' })).toThrow(/Orçamento de conexões do PostgreSQL excedido/)
    expect(() => configTeste({ DATABASE_POOL_MAX: '34', DATABASE_CONEXOES_APROVADAS: '40' })).not.toThrow()
  })

  it('limites padrão do Bitfin: teto por classe, fila pequena e disjuntor', () => {
    const p = configTeste().bitfin.protecao
    expect(p).toEqual({ prazoFotoMs: 900_000, timeoutNomesMs: 15_000, filaMax: 3, esperaFilaFotoMs: 60_000, esperaFilaNomesMs: 10_000, disjuntorFalhas: 3, disjuntorAbertoMs: 300_000 })
    expect(configTeste().bitfin.timeoutMs).toBe(180_000)
  })
})
