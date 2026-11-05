/**
 * Mapa de Garantias em e-mail (tabela no corpo) e em PDF (anexo).
 * Valores ≥ R$ 1 milhão em milhões com 3 casas (ADR-007), como no sistema.
 */
import PDFDocument from 'pdfkit'
import { formatarMoeda, type LinhaMapaGarantia } from '@monitoramento/dominio'

const pct = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`)
const moeda = (v: number | null) => (v === null ? '—' : formatarMoeda(v).replace(/ /g, ' '))
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export interface ColunaMapa {
  titulo: string
  valor: (l: LinhaMapaGarantia) => string
  destaque?: (l: LinhaMapaGarantia) => 'falta' | 'sobra' | null
}

export const COLUNAS_MAPA: ColunaMapa[] = [
  { titulo: 'Fundo', valor: (l) => l.fundo },
  { titulo: 'Risco NC', valor: (l) => moeda(l.riscoNotaComercial) },
  { titulo: '% Exigência', valor: (l) => pct(l.exigenciaPerc) },
  { titulo: 'Exigibilidade', valor: (l) => moeda(l.exigibilidade) },
  { titulo: 'Cobrança vinculada', valor: (l) => moeda(l.cobrancaVinculada) },
  { titulo: 'Vencidos (efeito vagão)', valor: (l) => moeda(l.efeitoVagao) },
  { titulo: 'Manifesto', valor: (l) => moeda(l.totalManifesto) },
  { titulo: 'Prorrogados', valor: (l) => moeda(l.prorrogados) },
  { titulo: 'Deduções manuais', valor: (l) => moeda(l.deducoesManuais) },
  { titulo: 'Garantias válidas', valor: (l) => moeda(l.garantiasValidas) },
  { titulo: 'Contas gráficas', valor: (l) => moeda(l.totalContasGraficas) },
  { titulo: 'Garantia total', valor: (l) => moeda(l.garantiaTotal) },
  { titulo: 'Sobra / falta', valor: (l) => moeda(l.sobraFalta), destaque: (l) => (l.sobraFalta === null ? null : l.sobraFalta < 0 ? 'falta' : 'sobra') },
  { titulo: 'Cobertura', valor: (l) => pct(l.coberturaPerc) },
  { titulo: 'ILM 30 (informativo)', valor: (l) => pct(l.ilm30) },
]

function detalhes(l: LinhaMapaGarantia): string[] {
  const d: string[] = []
  const manifesto = l.manifesto.filter((m) => m.valor > 0).map((m) => `${m.descricao} ${moeda(m.valor)}`)
  if (manifesto.length) d.push(`Manifesto (fora do vagão): ${manifesto.join('; ')}`)
  if (l.sacadosNoVagao > 0) d.push(`${l.sacadosNoVagao} sacado(s) com título vencido no efeito vagão`)
  for (const x of l.deducoes) d.push(`Dedução manual ${moeda(x.valor)}: ${x.justificativa} (${x.responsavel}, ${x.data.split('-').reverse().join('/')})`)
  if (l.concentracaoExcedida) d.push(`Concentração excedida: ${l.concentracaoExcedida.texto} (${l.concentracaoExcedida.responsavel})`)
  if (l.sacadoComRestricao) d.push(`Sacado com restrição: ${l.sacadoComRestricao.texto} (${l.sacadoComRestricao.responsavel})`)
  for (const o of l.outrasGarantias) d.push(`Outra garantia (não soma): ${o.tipo}${o.descricao ? ` — ${o.descricao}` : ''} ${moeda(o.valor)}`)
  for (const v of l.divergencias) d.push(`Conferir: ${v}`)
  return d
}

export function htmlMapa(p: { linhas: LinhaMapaGarantia[]; naoEncontrados: string[]; fotoEm: string; apuradoEm: string | null; destinatario: string }): string {
  const cab = COLUNAS_MAPA.map((c) => `<th style="padding:6px 8px;border:1px solid #d0d5e2;background:#1b1489;color:#fff;font-size:11px;text-align:right;white-space:nowrap">${esc(c.titulo)}</th>`).join('')
  const corpo = p.linhas
    .map((l) => {
      const cels = COLUNAS_MAPA.map((c) => {
        const d = c.destaque?.(l)
        const cor = d === 'falta' ? '#b42318' : d === 'sobra' ? '#067647' : '#101828'
        return `<td style="padding:6px 8px;border:1px solid #d0d5e2;font-size:12px;text-align:right;white-space:nowrap;color:${cor};${d ? 'font-weight:700' : ''}">${esc(c.valor(l))}</td>`
      }).join('')
      const extra = detalhes(l)
      return `<tr><td style="padding:6px 8px;border:1px solid #d0d5e2;font-size:12px"><strong>${esc(l.nome)}</strong><br><span style="color:#667085">${esc(l.documento)}</span></td>${cels}</tr>${
        extra.length ? `<tr><td colspan="${COLUNAS_MAPA.length + 1}" style="padding:4px 8px 8px;border:1px solid #d0d5e2;font-size:11px;color:#475467">${extra.map(esc).join('<br>')}</td></tr>` : ''
      }`
    })
    .join('')
  const naoEncontrados = p.naoEncontrados.length
    ? `<p style="color:#b42318;font-size:12px">Não encontrados no Bitfin (mapa não calculado): ${p.naoEncontrados.map(esc).join(', ')}</p>`
    : ''
  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#101828">
<p style="font-size:14px">Mapa de Garantias — posição do Bitfin de ${esc(p.fotoEm)}${p.apuradoEm ? ` (apuração ${esc(p.apuradoEm)})` : ''}.</p>
${p.linhas.some((l) => l.divergencias.length > 0) ? '<p style="font-size:13px;color:#b42318;font-weight:700">Atenção: há valores a conferir — veja as linhas "Conferir" abaixo de cada cliente.</p>' : ''}
<div style="overflow-x:auto"><table style="border-collapse:collapse"><thead><tr><th style="padding:6px 8px;border:1px solid #d0d5e2;background:#1b1489;color:#fff;font-size:11px;text-align:left">Cliente</th>${cab}</tr></thead><tbody>${corpo}</tbody></table></div>
${naoEncontrados}
<p style="font-size:11px;color:#667085">Garantias válidas = cobrança vinculada − vencidos (efeito vagão: todo o saldo dos sacados com algum título vencido) − manifesto (lastro inconsistente, transação desconhecida e não concluída, fora do vagão) − prorrogados − deduções manuais. Garantia total = válidas + contas gráficas. Outras garantias não entram na garantia total. Cada título é deduzido uma única vez.</p>
<p style="font-size:11px;color:#667085">Enviado automaticamente pelo Monitoramento Everblue para ${esc(p.destinatario)}. O PDF anexo tem o mesmo conteúdo.</p>
</body></html>`
}

