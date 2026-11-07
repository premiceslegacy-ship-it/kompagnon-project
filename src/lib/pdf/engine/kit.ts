// Blocs de mise en page communs aux documents PDF (maquette « PDF » de design/maquettes).
// Les mesures sont celles de la maquette en pixels (A4 = 794 px) converties en points (× 0,75).
// Un document assemble ces blocs ; il ne dessine plus d'en-tête, de tableau ni de pied lui-même.

import type { PDFFont, PDFImage, PDFPage, RGB } from 'pdf-lib'
import { pdfText } from '../pdf-design-system'
import type { PdfDoc } from './doc'
import { drawImageContained } from './image'
import { wrapText } from './text'
import { COLOR, CONTENT_WIDTH, PAGE } from './theme'

/** Échelle typographique, en points. */
export const K = {
  label: 7.1,
  small: 7.5,
  body: 8.6,
  strong: 9.4,
  name: 10.1,
  subtitle: 9,
  title: 16.5,
  big: 16.5,
  foot: 6.4,
  radius: 10.5,
  hair: 0.4,
  /** Hauteur d'une ligne = taille × ce coefficient. */
  leading: 1.4,
} as const

export type Align = 'left' | 'center' | 'right'

// ─── Primitives ──────────────────────────────────────────────────────────────

function roundedRectPath(w: number, h: number, r: number): string {
  const c = Math.min(r, w / 2, h / 2)
  return `M ${c} 0 H ${w - c} A ${c} ${c} 0 0 1 ${w} ${c} V ${h - c} A ${c} ${c} 0 0 1 ${w - c} ${h} H ${c} A ${c} ${c} 0 0 1 0 ${h - c} V ${c} A ${c} ${c} 0 0 1 ${c} 0 Z`
}

/** Rectangle à coins arrondis ; `top` est l'ordonnée du bord haut (repère PDF, origine en bas). */
export function drawCard(
  page: PDFPage,
  box: { x: number; top: number; w: number; h: number; r?: number; fill?: RGB; stroke?: RGB; strokeWidth?: number },
): void {
  page.drawSvgPath(roundedRectPath(box.w, box.h, box.r ?? K.radius), {
    x: box.x,
    y: box.top,
    color: box.fill,
    borderColor: box.stroke,
    borderWidth: box.stroke ? (box.strokeWidth ?? 0.75) : undefined,
  })
}

export function hairline(page: PDFPage, x1: number, x2: number, y: number, color: RGB = COLOR.divider, thickness: number = K.hair): void {
  page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color })
}

export function textWidth(font: PDFFont, size: number, text: string): number {
  return font.widthOfTextAtSize(text, size)
}

/** Une ligne de texte à une position donnée ; `width` sert à l'alignement. */
export function drawLineText(
  page: PDFPage,
  text: string,
  x: number,
  baseline: number,
  style: { font: PDFFont; size: number; color: RGB; align?: Align; width?: number },
): void {
  if (!text) return
  const w = textWidth(style.font, style.size, text)
  const width = style.width ?? 0
  const dx = style.align === 'right' ? width - w : style.align === 'center' ? (width - w) / 2 : 0
  page.drawText(text, { x: x + dx, y: baseline, size: style.size, font: style.font, color: style.color })
}

/** Paragraphe à césure de mots ; retourne la hauteur occupée. `draw=false` sert à mesurer. */
export function paragraph(
  page: PDFPage | null,
  text: string,
  x: number,
  top: number,
  width: number,
  style: { font: PDFFont; size: number; color: RGB; align?: Align; leading?: number },
): number {
  const lines = wrapText(pdfText(text), style.font, style.size, width)
  const lh = style.size * (style.leading ?? K.leading)
  if (page) {
    lines.forEach((line, i) => {
      drawLineText(page, line, x, top - style.size - i * lh - (lh - style.size) / 2, { ...style, width })
    })
  }
  return lines.length * lh
}

// ─── Marque et en-têtes ──────────────────────────────────────────────────────

export type Brand = { logo: PDFImage | null; name: string }

