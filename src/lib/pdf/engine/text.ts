import type { PDFFont, RGB } from 'pdf-lib'
import type { PdfDoc } from './doc'
import { CONTENT_WIDTH, PAGE } from './theme'

export type TextStyle = {
  font: PDFFont
  size: number
  color: RGB
  align?: 'left' | 'center' | 'right'
  maxWidth?: number
  lineHeight?: number // multiplicateur de size, défaut 1.3
  letterSpacing?: number
  uppercase?: boolean
}

/** Découpe `text` en lignes tenant dans `maxWidth`. Coupe au caractère si un mot seul dépasse. */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return ['']

  const lines: string[] = []
  let current = ''

  const widthOf = (s: string) => font.widthOfTextAtSize(s, size)

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (widthOf(candidate) <= maxWidth) {
      current = candidate
      continue
    }
    if (current) lines.push(current)
    if (widthOf(word) <= maxWidth) {
      current = word
      continue
    }
    // Mot plus long que la colonne : coupe au caractère.
    let chunk = ''
    for (const ch of word) {
      const next = chunk + ch
      if (widthOf(next) > maxWidth && chunk) {
        lines.push(chunk)
        chunk = ch
      } else {
        chunk = next
      }
    }
    current = chunk
  }
  if (current) lines.push(current)
  return lines.length > 0 ? lines : ['']
}

export function textLineHeight(style: TextStyle): number {
  return style.size * (style.lineHeight ?? 1.3)
}

export function measureTextHeight(text: string, style: TextStyle): number {
  const maxWidth = style.maxWidth ?? CONTENT_WIDTH
  const lines = wrapText(text, style.font, style.size, maxWidth)
  return lines.length * textLineHeight(style)
}

function drawLine(doc: PdfDoc, line: string, x: number, y: number, style: TextStyle): void {
  const maxWidth = style.maxWidth ?? CONTENT_WIDTH
  let drawX = x
  if (style.align === 'right') {
    drawX = x + maxWidth - style.font.widthOfTextAtSize(line, style.size)
  } else if (style.align === 'center') {
    drawX = x + (maxWidth - style.font.widthOfTextAtSize(line, style.size)) / 2
  }
  doc.page.drawText(line, {
    x: drawX,
    y,
    size: style.size,
    font: style.font,
    color: style.color,
  })
}

/** Dessine du texte au curseur courant (doc.y), avec wrap et saut de page automatique. */
export function drawText(doc: PdfDoc, text: string, style: TextStyle, x = PAGE.margin): void {
  const display = style.uppercase ? text.toUpperCase() : text
  const maxWidth = style.maxWidth ?? CONTENT_WIDTH
  const lines = wrapText(display, style.font, style.size, maxWidth)
  const lh = textLineHeight(style)

  for (const line of lines) {
    doc.ensureSpace(lh)
    doc.y -= style.size // baseline
    drawLine(doc, line, x, doc.y, style)
    doc.y -= lh - style.size
  }
}

/** Dessine une ligne label ... valeur (ex: "Total HT ... 1 200 €") sur la largeur donnée. */
export function drawKeyValueRow(
  doc: PdfDoc,
  label: string,
  value: string,
  opts: { x: number; width: number; labelStyle: TextStyle; valueStyle: TextStyle; rowHeight: number },
): void {
  doc.ensureSpace(opts.rowHeight)
  const baselineY = doc.y - opts.rowHeight + (opts.rowHeight - opts.labelStyle.size) / 2
  drawLine(doc, label, opts.x, baselineY, { ...opts.labelStyle, align: 'left', maxWidth: opts.width })
  drawLine(doc, value, opts.x, baselineY, { ...opts.valueStyle, align: 'right', maxWidth: opts.width })
  doc.y -= opts.rowHeight
}
