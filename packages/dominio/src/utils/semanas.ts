/** Navegação entre posições semanais disponíveis. Funções puras, usadas pela
 * API (agregações) e pela interface (rótulos de comparação). */
export function semanaAnteriorRef(semanas: string[], semanaRef: string): string | null {
  const idx = semanas.indexOf(semanaRef)
  return idx > 0 ? semanas[idx - 1] : null
}

/** Retorna a semanaRef ~4 semanas antes (aprox. "mês anterior") dentro da lista disponível. */
export function semanaMesAnteriorRef(semanas: string[], semanaRef: string): string | null {
  const idx = semanas.indexOf(semanaRef)
  if (idx < 0) return null
  const alvo = idx - 4
  return alvo >= 0 ? semanas[alvo] : null
}