/** Avec logo : le logo seul. Sans logo : monogramme et nom. Retourne la hauteur occupée. */
function drawBrand(doc: PdfDoc, brand: Brand, x: number, top: number, logoHeight: number): number {
  const F = doc.fonts
  if (brand.logo) {
    const ratio = Math.min(112 / brand.logo.width, logoHeight / brand.logo.height)
    const h = brand.logo.height * ratio
    drawImageContained(doc, brand.logo, { x, y: top - logoHeight, w: 112, h: logoHeight })
    void h
    return logoHeight
  }
  const size = logoHeight >= 25 ? 28.5 : 21
  drawCard(doc.page, { x, top, w: size, h: size, r: size * 0.29, fill: COLOR.black })
  const initials = pdfText(brand.name).split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'A'
  const iw = textWidth(F.heading, size * 0.34, initials)
  doc.page.drawText(initials, { x: x + (size - iw) / 2, y: top - size / 2 - size * 0.12, size: size * 0.34, font: F.heading, color: COLOR.white })
  doc.page.drawText(pdfText(brand.name), { x: x + size + 9, y: top - size / 2 - 3.2, size: K.strong + 1, font: F.heading, color: COLOR.black })
  return size
}

export type DocTitle = { title: string; number?: string | null }

/** Première page : marque à gauche, titre et numéro à droite. Retourne l'ordonnée sous l'en-tête. */
export function drawHeader(doc: PdfDoc, brand: Brand, heading: DocTitle): number {
  const F = doc.fonts
  const top = PAGE.height - PAGE.headerTop
  const brandH = drawBrand(doc, brand, PAGE.margin, top, 25.5)
  const right = PAGE.width - PAGE.margin
  const title = pdfText(heading.title)
  const tw = textWidth(F.medium, K.title, title)
  doc.page.drawText(title, { x: right - tw, y: top - K.title + 2, size: K.title, font: F.medium, color: COLOR.black })
  let h = K.title + 2
  if (heading.number) {
    const num = pdfText(heading.number)
    const nw = textWidth(F.medium, K.subtitle, num)
    doc.page.drawText(num, { x: right - nw, y: top - h - K.subtitle - 2, size: K.subtitle, font: F.medium, color: COLOR.secondary })
    h += K.subtitle + 4
  }
  return top - Math.max(brandH, h)
}

/** Pages suivantes : marque réduite, rappel du document, filet. Retourne l'ordonnée sous l'en-tête. */
export function drawCompactHeader(doc: PdfDoc, brand: Brand, heading: DocTitle): number {
  const F = doc.fonts
  const top = PAGE.height - PAGE.headerTop
  const h = drawBrand(doc, brand, PAGE.margin, top, 19.5)
  const label = pdfText(`${heading.title}${heading.number ? ` ${heading.number}` : ''} · suite`)
  const w = textWidth(F.regular, K.small + 0.7, label)
  doc.page.drawText(label, { x: PAGE.width - PAGE.margin - w, y: top - h / 2 - 3, size: K.small + 0.7, font: F.regular, color: COLOR.secondary })
  const line = top - h - 10.5
  hairline(doc.page, PAGE.margin, PAGE.width - PAGE.margin, line, COLOR.rule)
  return line - 13.5
}

// ─── Blocs de première page ──────────────────────────────────────────────────

export type MetaItem = { label: string; value: string }

/** Bandeau gris de repères (date, validité, chantier…). */
export function drawMeta(doc: PdfDoc, items: MetaItem[], gapTop = 12): void {
  const F = doc.fonts
  const padX = 15
  const padY = 9
  const gap = 15
  const inner = CONTENT_WIDTH - padX * 2
  const colW = (inner - gap * (items.length - 1)) / items.length
  const wrapped = items.map(it => wrapText(pdfText(it.value), F.bold, K.strong, colW))
  const lines = Math.max(...wrapped.map(w => w.length))
  const valueLh = K.strong * 1.35
  const h = padY * 2 + K.label * 1.4 + 3 + lines * valueLh
  doc.ensureSpace(h + gapTop)
  const top = doc.y - gapTop
  drawCard(doc.page, { x: PAGE.margin, top, w: CONTENT_WIDTH, h, fill: COLOR.surface })
  items.forEach((it, i) => {
    const x = PAGE.margin + padX + i * (colW + gap)
    doc.page.drawText(pdfText(it.label), { x, y: top - padY - K.label, size: K.label, font: F.bold, color: COLOR.secondary })
    wrapped[i].forEach((line, l) => {
      doc.page.drawText(line, { x, y: top - padY - K.label * 1.4 - 3 - K.strong - l * valueLh, size: K.strong, font: F.bold, color: COLOR.black })
    })
  })
  doc.y = top - h
}

