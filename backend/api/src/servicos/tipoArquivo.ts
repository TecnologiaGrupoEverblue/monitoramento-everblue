/**
 * Tipo REAL do arquivo pelo conteúdo (assinatura / magic bytes).
 *
 * Registra o que o arquivo de fato é — a extensão e o `Content-Type`
 * declarados pelo navegador não são confiáveis — e aponta conteúdo
 * EXECUTÁVEL (programa ou script), que a Central recusa mesmo renomeado. Na devolução,
 * o arquivo sai sempre como anexo (`Content-Disposition: attachment`) com
 * `nosniff`, então nenhum conteúdo enviado é executado no navegador.
 */
import path from 'node:path'

interface Assinatura {
  mime: string
  teste: (b: Buffer) => boolean
}

const comeca = (...bytes: number[]) => (b: Buffer) => bytes.every((v, i) => b[i] === v)
const texto = (b: Buffer, inicio: number, s: string) => b.subarray(inicio, inicio + s.length).toString('latin1') === s

const ASSINATURAS: Assinatura[] = [
  { mime: 'application/pdf', teste: (b) => texto(b, 0, '%PDF-') },
  { mime: 'image/png', teste: comeca(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) },
  { mime: 'image/jpeg', teste: comeca(0xff, 0xd8, 0xff) },
  { mime: 'image/gif', teste: (b) => texto(b, 0, 'GIF87a') || texto(b, 0, 'GIF89a') },
  { mime: 'image/webp', teste: (b) => texto(b, 0, 'RIFF') && texto(b, 8, 'WEBP') },
  { mime: 'image/tiff', teste: (b) => comeca(0x49, 0x49, 0x2a, 0x00)(b) || comeca(0x4d, 0x4d, 0x00, 0x2a)(b) },
  { mime: 'image/bmp', teste: (b) => texto(b, 0, 'BM') && b.length > 14 },
  { mime: 'application/gzip', teste: comeca(0x1f, 0x8b) },
  { mime: 'application/x-7z-compressed', teste: comeca(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c) },
  { mime: 'application/vnd.rar', teste: (b) => texto(b, 0, 'Rar!') },
  { mime: 'audio/mpeg', teste: (b) => texto(b, 0, 'ID3') },
  { mime: 'video/mp4', teste: (b) => texto(b, 4, 'ftyp') },
  { mime: 'application/x-msdownload', teste: (b) => texto(b, 0, 'MZ') && !pareceTexto(b) },
  { mime: 'application/x-executable', teste: comeca(0x7f, 0x45, 0x4c, 0x46) }, // ELF (Linux)
  {
    mime: 'application/x-mach-binary', // macOS
    teste: (b) =>
      [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe].includes(b.length >= 4 ? b.readUInt32BE(0) : 0),
  },
  { mime: 'application/x-ole-storage', teste: comeca(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1) },
  { mime: 'application/zip', teste: (b) => comeca(0x50, 0x4b, 0x03, 0x04)(b) || comeca(0x50, 0x4b, 0x05, 0x06)(b) },
]

/** Formatos que são ZIP ou OLE por dentro: a extensão decide o subtipo. */
const POR_EXTENSAO_ZIP: Record<string, string> = {
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.zip': 'application/zip',
}
const POR_EXTENSAO_OLE: Record<string, string> = {
  '.xls': 'application/vnd.ms-excel',
  '.doc': 'application/msword',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.msg': 'application/vnd.ms-outlook',
}
const POR_EXTENSAO_TEXTO: Record<string, string> = {
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.md': 'text/markdown',
  '.ofx': 'application/x-ofx',
  '.rem': 'text/plain',
  '.ret': 'text/plain',
}

function pareceTexto(b: Buffer): boolean {
  if (b.length === 0) return true
  const amostra = b.subarray(0, 4096)
  if (amostra.includes(0x00)) return false
  let controles = 0
  for (const c of amostra) if (c < 0x09 || (c > 0x0d && c < 0x20)) controles++
  return controles / amostra.length < 0.02
}

export interface TipoDetectado {
  mime: string
  /** O conteúdo diverge do que a extensão sugere (ex.: .pdf que é executável). */
  divergente: boolean
  /** Programa ou script executável pelo CONTEÚDO, qualquer que seja o nome. */
  executavel: boolean
}

const MIMES_EXECUTAVEIS = new Set(['application/x-msdownload', 'application/x-executable', 'application/x-mach-binary'])
export const mimeExecutavel = (mime: string) => MIMES_EXECUTAVEIS.has(mime) || mime === 'text/x-script'

export function detectarTipo(cabecalho: Buffer, nomeOriginal: string): TipoDetectado {
  const t = detectar(cabecalho, nomeOriginal)
  return { ...t, executavel: mimeExecutavel(t.mime) }
}

function detectar(cabecalho: Buffer, nomeOriginal: string): Omit<TipoDetectado, 'executavel'> {
  const extensao = path.extname(nomeOriginal).toLowerCase()
  const assinatura = ASSINATURAS.find((a) => a.teste(cabecalho))
  if (assinatura?.mime === 'application/zip') {
    return { mime: POR_EXTENSAO_ZIP[extensao] ?? 'application/zip', divergente: !!extensao && !(extensao in POR_EXTENSAO_ZIP) }
  }
  if (assinatura?.mime === 'application/x-ole-storage') {
    return { mime: POR_EXTENSAO_OLE[extensao] ?? 'application/x-ole-storage', divergente: !!extensao && !(extensao in POR_EXTENSAO_OLE) }
  }
  if (assinatura) {
    const esperado = EXTENSAO_DO_MIME[assinatura.mime]
    return { mime: assinatura.mime, divergente: !!extensao && !!esperado && !esperado.includes(extensao) }
  }
  if (pareceTexto(cabecalho)) {
    // Script com interpretador declarado ("#!/bin/sh", "#!/usr/bin/env python").
    if (texto(cabecalho, 0, '#!')) return { mime: 'text/x-script', divergente: false }
    return { mime: POR_EXTENSAO_TEXTO[extensao] ?? 'text/plain', divergente: false }
  }
  return { mime: 'application/octet-stream', divergente: false }
}

const EXTENSAO_DO_MIME: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg', '.jfif'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  'image/tiff': ['.tif', '.tiff'],
  'image/bmp': ['.bmp'],
  'application/gzip': ['.gz', '.tgz'],
  'application/x-7z-compressed': ['.7z'],
  'application/vnd.rar': ['.rar'],
  'audio/mpeg': ['.mp3'],
  'video/mp4': ['.mp4', '.m4v', '.m4a', '.mov', '.heic'],
  'application/x-msdownload': ['.exe', '.dll', '.msi'],
  'application/x-executable': [],
  'application/x-mach-binary': [],
}

/** Extensão segura para a chave do objeto (nunca o nome original). */
export function extensaoSegura(nomeOriginal: string): string {
  const ext = path.extname(nomeOriginal).toLowerCase()
  return /^\.[a-z0-9]{1,10}$/.test(ext) ? ext : ''
}

/** Nome original apresentável: sem caminho, sem caracteres de controle. */
export function nomeSeguro(nome: string): string {
  const base = nome.split(/[\\/]/).pop() ?? 'arquivo'
  // eslint-disable-next-line no-control-regex
  const limpo = base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200)
  return limpo || 'arquivo'
}
