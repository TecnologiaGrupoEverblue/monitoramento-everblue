export function normalizarCnpj(cnpj: string): string {
  return cnpj.replace(/\D/g, '')
}