export type Party = { label: string; name: string; lines: string[] }

/** Deux blocs de coordonnées : celui de gauche aligné à gauche, celui de droite à droite. */
export function drawParties(doc: PdfDoc, left: Party, right: Party, gapTop = 15): void {
  const F = doc.fonts
  const gap = 24
  const colW = (CONTENT_WIDTH - gap) / 2
  const lh = 12
  const measure = (p: Party) => {
    const name = wrapText(pdfText(p.name), F.heading, K.name + 0.3, colW)
    const lines = p.lines.flatMap(l => wrapText(pdfText(l), F.regular, K.small + 0.4, colW))
    return { name, lines, h: K.label * 1.4 + 3 + name.length * (K.name + 0.3) * 1.35 + 2.5 + lines.length * lh }
  }
  const a = measure(left)
  const b = measure(right)
  const h = Math.max(a.h, b.h)
  doc.ensureSpace(h + gapTop)
  const top = doc.y - gapTop
  ;([[left, a, PAGE.margin, 'left'], [right, b, PAGE.margin + colW + gap, 'right']] as const).forEach(([party, m, x, align]) => {
    drawLineText(doc.page, pdfText(party.label), x, top - K.label, { font: F.bold, size: K.label, color: COLOR.secondary, align, width: colW })
    let y = top - K.label * 1.4 - 3
    m.name.forEach(line => {
      y -= (K.name + 0.3) * 1.2
      drawLineText(doc.page, line, x, y, { font: F.heading, size: K.name + 0.3, color: COLOR.black, align, width: colW })
      y -= (K.name + 0.3) * 0.15
    })
    y -= 2.5
    m.lines.forEach(line => {
      y -= K.small + 0.4
      drawLineText(doc.page, line, x, y, { font: F.regular, size: K.small + 0.4, color: COLOR.body, align, width: colW })
      y -= lh - (K.small + 0.4)
    })
  })
  doc.y = top - h
}

/** Paragraphe centré, avec un petit titre facultatif (« Votre demande »). */
export function drawNote(doc: PdfDoc, label: string | null, text: string, gapTop = 9): void {
  const F = doc.fonts
  const w = Math.min(CONTENT_WIDTH, 420)
  const x = PAGE.margin + (CONTENT_WIDTH - w) / 2
  const lines = wrapText(pdfText(text), F.regular, K.body, w)
  const lh = K.body * 1.4
  const h = (label ? K.label * 1.4 + 2.5 : 0) + lines.length * lh
  doc.ensureSpace(h + gapTop)
  let y = doc.y - gapTop
  if (label) {
    drawLineText(doc.page, pdfText(label), PAGE.margin, y - K.label, { font: F.bold, size: K.label, color: COLOR.secondary, align: 'center', width: CONTENT_WIDTH })
    y -= K.label * 1.4 + 2.5
  }
  lines.forEach((line, i) => {
    drawLineText(doc.page, line, x, y - K.body - i * lh - (lh - K.body) / 2, { font: F.regular, size: K.body, color: COLOR.black, align: 'center', width: w })
  })
  doc.y = y - lines.length * lh
}

// ─── Tableau ─────────────────────────────────────────────────────────────────

export type KitColumn = { width: number; header: string; align?: Align }

