import type { FieldErrors, FieldValues } from 'react-hook-form'

/** Primeira mensagem de erro de um formulário, inclusive em campos aninhados
 * e listas (React Hook Form + zod). Ignora a referência ao elemento da tela. */
export function primeiraMensagem<T extends FieldValues>(erros: FieldErrors<T> | undefined): string | null {
  const visitar = (e: unknown): string | null => {
    if (!e || typeof e !== 'object') return null
    const m = (e as { message?: unknown }).message
    if (typeof m === 'string' && m) return m
    for (const [chave, v] of Object.entries(e)) {
      if (chave === 'ref' || chave === 'types') continue
      const r = visitar(v)
      if (r) return r
    }
    return null
  }
  return visitar(erros)
}
