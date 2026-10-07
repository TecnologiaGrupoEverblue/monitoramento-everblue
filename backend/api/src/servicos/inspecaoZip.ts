/**
 * Inspeção de um arquivo ZIP (o .xlsx é um ZIP de XMLs) ANTES de descompactar:
 * lê só o diretório central e recusa bomba de descompressão — muitas entradas,
 * tamanho descompactado total grande demais ou taxa de compressão absurda.
 * Nada é descompactado aqui; é aritmética sobre os cabeçalhos.
 */
export interface LimitesZip {
  maxEntradas: number
  maxBytesDescompactados: number
  /** Taxa máxima por entrada (descompactado / compactado). XML de planilha
   * comprime ~10–30x; bomba passa de milhares. */
  maxTaxa: number
}

export const LIMITES_ZIP_PADRAO: LimitesZip = { maxEntradas: 5_000, maxBytesDescompactados: 200 * 1024 * 1024, maxTaxa: 500 }

export type ResultadoInspecaoZip = { ok: true; entradas: number; bytesDescompactados: number } | { ok: false; motivo: string }

const ASSINATURA_FIM = 0x06054b50
const ASSINATURA_CENTRAL = 0x02014b50

export function inspecionarZip(buf: Buffer, limites: LimitesZip = LIMITES_ZIP_PADRAO): ResultadoInspecaoZip {
  // Registro de fim do diretório central: nos últimos 22 + 65.535 bytes (comentário).
  const inicioBusca = Math.max(0, buf.length - 22 - 0xffff)
  let fim = -1
  for (let i = buf.length - 22; i >= inicioBusca; i--) {
    if (buf.readUInt32LE(i) === ASSINATURA_FIM) {
      fim = i
      break
    }
  }
  if (fim < 0) return { ok: false, motivo: 'estrutura ZIP não encontrada' }

  const totalEntradas = buf.readUInt16LE(fim + 10)
  const tamanhoCentral = buf.readUInt32LE(fim + 12)
  const inicioCentral = buf.readUInt32LE(fim + 16)
  if (totalEntradas === 0xffff || tamanhoCentral === 0xffffffff || inicioCentral === 0xffffffff) {
    return { ok: false, motivo: 'ZIP64 não é aceito para planilhas' }
  }
  if (totalEntradas > limites.maxEntradas) return { ok: false, motivo: `entradas demais (${totalEntradas})` }
  if (inicioCentral + tamanhoCentral > fim) return { ok: false, motivo: 'diretório central inconsistente' }

  let pos = inicioCentral
  let total = 0
  for (let n = 0; n < totalEntradas; n++) {
    if (pos + 46 > fim || buf.readUInt32LE(pos) !== ASSINATURA_CENTRAL) return { ok: false, motivo: 'diretório central inconsistente' }
    const compactado = buf.readUInt32LE(pos + 20)
    const descompactado = buf.readUInt32LE(pos + 24)
    if (compactado === 0xffffffff || descompactado === 0xffffffff) return { ok: false, motivo: 'ZIP64 não é aceito para planilhas' }
    total += descompactado
    if (total > limites.maxBytesDescompactados) return { ok: false, motivo: 'conteúdo descompactado grande demais' }
    if (descompactado > 1024 * 1024 && descompactado / Math.max(compactado, 1) > limites.maxTaxa) {
      return { ok: false, motivo: 'taxa de compressão suspeita' }
    }
    pos += 46 + buf.readUInt16LE(pos + 28) + buf.readUInt16LE(pos + 30) + buf.readUInt16LE(pos + 32)
  }
  return { ok: true, entradas: totalEntradas, bytesDescompactados: total }
}