export type KitCell = {
  value: string
  /** Lignes secondaires sous la valeur (descriptif, dimensions). */
  details?: string[]
  /** Valeur en gras (totaux, montants clés). */
  bold?: boolean
  color?: RGB
  /** Petite pastille d'état (Terminée, En retard…). */
  pill?: 'green' | 'amber' | 'red' | 'neutral'
}

export type KitRow =
  | { kind?: 'row'; cells: KitCell[] }
  | { kind: 'section'; title: string; amount?: string }
  | { kind: 'total'; cells: KitCell[] }

export type KitTableOptions = {
  /** Colonnes de texte (alignées à gauche) : les autres sont des nombres alignés à droite. */
  textColumns?: number
  gap?: number
  rowPad?: number
  compactHeader?: boolean
  /** Rappel de l'en-tête de colonnes à chaque page. */
  repeatHeader?: boolean
  gapTop?: number
}

const PILL = {
  green: { bg: COLOR.greenSoft, fg: COLOR.greenText },
  amber: { bg: COLOR.amberSoft, fg: COLOR.amberText },
  red: { bg: COLOR.redSoft, fg: COLOR.redText },
  neutral: { bg: COLOR.surface, fg: COLOR.body },
} as const

function colX(cols: KitColumn[], gap: number): number[] {
  const xs: number[] = []
  let x = PAGE.margin
  for (const c of cols) { xs.push(x); x += c.width + gap }
  return xs
}

function drawTableHead(doc: PdfDoc, cols: KitColumn[], opts: Required<Pick<KitTableOptions, 'gap' | 'textColumns'>>): void {
  const F = doc.fonts
  const xs = colX(cols, opts.gap)
  doc.ensureSpace(K.label + 14)
  const base = doc.y - K.label
  cols.forEach((c, i) => {
    const align: Align = c.align ?? (i < opts.textColumns ? 'left' : 'right')
    drawLineText(doc.page, pdfText(c.header), xs[i], base, { font: F.bold, size: K.label, color: COLOR.secondary, align, width: c.width })
  })
  const line = base - 6
  hairline(doc.page, PAGE.margin, PAGE.margin + CONTENT_WIDTH, line, COLOR.black, 0.45)
  doc.y = line
}

function cellLines(doc: PdfDoc, cell: KitCell, width: number, first: boolean) {
  const F = doc.fonts
  const font = cell.bold ? F.bold : F.regular
  const value = wrapText(pdfText(cell.value), font, K.body, width)
  const details = (cell.details ?? []).flatMap(d => wrapText(pdfText(d), F.regular, K.small, width))
  void first
  return { font, value, details }
}