export function textoMapa(p: { linhas: LinhaMapaGarantia[]; fotoEm: string }): string {
  return [`Mapa de Garantias — posição do Bitfin de ${p.fotoEm}`, '', ...p.linhas.map((l) => `${l.nome} (${l.documento}): garantia total ${moeda(l.garantiaTotal)} · exigibilidade ${moeda(l.exigibilidade)} · sobra/falta ${moeda(l.sobraFalta)}`)].join('\n')
}

export function pdfMapa(p: { linhas: LinhaMapaGarantia[]; naoEncontrados: string[]; fotoEm: string; apuradoEm: string | null }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 24, info: { Title: 'Mapa de Garantias', Author: 'Monitoramento Everblue' } })
    const partes: Buffer[] = []
    doc.on('data', (b: Buffer) => partes.push(b))
    doc.on('end', () => resolve(Buffer.concat(partes)))
    doc.on('error', reject)

    doc.font('Helvetica-Bold').fontSize(13).fillColor('#1b1489').text('Mapa de Garantias')
    doc.font('Helvetica').fontSize(8.5).fillColor('#475467').text(`Posição do Bitfin de ${p.fotoEm}${p.apuradoEm ? ` (apuração ${p.apuradoEm})` : ''}`)
    if (p.linhas.some((l) => l.divergencias.length > 0)) doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#b42318').text('Atenção: há valores a conferir — veja as linhas "Conferir" abaixo de cada cliente.')
    doc.moveDown(0.6)

    const largura = doc.page.width - 48
    const colCliente = 120
    const col = (largura - colCliente) / COLUNAS_MAPA.length
    const linhaCabecalho = () => {
      const y = doc.y
      doc.rect(24, y, largura, 26).fill('#1b1489')
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(6.5)
      doc.text('Cliente', 28, y + 4, { width: colCliente - 6 })
      COLUNAS_MAPA.forEach((c, i) => doc.text(c.titulo, 24 + colCliente + i * col, y + 4, { width: col - 4, align: 'right' }))
      doc.y = y + 28
    }
    linhaCabecalho()
    for (const l of p.linhas) {
      const extra = detalhes(l)
      const altura = 22 + extra.length * 9
      if (doc.y + altura > doc.page.height - 30) {
        doc.addPage()
        linhaCabecalho()
      }
      const y = doc.y
      doc.font('Helvetica-Bold').fontSize(7).fillColor('#101828').text(l.nome, 28, y, { width: colCliente - 6, height: 9, ellipsis: true })
      doc.font('Helvetica').fontSize(6.5).fillColor('#667085').text(l.documento, 28, y + 9, { width: colCliente - 6 })
      COLUNAS_MAPA.forEach((c, i) => {
        const d = c.destaque?.(l)
        doc.font(d ? 'Helvetica-Bold' : 'Helvetica').fontSize(7).fillColor(d === 'falta' ? '#b42318' : d === 'sobra' ? '#067647' : '#101828')
        doc.text(c.valor(l), 24 + colCliente + i * col, y, { width: col - 4, align: 'right' })
      })
      let yy = y + 20
      doc.font('Helvetica').fontSize(6.5).fillColor('#475467')
      for (const e of extra) {
        doc.text(e, 28, yy, { width: largura - 8 })
        yy = doc.y + 1
      }
      doc.moveTo(24, yy + 2).lineTo(24 + largura, yy + 2).strokeColor('#d0d5e2').lineWidth(0.5).stroke()
      doc.y = yy + 5
    }
    if (p.naoEncontrados.length) doc.moveDown(0.5).font('Helvetica-Bold').fontSize(8).fillColor('#b42318').text(`Não encontrados no Bitfin: ${p.naoEncontrados.join(', ')}`, 24)
    doc
      .moveDown(0.8)
      .font('Helvetica')
      .fontSize(6.5)
      .fillColor('#667085')
      .text(
        'Garantias válidas = cobrança vinculada − vencidos (efeito vagão) − manifesto (lastro inconsistente, transação desconhecida e não concluída, fora do vagão) − prorrogados − deduções manuais. Garantia total = válidas + contas gráficas. Outras garantias não entram. Cada título é deduzido uma única vez.',
        24,
        undefined,
        { width: largura },
      )
    doc.end()
  })
}
