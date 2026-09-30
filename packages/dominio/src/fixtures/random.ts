/** PRNG determinístico (mulberry32) — garante que os dados fictícios gerados
 * na primeira execução sejam sempre os mesmos, facilitando testes e suporte. */
export function criarRng(seed: number) {
  let a = seed
  return function rng(): number {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type Rng = ReturnType<typeof criarRng>

export function randomInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min
}

export function randomFloat(rng: Rng, min: number, max: number, casas = 2): number {
  const valor = rng() * (max - min) + min
  const fator = 10 ** casas
  return Math.round(valor * fator) / fator
}

export function pick<T>(rng: Rng, lista: readonly T[]): T {
  return lista[randomInt(rng, 0, lista.length - 1)]
}

export function pickMany<T>(rng: Rng, lista: readonly T[], quantidade: number): T[] {
  const copia = [...lista]
  const resultado: T[] = []
  for (let i = 0; i < quantidade && copia.length > 0; i++) {
    const idx = randomInt(rng, 0, copia.length - 1)
    resultado.push(copia[idx])
    copia.splice(idx, 1)
  }
  return resultado
}

export function chance(rng: Rng, probabilidade: number): boolean {
  return rng() < probabilidade
}

export function pesoAleatorio<T>(rng: Rng, opcoes: Array<[T, number]>): T {
  const total = opcoes.reduce((soma, [, peso]) => soma + peso, 0)
  let alvo = rng() * total
  for (const [valor, peso] of opcoes) {
    if (alvo < peso) return valor
    alvo -= peso
  }
  return opcoes[opcoes.length - 1][0]
}

let contadorId = 0
/** Usado só na semeadura inicial (gerarDadosFicticios): o contador reinicia
 * a cada reload de página, mas como a semeadura roda inteira de uma vez só
 * a partir de um banco vazio, isso mantém o dataset fictício reproduzível
 * entre execuções (mesmos IDs, úteis para debug/suporte). */
export function novoId(prefixo: string): string {
  contadorId += 1
  return `${prefixo}_${contadorId.toString(36)}`
}

/** Usado por qualquer criação em tempo de execução (repositórios: planos,
 * alertas, eventos, importação semanal, etc.) — ao contrário de `novoId`,
 * não reinicia de forma previsível a cada reload, então não colide com o
 * que a semeadura já gravou numa sessão anterior. */
export function novoIdSessao(prefixo: string): string {
  return `${prefixo}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`
}