/** Dessine le tableau, avec sauts de page et rappel de l'en-tête de colonnes. */
export function drawKitTable(doc: PdfDoc, cols: KitColumn[], rows: KitRow[], options: KitTableOptions = {}): void {
  const F = doc.fonts
  const opts = { gap: options.gap ?? 7.5, textColumns: options.textColumns ?? 1, rowPad: options.rowPad ?? 5.25, repeatHeader: options.repeatHeader ?? true }
  const xs = colX(cols, opts.gap)
  const right = PAGE.margin + CONTENT_WIDTH
  const lh = K.body * K.leading
  const dlh = K.small * K.leading

  doc.y -= options.gapTop ?? 12
  drawTableHead(doc, cols, opts)

  rows.forEach((row, rowIndex) => {
    if (row.kind === 'section') {
      const h = 9 + K.name * 1.2 + 4.5
      if (doc.y - h < doc.bottomLimit + 24) {
        doc.addPage()
        if (opts.repeatHeader) drawTableHead(doc, cols, opts)
      }
      const base = doc.y - 9 - 8.25
      drawLineText(doc.page, pdfText(row.title), PAGE.margin, base, { font: F.heading, size: 8.25, color: COLOR.black })
      if (row.amount) drawLineText(doc.page, pdfText(row.amount), PAGE.margin, base, { font: F.regular, size: K.small + 0.4, color: COLOR.secondary, align: 'right', width: CONTENT_WIDTH })
      const line = base - 4.5
      hairline(doc.page, PAGE.margin, right, line)
      doc.y = line
      return
    }

    const measured = row.cells.map((cell, i) => cellLines(doc, cell, cols[i].width, i === 0))
    const contentH = Math.max(...measured.map(m => m.value.length * lh + (m.details.length ? 1 + m.details.length * dlh : 0)))
    const h = contentH + opts.rowPad * 2
    if (doc.y - h < doc.bottomLimit) {
      doc.addPage()
      if (opts.repeatHeader) drawTableHead(doc, cols, opts)
    }
    const top = doc.y
    if (row.kind === 'total') hairline(doc.page, PAGE.margin, right, top, COLOR.black, 0.45)
    row.cells.forEach((cell, i) => {
      const col = cols[i]
      const align: Align = col.align ?? (i < opts.textColumns ? 'left' : 'right')
      const m = measured[i]
      const isLast = i === row.cells.length - 1
      const isText = i < opts.textColumns
      const color = cell.color ?? (isText ? COLOR.black : isLast ? COLOR.black : COLOR.body)
      const font = row.kind === 'total' ? F.bold : m.font
      if (cell.pill) {
        const p = PILL[cell.pill]
        const label = pdfText(cell.value)
        const pw = textWidth(F.bold, K.label, label) + 14
        const px = align === 'right' ? xs[i] + col.width - pw : xs[i]
        drawCard(doc.page, { x: px, top: top - opts.rowPad + 1, w: pw, h: 11.5, r: 5.75, fill: p.bg })
        doc.page.drawText(label, { x: px + 7, y: top - opts.rowPad - 7.4, size: K.label, font: F.bold, color: p.fg })
        return
      }
      m.value.forEach((line, l) => {
        drawLineText(doc.page, line, xs[i], top - opts.rowPad - K.body - l * lh - (lh - K.body) / 2, { font, size: K.body, color, align, width: col.width })
      })
      const detailTop = top - opts.rowPad - m.value.length * lh - 1
      m.details.forEach((line, l) => {
        drawLineText(doc.page, line, xs[i], detailTop - K.small - l * dlh - (dlh - K.small) / 2, { font: F.regular, size: K.small, color: COLOR.secondary, align, width: col.width })
      })
    })
    const bottom = top - h
    if (row.kind !== 'total' && rowIndex < rows.length) hairline(doc.page, PAGE.margin, right, bottom)
    doc.y = bottom
  })
}

// ─── Totaux et blocs du bas ──────────────────────────────────────────────────

export type TotalLine = { label: string; value: string }

/** Bloc de totaux à droite : lignes, puis le montant final en grand. */
export function drawTotals(doc: PdfDoc, lines: TotalLine[], grand: TotalLine, gapTop = 9): void {
  const F = doc.fonts
  const w = 219
  const padX = 13.5
  const padY = 9
  const lineH = K.body + 4.5
  const grandH = 6 + 7.5 + 20
  const h = padY * 2 + lines.length * lineH + grandH
  doc.ensureSpace(h + gapTop)
  const top = doc.y - gapTop
  const x = PAGE.margin + CONTENT_WIDTH - w
  drawCard(doc.page, { x, top, w, h, fill: COLOR.surface })
  let y = top - padY
  lines.forEach(l => {
    const base = y - K.body - 2.25
    drawLineText(doc.page, pdfText(l.label), x + padX, base, { font: F.regular, size: K.body, color: COLOR.body })
    drawLineText(doc.page, pdfText(l.value), x + padX, base, { font: F.bold, size: K.body, color: COLOR.black, align: 'right', width: w - padX * 2 })
    y -= lineH
  })
  y -= 6
  hairline(doc.page, x + padX, x + w - padX, y, COLOR.ruleStrong, 0.4)
  const base = y - 7.5 - 14
  drawLineText(doc.page, pdfText(grand.label), x + padX, base, { font: F.bold, size: K.strong, color: COLOR.black })
  drawLineText(doc.page, pdfText(grand.value), x + padX, base, { font: F.heading, size: K.big, color: COLOR.black, align: 'right', width: w - padX * 2 })
  doc.y = top - h
}

export type CardParagraph = { text: string; bold?: boolean; gapBefore?: number }

