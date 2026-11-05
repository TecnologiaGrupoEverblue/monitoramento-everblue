export function normalizarCnpj(cnpj: string): string {
  return cnpj.replace(/\D/g, '')
}

/** CPF/CNPJ para leitura: 00.000.000/0000-00 ou 000.000.000-00; outro formato volta como veio. */
export function formatarDocumento(documento: string | null | undefined): string {
  if (!documento) return '—'
  const d = normalizarCnpj(documento).replace(/^0(\d{14})$/, '$1')
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
  return documento
}
