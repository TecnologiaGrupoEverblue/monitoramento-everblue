/**
 * Política da Central de Arquivos (1.1.4): o que nunca entra, qualquer que
 * seja a configuração. Compartilhada entre a tela (aviso antes de enviar) e a
 * API (a decisão de verdade, que também olha o CONTEÚDO do arquivo).
 */

/** Programas e scripts executáveis: recusados sempre. A variável
 * ARQUIVOS_EXTENSOES_BLOQUEADAS só ACRESCENTA a esta lista. */
export const EXTENSOES_SEMPRE_BLOQUEADAS: readonly string[] = [
  // Windows: programas, bibliotecas, instaladores e atalhos
  '.exe', '.dll', '.msi', '.msp', '.msix', '.appx', '.com', '.scr', '.pif', '.cpl', '.sys', '.drv', '.ocx',
  '.lnk', '.url', '.reg', '.inf', '.gadget', '.application', '.hta', '.chm',
  // Scripts
  '.bat', '.cmd', '.ps1', '.psm1', '.psd1', '.vbs', '.vbe', '.js', '.jse', '.mjs', '.wsf', '.wsh', '.sh', '.bash', '.py', '.pl', '.rb',
  // Outros executáveis/instaladores
  '.jar', '.apk', '.app', '.deb', '.rpm', '.dmg', '.pkg', '.run',
]

/** Tamanho máximo padrão por arquivo (ARQUIVOS_MAX_MB vazio ou 0). */
export const ARQUIVOS_MAX_MB_PADRAO = 100

export interface PoliticaArquivos {
  maxBytes: number
  extensoesBloqueadas: string[]
}

export function extensaoDe(nome: string): string {
  const i = nome.lastIndexOf('.')
  return i > 0 && i < nome.length - 1 ? nome.slice(i).toLowerCase() : ''
}

/** Motivo de recusa pelo nome e tamanho (o conteúdo é conferido na API). */
export function motivoRecusaArquivo(nome: string, tamanhoBytes: number, politica: PoliticaArquivos): string | null {
  const ext = extensaoDe(nome)
  if (ext && politica.extensoesBloqueadas.includes(ext)) {
    return `Arquivos ${ext} não são aceitos: programas e scripts executáveis são bloqueados por segurança.`
  }
  if (tamanhoBytes > politica.maxBytes) {
    return `O arquivo tem ${(tamanhoBytes / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB; o máximo é ${Math.round(politica.maxBytes / 1048576)} MB.`
  }
  return null
}