/** Carte grise avec un petit titre et des paragraphes (conditions, règlement…). */
export function measureCard(doc: PdfDoc, width: number, label: string | null, paragraphs: CardParagraph[]): number {
  const F = doc.fonts
  const inner = width - 27
  const lh = K.small * 1.4
  let h = 18 + (label ? K.label * 1.4 + 3 : 0)
  paragraphs.forEach(p => {
    h += (p.gapBefore ?? 0) + wrapText(pdfText(p.text), p.bold ? F.bold : F.regular, K.small, inner).length * lh
  })
  return h
}

export function drawTextCard(doc: PdfDoc, x: number, top: number, width: number, label: string | null, paragraphs: CardParagraph[], minHeight = 0): number {
  const F = doc.fonts
  const h = Math.max(measureCard(doc, width, label, paragraphs), minHeight)
  drawCard(doc.page, { x, top, w: width, h, fill: COLOR.surface })
  const inner = width - 27
  const lh = K.small * 1.4
  let y = top - 9
  if (label) {
    doc.page.drawText(pdfText(label), { x: x + 13.5, y: y - K.label, size: K.label, font: F.bold, color: COLOR.secondary })
    y -= K.label * 1.4 + 3
  }
  paragraphs.forEach(p => {
    y -= p.gapBefore ?? 0
    wrapText(pdfText(p.text), p.bold ? F.bold : F.regular, K.small, inner).forEach(line => {
      doc.page.drawText(line, { x: x + 13.5, y: y - K.small - (lh - K.small) / 2, size: K.small, font: p.bold ? F.bold : F.regular, color: p.bold ? COLOR.black : COLOR.body })
      y -= lh
    })
  })
  return h
}

/** Case à contour (signature, statut). Retourne la hauteur. */
export function drawOutlineBox(doc: PdfDoc, x: number, top: number, width: number, height: number): void {
  drawCard(doc.page, { x, top, w: width, h: height, stroke: COLOR.rule, strokeWidth: 0.75 })
}

/**
 * Place un bloc du bas de page : collé au pied de page quand il reste de la place sous le
 * contenu, sinon sur une nouvelle page. Retourne l'ordonnée du bord haut du bloc.
 */
export function bottomBlockTop(doc: PdfDoc, height: number, gap = 12): number {
  if (doc.y - gap - height < doc.bottomLimit) {
    doc.addPage()
    return doc.y
  }
  return doc.bottomLimit + height
}

// ─── Pied de page ────────────────────────────────────────────────────────────

/** Lignes légales centrées, coupées à la largeur utile. */
export function footerLines(doc: PdfDoc, legalLines: string[]): string[] {
  return legalLines.flatMap(l => wrapText(pdfText(l), doc.fonts.regular, K.foot, CONTENT_WIDTH))
}

/** Réserve la place du pied de page et prépare son dessin (pagination comprise). */
export function installFooter(doc: PdfDoc, legalLines: string[]): void {
  const F = doc.fonts
  const lines = footerLines(doc, legalLines)
  const lh = 9
  const bottom = 27
  doc.bottomLimit = bottom + Math.max(lines.length, 1) * lh + 9 + 14
  doc.onFinishPage = ({ page, pageIndex, pageCount }) => {
    const pageLabel = `Page ${pageIndex + 1} / ${pageCount}`
    const last = lines.length ? lines[lines.length - 1] : ''
    const merged = last ? `${last} · ${pageLabel}` : pageLabel
    const out = last && textWidth(F.regular, K.foot, merged) <= CONTENT_WIDTH
      ? [...lines.slice(0, -1), merged]
      : [...lines, pageLabel]
    hairline(page, PAGE.margin, PAGE.width - PAGE.margin, bottom + out.length * lh + 9 - 3, COLOR.rule)
    out.forEach((line, i) => {
      drawLineText(page, line, PAGE.margin, bottom + (out.length - 1 - i) * lh, {
        font: F.regular, size: K.foot, color: COLOR.secondary, align: 'center', width: CONTENT_WIDTH,
      })
    })
  }
}
