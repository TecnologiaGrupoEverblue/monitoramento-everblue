/** Hash de senha da conta de emergência (Argon2id). */
import { hash, verify } from '@node-rs/argon2'

const PARAMETROS = { memoryCost: 65536, timeCost: 3, parallelism: 2 } as const

export async function gerarHashSenha(senha: string): Promise<string> {
  return hash(senha, PARAMETROS)
}

export async function conferirSenha(hashArmazenado: string, senha: string): Promise<boolean> {
  try {
    return await verify(hashArmazenado, senha)
  } catch {
    return false
  }
}

/** Regra mínima verificada no servidor. Devolve o motivo da recusa. */
export function senhaAceitavel(senha: string): string | null {
  if (senha.length < 12) return 'A senha deve ter ao menos 12 caracteres.'
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z0-9]/].filter((r) => r.test(senha)).length
  if (classes < 3) return 'A senha deve combinar ao menos três entre: minúscula, maiúscula, número e símbolo.'
  return null
}
