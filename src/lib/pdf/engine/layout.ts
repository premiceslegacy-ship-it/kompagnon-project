// Gabarit commun des documents PDF (modèle validé de la maquette « Aperçu du PDF »).
//
// La maquette dessine une page A4 de 794 x 1123 px ; une page PDF fait 595 x 842 pt.
// Toutes les valeurs ci-dessous sont donc celles de la maquette multipliées par 0,75
// (ex. : 46 px de marge haute = 34,5 pt). Règles appliquées :
// - une page en priorité (blocs de fin posés en bas de la dernière page) ;
// - en-tête réduit au logo quand l'entreprise en a un (sinon monogramme et nom) ;
// - intitulé du document discret (Geist Medium), titres en Geist Bold, texte en Inter ;
// - pied de page centré, avec « Page n / N ».

import type { PDFFont, PDFImage, PDFPage, RGB } from 'pdf-lib'
import { pdfText } from '@/lib/pdf/pdf-design-system'
import type { PdfDoc } from './doc'
import { drawImageContained } from './image'
import { wrapText } from './text'
import { COLOR, PAGE } from './theme'

// ─── Mesures (pt) ─────────────────────────────────────────────────────────────

export const A4 = {
  side: 42,          // 56 px
  top: 34.5,         // 46 px
  bottom: 27,        // 36 px
  get width() { return PAGE.width - A4.side * 2 },
  get right() { return PAGE.width - A4.side },
}

export const TYPE = {
  label: 7.125,      // small : 600 9,5 px
  labelLh: 9.75,
  body: 8.625,       // 11,5 px
  bodyLh: 12.75,
  small: 7.5,        // 10 px
  smallLh: 10.5,
  party: 7.875,      // 10,5 px
  partyLh: 12,
  footer: 6.375,     // 8,5 px
  footerLh: 9,
  title: 16.5,       // h1 : 500 22 px
  reference: 9,      // 500 12 px
}

const RADIUS = 10.5  // 14 px

// ─── Primitives ───────────────────────────────────────────────────────────────

/** Rectangle aux coins arrondis (y = bas du rectangle, repère PDF). */
export function roundRect(
  page: PDFPage,
  box: { x: number; y: number; w: number; h: number; r?: number },
  style: { fill?: RGB; border?: RGB; borderWidth?: number },
): void {
  const r = Math.max(0, Math.min(box.r ?? RADIUS, box.w / 2, box.h / 2))
  const { w, h } = box
  const k = r * 0.5523
  // Chemin SVG : origine en haut à gauche, y vers le bas.
  const path = [
    `M ${r} 0`, `L ${w - r} 0`, `C ${w - r + k} 0 ${w} ${r - k} ${w} ${r}`,
    `L ${w} ${h - r}`, `C ${w} ${h - r + k} ${w - r + k} ${h} ${w - r} ${h}`,
    `L ${r} ${h}`, `C ${r - k} ${h} 0 ${h - r + k} 0 ${h - r}`,
    `L 0 ${r}`, `C 0 ${r - k} ${r - k} 0 ${r} 0`, 'Z',
  ].join(' ')
  page.drawSvgPath(path, {
    x: box.x,
    y: box.y + h,
    color: style.fill,
    borderColor: style.border,
    borderWidth: style.border ? (style.borderWidth ?? 0.75) : undefined,
  })
}

export function hairline(page: PDFPage, x1: number, x2: number, y: number, color: RGB = COLOR.line, thickness = 0.5): void {
  page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color })
}

/** Dessine une ligne de texte alignée dans [x, x + width]. */
export function textAt(
  page: PDFPage,
  text: string,
  o: { x: number; y: number; font: PDFFont; size: number; color: RGB; align?: 'left' | 'center' | 'right'; width?: number },
): void {
  const line = text.replace(/[   ]/g, ' ')
  const w = o.font.widthOfTextAtSize(line, o.size)
  const width = o.width ?? 0
  const x = o.align === 'right' ? o.x + width - w : o.align === 'center' ? o.x + (width - w) / 2 : o.x
  page.drawText(line, { x, y: o.y, size: o.size, font: o.font, color: o.color })
}

/** Découpe un texte (retours ligne conservés) en lignes tenant dans `width`. */
export function wrapParagraphs(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = []
  for (const para of String(text ?? '').replace(/\r\n/g, '\n').split('\n')) {
    const clean = pdfText(para).trim()
    if (!clean) continue
    out.push(...wrapText(clean, font, size, width))
  }
  return out
}

// ─── Texte riche (gras dans un paragraphe) ────────────────────────────────────

export type RichSegment = { text: string; bold?: boolean }
export type RichParagraph = RichSegment[] | string

type Word = { text: string; font: PDFFont }
type RichLine = Word[]

function toSegments(p: RichParagraph): RichSegment[] {
  return typeof p === 'string' ? [{ text: p }] : p
}

function wrapRich(p: RichParagraph, fonts: { regular: PDFFont; bold: PDFFont }, size: number, width: number): RichLine[] {
  const words: Word[] = []
  for (const seg of toSegments(p)) {
    const font = seg.bold ? fonts.bold : fonts.regular
    for (const piece of pdfText(seg.text).split(/\s+/).filter(Boolean)) words.push({ text: piece, font })
  }
  const lines: RichLine[] = []
  let cur: RichLine = []
  let curW = 0
  const space = (f: PDFFont) => f.widthOfTextAtSize(' ', size)
  for (const word of words) {
    const ww = word.font.widthOfTextAtSize(word.text, size)
    const add = cur.length ? space(word.font) + ww : ww
    if (cur.length && curW + add > width) {
      lines.push(cur)
      cur = []
      curW = 0
    }
    if (!cur.length && ww > width) {
      // mot trop long : coupe au caractère
      for (const chunk of wrapText(word.text, word.font, size, width)) lines.push([{ text: chunk, font: word.font }])
      continue
    }
    curW += cur.length ? space(word.font) + ww : ww
    cur.push(word)
  }
  if (cur.length) lines.push(cur)
  return lines
}

function drawRichLine(page: PDFPage, line: RichLine, x: number, y: number, size: number, colors: { regular: RGB; bold: RGB }, boldFont: PDFFont, align: 'left' | 'center' | 'right' = 'left', width = 0): void {
  const widthOf = (l: RichLine) => l.reduce((s, w, i) => s + w.font.widthOfTextAtSize(w.text, size) + (i ? w.font.widthOfTextAtSize(' ', size) : 0), 0)
  let cx = align === 'right' ? x + width - widthOf(line) : align === 'center' ? x + (width - widthOf(line)) / 2 : x
  line.forEach((w, i) => {
    if (i) cx += w.font.widthOfTextAtSize(' ', size)
    page.drawText(w.text, { x: cx, y, size, font: w.font, color: w.font === boldFont ? colors.bold : colors.regular })
    cx += w.font.widthOfTextAtSize(w.text, size)
  })
}

// ─── Pied de page légal (devis, facture, contrat…) ────────────────────────────

type LegalOrg = {
  forme_juridique?: string | null
  capital_social?: string | number | null
  siret?: string | null
  rcs?: string | null
  rcs_ville?: string | null
  vat_number?: string | null
  insurance_info?: string | null
  decennale_enabled?: boolean | null
  certifications?: string | string[] | null
}

/** Lignes du pied légal, à l'identique des anciens gabarits devis/facture. */
export function legalFooterLines(org: LegalOrg, opts: { isVatSubject: boolean; capital: string | null; decennale?: string | null }): string[] {
  const line1: string[] = []
  if (org.forme_juridique) line1.push(org.forme_juridique)
  if (opts.capital) line1.push(`Capital social : ${opts.capital}`)

  const line2: string[] = []
  if (org.siret) line2.push(`SIRET : ${org.siret}`)
  if (org.rcs && org.rcs_ville) line2.push(`RCS ${org.rcs_ville} ${org.rcs}`)
  else if (org.rcs) line2.push(`RCS ${org.rcs}`)
  if (!opts.isVatSubject) line2.push('TVA non applicable, art. 293B du CGI')
  else if (org.vat_number) line2.push(`TVA : ${org.vat_number}`)

  let insurance: string | null = null
  if (org.insurance_info) {
    const label = org.decennale_enabled
      ? 'Assurance responsabilité civile professionnelle et décennale'
      : 'Assurance responsabilité civile professionnelle'
    insurance = `${label} : ${org.insurance_info}`
  }
  const certifications = Array.isArray(org.certifications) ? org.certifications.join(' · ') : org.certifications

  const decennale = opts.decennale ? `Garantie décennale, art. L241-1 du Code des assurances : ${opts.decennale}` : null

  return [line1.join(' · '), line2.join(' · '), insurance, decennale, certifications]
    .filter((l): l is string => !!l && l.length > 0)
    .map(l => pdfText(l))
}

// ─── En-tête et pied (« chrome ») ─────────────────────────────────────────────

export type ChromeOptions = {
  /** Intitulé du document : « Devis », « Facture », « Rapport de chantier »… */
  title: string
  /** Numéro ou période, affiché sous l'intitulé. */
  reference?: string | null
  logo: PDFImage | null
  orgName: string
  footerLines: string[]
  /** Affiche « Page n / N » dans le pied (défaut : oui). */
  pageNumbers?: boolean
}

const LOGO_BOX = { w: 150, h: 30 }
const MONO = 28.5

function initials(name: string): string {
  const parts = pdfText(name).trim().split(/\s+/).filter(Boolean)
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : (parts[0] ?? '').slice(0, 2)
  return letters.toUpperCase() || '·'
}

/** Dessine la marque (logo seul, ou monogramme et nom) ; renvoie sa hauteur et sa largeur. */
function drawBrand(doc: PdfDoc, page: PDFPage, opts: ChromeOptions, top: number): { h: number; w: number } {
  const F = doc.fonts
  if (opts.logo) {
    const ratio = Math.min(LOGO_BOX.w / opts.logo.width, LOGO_BOX.h / opts.logo.height)
    const w = opts.logo.width * ratio
    const h = opts.logo.height * ratio
    drawImageContained(doc, opts.logo, { x: A4.side, y: top - h, w, h })
    return { h, w }
  }
  roundRect(page, { x: A4.side, y: top - MONO, w: MONO, h: MONO, r: 8.25 }, { fill: COLOR.ink })
  const ini = initials(opts.orgName)
  const size = 9.75
  textAt(page, ini, { x: A4.side, y: top - MONO / 2 - size * 0.36, font: F.heading, size, color: COLOR.white, align: 'center', width: MONO })
  const name = pdfText(opts.orgName)
  const nameSize = 10.5
  const nameMax = 220
  const nameLine = wrapText(name, F.heading, nameSize, nameMax)[0] ?? ''
  textAt(page, nameLine, { x: A4.side + MONO + 9, y: top - MONO / 2 - nameSize * 0.36, font: F.heading, size: nameSize, color: COLOR.ink })
  return { h: MONO, w: MONO + 9 + F.heading.widthOfTextAtSize(nameLine, nameSize) }
}

/**
 * Installe l'en-tête (complet en page 1, compact ensuite) et le pied centré.
 * À appeler avant `doc.addPage()`.
 */
export function setupChrome(doc: PdfDoc, opts: ChromeOptions): void {
  const F = doc.fonts
  const withPages = opts.pageNumbers !== false
  const footerWidth = A4.width
  // Réserve la place de « · Page 99 / 99 » sur la dernière ligne.
  const pagePlaceholder = 'Page 99 / 99'
  const baseLines = opts.footerLines.flatMap(l => wrapText(l, F.regular, TYPE.footer, footerWidth))
  const lastFits = baseLines.length > 0
    && F.regular.widthOfTextAtSize(`${baseLines[baseLines.length - 1]} · ${pagePlaceholder}`, TYPE.footer) <= footerWidth
  const lineCount = baseLines.length + (withPages && !lastFits ? 1 : 0)
  const footerTextH = Math.max(1, lineCount) * TYPE.footerLh
  const footerRuleY = A4.bottom + footerTextH + 9 // padding-top 12 px
  doc.bottomLimit = footerRuleY + 12 // margin-top 16 px

  doc.onNewPage = ({ page, pageIndex }) => {
    const top = PAGE.height - A4.top
    if (pageIndex === 0) {
      const brand = drawBrand(doc, page, opts, top)
      const titleWidth = A4.width - brand.w - 18
      const titleLines = wrapText(pdfText(opts.title), F.title, TYPE.title, titleWidth)
      let ty = top
      for (const line of titleLines) {
        ty -= TYPE.title * 0.78
        textAt(page, line, { x: A4.side, y: ty, font: F.title, size: TYPE.title, color: COLOR.ink, align: 'right', width: A4.width })
        ty -= TYPE.title * 1.18 - TYPE.title * 0.78
      }
      if (opts.reference) {
        ty -= 2.25
        for (const line of wrapText(pdfText(opts.reference), F.title, TYPE.reference, titleWidth)) {
          ty -= TYPE.reference * 0.78
          textAt(page, line, { x: A4.side, y: ty, font: F.title, size: TYPE.reference, color: COLOR.ink3, align: 'right', width: A4.width })
          ty -= TYPE.reference * 0.55
        }
      }
      return Math.min(top - brand.h, ty)
    }
    // Pages suivantes : en-tête compact.
    const brand = drawBrand(doc, page, opts, top)
    const suite = `${pdfText(opts.title)}${opts.reference ? ` ${pdfText(opts.reference)}` : ''} · suite`
    textAt(page, suite, { x: A4.side, y: top - brand.h / 2 - 8.25 * 0.36, font: F.regular, size: 8.25, color: COLOR.ink3, align: 'right', width: A4.width })
    const ruleY = top - brand.h - 10.5
    hairline(page, A4.side, A4.right, ruleY, COLOR.lineStrong)
    return ruleY - 13.5
  }

  doc.onFinishPage = ({ page, pageIndex, pageCount }) => {
    hairline(page, A4.side, A4.right, footerRuleY, COLOR.lineStrong)
    const lines = [...baseLines]
    if (withPages) {
      const label = `Page ${pageIndex + 1} / ${pageCount}`
      if (lastFits) lines[lines.length - 1] = `${lines[lines.length - 1]} · ${label}`
      else lines.push(label)
    }
    let y = footerRuleY - 9 - TYPE.footer * 0.8
    for (const line of lines) {
      textAt(page, line, { x: A4.side, y, font: F.regular, size: TYPE.footer, color: COLOR.ink3, align: 'center', width: footerWidth })
      y -= TYPE.footerLh
    }
  }
}

// ─── Blocs ────────────────────────────────────────────────────────────────────

export type MetaItem = { label: string; value: string }

/** Bandeau gris des métadonnées (Date, Valable jusqu'au, Chantier…). */
export function drawMeta(doc: PdfDoc, items: MetaItem[], opts: { marginTop?: number } = {}): void {
  const list = items.filter(i => i.value)
  if (!list.length) return
  const F = doc.fonts
  const padX = 15
  const padY = 9
  const gap = 15
  const valueSize = 9.375
  const valueLh = 12.75
  const colW = (A4.width - padX * 2 - gap * (list.length - 1)) / list.length
  const wrapped = list.map(i => wrapText(pdfText(i.value), F.bold, valueSize, colW))
  const h = padY * 2 + TYPE.labelLh + 3 + Math.max(...wrapped.map(w => w.length)) * valueLh
  doc.moveDown(opts.marginTop ?? 16.5)
  doc.ensureSpace(h)
  const top = doc.y
  roundRect(doc.page, { x: A4.side, y: top - h, w: A4.width, h }, { fill: COLOR.fill })
  list.forEach((item, i) => {
    const x = A4.side + padX + i * (colW + gap)
    let y = top - padY - TYPE.label
    textAt(doc.page, pdfText(item.label), { x, y, font: F.bold, size: TYPE.label, color: COLOR.ink3 })
    y -= TYPE.labelLh - TYPE.label + 3
    for (const line of wrapped[i]) {
      y -= valueSize
      textAt(doc.page, line, { x, y, font: F.bold, size: valueSize, color: COLOR.ink })
      y -= valueLh - valueSize
    }
  })
  doc.y = top - h
}

export type Party = { label: string; name: string; lines: string[] }

/** Deux blocs côte à côte (De / Pour) ; le second est aligné à droite. */
export function drawParties(doc: PdfDoc, left: Party, right: Party, opts: { marginTop?: number } = {}): void {
  const F = doc.fonts
  const gap = 24
  const colW = (A4.width - gap) / 2
  const nameSize = 10.125
  const nameLh = 13.5
  const layout = (p: Party) => ({
    name: wrapText(pdfText(p.name) || '-', F.heading, nameSize, colW),
    lines: p.lines.filter(Boolean).flatMap(l => wrapText(pdfText(l), F.regular, TYPE.party, colW)),
  })
  const L = layout(left)
  const R = layout(right)
  const heightOf = (x: ReturnType<typeof layout>) => TYPE.labelLh + 3 + x.name.length * nameLh + (x.lines.length ? 2.25 + x.lines.length * TYPE.partyLh : 0)
  const h = Math.max(heightOf(L), heightOf(R))
  doc.moveDown(opts.marginTop ?? 15)
  doc.ensureSpace(h)
  const top = doc.y
  const drawCol = (p: Party, x: ReturnType<typeof layout>, colX: number, align: 'left' | 'right') => {
    let y = top - TYPE.label
    textAt(doc.page, pdfText(p.label), { x: colX, y, font: F.bold, size: TYPE.label, color: COLOR.ink3, align, width: colW })
    y -= TYPE.labelLh - TYPE.label + 3
    for (const line of x.name) {
      y -= nameSize
      textAt(doc.page, line, { x: colX, y, font: F.heading, size: nameSize, color: COLOR.ink, align, width: colW })
      y -= nameLh - nameSize
    }
    if (x.lines.length) y -= 2.25
    for (const line of x.lines) {
      y -= TYPE.party
      textAt(doc.page, line, { x: colX, y, font: F.regular, size: TYPE.party, color: COLOR.ink2, align, width: colW })
      y -= TYPE.partyLh - TYPE.party
    }
  }
  drawCol(left, L, A4.side, 'left')
  drawCol(right, R, A4.side + colW + gap, 'right')
  doc.y = top - h
}

/** Paragraphe centré avec petit libellé (« Votre demande », « Objet du contrat »…). */
export function drawCentered(doc: PdfDoc, label: string | null, text: string, opts: { marginTop?: number; align?: 'center' | 'left' } = {}): void {
  const F = doc.fonts
  const align = opts.align ?? 'center'
  const maxW = Math.min(420, A4.width)
  const x = align === 'center' ? A4.side + (A4.width - maxW) / 2 : A4.side
  const lines = wrapParagraphs(text, F.regular, TYPE.body, maxW)
  if (!lines.length) return
  doc.moveDown(opts.marginTop ?? 12)
  if (label) {
    doc.ensureSpace(TYPE.labelLh + 2.25 + TYPE.bodyLh)
    doc.y -= TYPE.label
    textAt(doc.page, pdfText(label), { x, y: doc.y, font: F.bold, size: TYPE.label, color: COLOR.ink3, align, width: maxW })
    doc.y -= TYPE.labelLh - TYPE.label + 2.25
  }
  for (const line of lines) {
    doc.ensureSpace(TYPE.bodyLh)
    doc.y -= TYPE.body
    textAt(doc.page, line, { x, y: doc.y, font: F.regular, size: TYPE.body, color: COLOR.ink, align, width: maxW })
    doc.y -= TYPE.bodyLh - TYPE.body
  }
}

/** Titre de rubrique avec filet (sec2). */
export function drawSectionTitle(doc: PdfDoc, title: string, opts: { marginTop?: number; right?: string } = {}): void {
  const F = doc.fonts
  const size = 8.25
  const h = 11.25 + 4.5
  doc.moveDown(opts.marginTop ?? 15)
  doc.ensureSpace(h + 30) // garde le titre avec la suite
  doc.y -= size + 1.5
  textAt(doc.page, pdfText(title), { x: A4.side, y: doc.y, font: F.heading, size, color: COLOR.ink })
  if (opts.right) textAt(doc.page, pdfText(opts.right), { x: A4.side, y: doc.y, font: F.bold, size: 7.875, color: COLOR.ink3, align: 'right', width: A4.width })
  doc.y -= h - size - 1.5
  hairline(doc.page, A4.side, A4.right, doc.y)
}

/** Note discrète (aside), alignée à droite par défaut. */
export function drawAside(doc: PdfDoc, text: string, opts: { align?: 'left' | 'right' | 'center'; marginTop?: number } = {}): void {
  const F = doc.fonts
  const lines = wrapParagraphs(text, F.regular, TYPE.small, A4.width)
  if (!lines.length) return
  doc.moveDown(opts.marginTop ?? 6)
  for (const line of lines) {
    doc.ensureSpace(TYPE.smallLh)
    doc.y -= TYPE.small
    textAt(doc.page, line, { x: A4.side, y: doc.y, font: F.regular, size: TYPE.small, color: COLOR.ink3, align: opts.align ?? 'right', width: A4.width })
    doc.y -= TYPE.smallLh - TYPE.small
  }
}

// ─── Tableau ──────────────────────────────────────────────────────────────────

export type Tone = 'ok' | 'warn' | 'alert' | 'neutral'

export type LineCell = {
  text: string
  bold?: boolean
  detail?: string[]
  color?: RGB
  pill?: Tone
}

export type LineColumn = { header: string; width: number; align?: 'left' | 'right' | 'center' }

export type LineRow =
  | { kind?: 'item'; cells: (LineCell | string)[] }
  | { kind: 'section'; title: string; right?: string }
  | { kind: 'total'; cells: (LineCell | string)[] }

const PILL: Record<Tone, { bg: keyof typeof COLOR; ink: keyof typeof COLOR }> = {
  ok: { bg: 'okBg', ink: 'okInk' },
  warn: { bg: 'warnBg', ink: 'warnInk' },
  alert: { bg: 'alertBg', ink: 'alertInk' },
  neutral: { bg: 'pill', ink: 'ink2' },
}

export function drawPill(page: PDFPage, font: PDFFont, text: string, tone: Tone, x: number, baseline: number, align: 'left' | 'right' | 'center' = 'left', width = 0): void {
  const size = TYPE.label
  const tw = font.widthOfTextAtSize(text, size)
  const w = tw + 13.5
  const h = 11.25
  const px = align === 'right' ? x + width - w : align === 'center' ? x + (width - w) / 2 : x
  roundRect(page, { x: px, y: baseline - 3, w, h, r: h / 2 }, { fill: COLOR[PILL[tone].bg] })
  page.drawText(text, { x: px + 6.75, y: baseline, size, font, color: COLOR[PILL[tone].ink] })
}

export type LineTableOptions = {
  marginTop?: number
  tight?: boolean
  /** Nombre de colonnes alignées à gauche (les autres sont des nombres, à droite). Défaut 1. */
  leftColumns?: number
}

const COL_GAP = 7.5 // 10 px

/** Largeur restante pour la première colonne. */
export function flexWidth(fixed: number[]): number {
  return A4.width - fixed.reduce((s, w) => s + w, 0) - COL_GAP * fixed.length
}

/** Tableau à filets fins (modèle .tb / .tr de la maquette). */
export function drawLineTable(doc: PdfDoc, cols: LineColumn[], rows: LineRow[], opts: LineTableOptions = {}): void {
  const F = doc.fonts
  const padY = opts.tight ? 3.75 : 5.25
  const lh = 12
  const detailSize = TYPE.small
  const detailLh = TYPE.smallLh
  const xs: number[] = []
  {
    let x = A4.side
    for (const c of cols) { xs.push(x); x += c.width + COL_GAP }
  }
  const leftCount = opts.leftColumns ?? 1
  const alignOf = (i: number) => cols[i].align ?? (i < leftCount ? 'left' : 'right')
  const norm = (c: LineCell | string): LineCell => typeof c === 'string' ? { text: c } : c

  const drawHeader = () => {
    const h = TYPE.labelLh + 6
    doc.ensureSpace(h + 24)
    const y = doc.y - TYPE.label - 0.75
    cols.forEach((c, i) => textAt(doc.page, pdfText(c.header), { x: xs[i], y, font: F.bold, size: TYPE.label, color: COLOR.ink3, align: alignOf(i), width: c.width }))
    doc.y -= h
    hairline(doc.page, A4.side, A4.right, doc.y, COLOR.ink)
  }

  const layoutCells = (cells: (LineCell | string)[]) => cells.map((raw, i) => {
    const c = norm(raw)
    const font = c.bold ? F.bold : F.regular
    const lines = c.pill ? [pdfText(c.text)] : wrapText(pdfText(c.text), font, TYPE.body, cols[i].width)
    const detail = (c.detail ?? []).filter(Boolean).flatMap(d => wrapText(pdfText(d), F.regular, detailSize, cols[i].width))
    const h = lines.length * lh + (detail.length ? 0.75 + detail.length * detailLh : 0)
    return { c, font, lines, detail, h }
  })

  const rowHeight = (row: LineRow): number => {
    if (row.kind === 'section') return 9 + 11.25 + 4.5
    return padY * 2 + Math.max(...layoutCells(row.cells).map(x => x.h))
  }

  const drawCells = (cells: (LineCell | string)[], top: number, isTotal: boolean) => {
    layoutCells(cells).forEach(({ c, font, lines, detail }, i) => {
      const align = alignOf(i)
      const isLast = i === cols.length - 1
      const color = c.color ?? (i < leftCount || isLast || isTotal ? COLOR.ink : COLOR.ink2)
      let y = top - padY
      for (const line of lines) {
        y -= TYPE.body
        if (c.pill) drawPill(doc.page, F.bold, line, c.pill, xs[i], y + 0.75, align, cols[i].width)
        else textAt(doc.page, line, { x: xs[i], y, font, size: TYPE.body, color, align, width: cols[i].width })
        y -= lh - TYPE.body
      }
      if (detail.length) y -= 0.75
      for (const d of detail) {
        y -= detailSize
        textAt(doc.page, d, { x: xs[i], y, font: F.regular, size: detailSize, color: COLOR.ink3, align, width: cols[i].width })
        y -= detailLh - detailSize
      }
    })
  }

  doc.moveDown(opts.marginTop ?? 15)
  drawHeader()
  rows.forEach((row, idx) => {
    const h = rowHeight(row)
    // Garde un titre de lot avec sa première ligne.
    const keep = row.kind === 'section' && rows[idx + 1] ? rowHeight(rows[idx + 1]) : 0
    if (doc.y - h - keep < doc.bottomLimit) {
      doc.addPage()
      drawHeader()
    }
    const top = doc.y
    if (row.kind === 'section') {
      const size = 8.25
      const base = top - 9 - size - 1.5
      textAt(doc.page, pdfText(row.title), { x: A4.side, y: base, font: F.heading, size, color: COLOR.ink })
      if (row.right) textAt(doc.page, pdfText(row.right), { x: A4.side, y: base, font: F.bold, size: 7.875, color: COLOR.ink3, align: 'right', width: A4.width })
      doc.y = top - h
      hairline(doc.page, A4.side, A4.right, doc.y)
      return
    }
    if (row.kind === 'total') {
      hairline(doc.page, A4.side, A4.right, top, COLOR.ink)
      drawCells(row.cells.map(c => ({ ...norm(c), bold: true })), top, true)
      doc.y = top - h
      return
    }
    drawCells(row.cells, top, false)
    doc.y = top - h
    hairline(doc.page, A4.side, A4.right, doc.y)
  })
}

// ─── Totaux ───────────────────────────────────────────────────────────────────

export type TotalLine = { label: string; value: string; color?: RGB }

export type TotalsCard = {
  lines: TotalLine[]
  /** Totaux mis en avant ; `lines` éventuelles dessinées juste avant (ex. retenue avant le net à payer). */
  grands: { label: string; value: string; lines?: TotalLine[] }[]
  width?: number
  marginTop?: number
}

export const TOTALS_W = 219 // 292 px

function measureTotals(t: TotalsCard): number {
  const padY = 9
  const lineH = 17.25
  const sepH = 6 + 7.5
  let h = padY * 2 + t.lines.length * lineH
  t.grands.forEach((g, i) => {
    if (i > 0 || t.lines.length) h += sepH
    h += (g.lines?.length ?? 0) * lineH
    if (g.lines?.length) h += sepH
    h += 19.5
  })
  return h
}

/**
 * Encadré gris des totaux, aligné à droite. Mise en page resserrée (pour tenir
 * sur une page) : `left` est posée à sa gauche sur toute la hauteur de la rangée,
 * `below` sous les totaux, dans la même colonne.
 */
export function drawTotals(doc: PdfDoc, t: TotalsCard, opts: { left?: CardBlock; below?: CardBlock } = {}): void {
  const F = doc.fonts
  const w = t.width ?? TOTALS_W
  const padX = 13.5
  const padY = 9
  const lineH = 17.25
  const grandValue = 16.5
  const h = measureTotals(t)
  const gap = 12
  const leftW = A4.width - w - gap
  const belowH = opts.below ? opts.below.measure(w) : 0
  const rightH = h + (opts.below ? gap + belowH : 0)
  const leftH = opts.left ? opts.left.measure(leftW) : 0
  const rowH = Math.max(rightH, leftH)
  doc.moveDown(t.marginTop ?? 12)
  doc.ensureSpace(rowH)
  const top = doc.y
  const x = A4.right - w
  if (opts.left) opts.left.draw(A4.side, top, leftW, rowH)
  if (opts.below) opts.below.draw(x, top - h - gap, w, rowH - h - gap)
  roundRect(doc.page, { x, y: top - h, w, h }, { fill: COLOR.fill })
  let y = top - padY
  const drawLine = (l: TotalLine) => {
    const base = y - 2.25 - TYPE.body - 1.5
    textAt(doc.page, pdfText(l.label), { x: x + padX, y: base, font: F.regular, size: TYPE.body, color: COLOR.ink2 })
    textAt(doc.page, pdfText(l.value), { x: x + padX, y: base, font: F.bold, size: TYPE.body, color: l.color ?? COLOR.ink, align: 'right', width: w - padX * 2 })
    y -= lineH
  }
  const separator = () => {
    y -= 6
    hairline(doc.page, x + padX, x + w - padX, y, COLOR.lineTotal)
    y -= 7.5
  }
  t.lines.forEach(drawLine)
  t.grands.forEach((g, i) => {
    if (i > 0 || t.lines.length) separator()
    if (g.lines?.length) {
      g.lines.forEach(drawLine)
      separator()
    }
    const base = y - grandValue * 0.92
    textAt(doc.page, pdfText(g.label), { x: x + padX, y: base, font: F.bold, size: 9.375, color: COLOR.ink })
    textAt(doc.page, pdfText(g.value), { x: x + padX, y: base, font: F.heading, size: grandValue, color: COLOR.ink, align: 'right', width: w - padX * 2 })
    y -= 19.5
  })
  doc.y = top - rowH
}

// ─── Cartes de fin (conditions, signature, statut) ────────────────────────────

export type CardBlock = {
  /** Part de largeur (grid 1.25fr / 1fr). */
  weight: number
  measure: (width: number) => number
  draw: (x: number, top: number, width: number, height: number) => void
}

const CARD_PAD = { x: 13.5, y: 10.5 }

/** Carte grise (cd) : petit libellé puis paragraphes riches. */
export function infoCard(doc: PdfDoc, label: string, paragraphs: RichParagraph[], opts: { weight?: number; outline?: boolean } = {}): CardBlock {
  const F = doc.fonts
  const size = TYPE.small
  const lh = 11.25
  const layout = (w: number) => paragraphs
    .filter(p => toSegments(p).some(s => s.text.trim()))
    .map(p => wrapRich(p, { regular: F.regular, bold: F.bold }, size, w - CARD_PAD.x * 2))
  const measure = (w: number) => {
    const paras = layout(w)
    const lines = paras.reduce((s, p) => s + p.length, 0)
    return CARD_PAD.y * 2 + TYPE.labelLh + 2.25 + lines * lh + Math.max(0, paras.length - 1) * 4.5
  }
  return {
    weight: opts.weight ?? 1,
    measure,
    draw: (x, top, w, h) => {
      roundRect(doc.page, { x, y: top - h, w, h }, opts.outline ? { border: COLOR.lineStrong } : { fill: COLOR.fill })
      let y = top - CARD_PAD.y - TYPE.label
      textAt(doc.page, pdfText(label), { x: x + CARD_PAD.x, y, font: F.bold, size: TYPE.label, color: COLOR.ink3 })
      y -= TYPE.labelLh - TYPE.label + 2.25
      layout(w).forEach((para, pi) => {
        if (pi) y -= 4.5
        for (const line of para) {
          y -= size
          drawRichLine(doc.page, line, x + CARD_PAD.x, y, size, { regular: COLOR.ink2, bold: COLOR.ink }, F.bold)
          y -= lh - size
        }
      })
    },
  }
}

/**
 * Carte de signature (sg) : libellé en haut, mention en bas. `lines` : identité
 * du signataire (nom, qualité, date) ; `signed` : signature recueillie (image).
 */
export function signatureCard(doc: PdfDoc, label: string, hint: string, opts: { weight?: number; lines?: string[]; signed?: { lines: string[]; image: PDFImage | null } } = {}): CardBlock {
  const F = doc.fonts
  const identity = (opts.signed?.lines ?? opts.lines ?? []).filter(Boolean)
  const minH = opts.signed?.image ? 96 : 72 + Math.max(0, identity.length - 2) * TYPE.smallLh
  return {
    weight: opts.weight ?? 1,
    measure: () => minH,
    draw: (x, top, w, h) => {
      roundRect(doc.page, { x, y: top - h, w, h }, { border: COLOR.lineStrong })
      let y = top - CARD_PAD.y - TYPE.label
      textAt(doc.page, pdfText(label), { x: x + CARD_PAD.x, y, font: F.bold, size: TYPE.label, color: COLOR.ink3 })
      y -= TYPE.labelLh - TYPE.label + 2.25
      for (const line of identity) {
        y -= TYPE.small
        textAt(doc.page, wrapText(pdfText(line), F.regular, TYPE.small, w - CARD_PAD.x * 2)[0] ?? '', { x: x + CARD_PAD.x, y, font: F.regular, size: TYPE.small, color: COLOR.ink2 })
        y -= TYPE.smallLh - TYPE.small
      }
      const image = opts.signed?.image
      if (image) {
        const boxH = Math.max(20, y - (top - h) - CARD_PAD.y - 2)
        drawImageContained(doc, image, { x: x + CARD_PAD.x, y: top - h + CARD_PAD.y, w: w - CARD_PAD.x * 2, h: Math.min(46, boxH) }, 'center')
        return
      }
      if (opts.signed) return
      const hintLines = wrapText(pdfText(hint), F.regular, TYPE.label, w - CARD_PAD.x * 2)
      let hy = top - h + CARD_PAD.y + (hintLines.length - 1) * TYPE.labelLh + 1.5
      for (const line of hintLines) {
        textAt(doc.page, line, { x: x + CARD_PAD.x, y: hy, font: F.regular, size: TYPE.label, color: COLOR.ink3 })
        hy -= TYPE.labelLh
      }
    },
  }
}

/** Carte de statut (pay) : libellé, valeur en Geist Bold, précision. */
export function statusCard(doc: PdfDoc, label: string, value: string, note: string | null, opts: { weight?: number } = {}): CardBlock {
  const F = doc.fonts
  const vSize = 15
  return {
    weight: opts.weight ?? 1,
    measure: (w) => {
      const noteLines = note ? wrapText(pdfText(note), F.regular, TYPE.party, w - CARD_PAD.x * 2).length : 0
      return CARD_PAD.y * 2 + TYPE.labelLh + 2.25 + 18 + noteLines * TYPE.partyLh + (noteLines ? 1.5 : 0)
    },
    draw: (x, top, w, h) => {
      roundRect(doc.page, { x, y: top - h, w, h }, { border: COLOR.lineStrong })
      const noteLines = note ? wrapText(pdfText(note), F.regular, TYPE.party, w - CARD_PAD.x * 2) : []
      const contentH = TYPE.labelLh + 2.25 + 18 + noteLines.length * TYPE.partyLh + (noteLines.length ? 1.5 : 0)
      let y = top - (h - contentH) / 2 - TYPE.label
      textAt(doc.page, pdfText(label), { x: x + CARD_PAD.x, y, font: F.bold, size: TYPE.label, color: COLOR.ink3 })
      y -= TYPE.labelLh - TYPE.label + 2.25 + vSize * 0.9
      textAt(doc.page, pdfText(value), { x: x + CARD_PAD.x, y, font: F.heading, size: vSize, color: COLOR.ink })
      y -= 18 - vSize * 0.9 + 1.5
      for (const line of noteLines) {
        y -= TYPE.party
        textAt(doc.page, line, { x: x + CARD_PAD.x, y, font: F.regular, size: TYPE.party, color: COLOR.ink2 })
        y -= TYPE.partyLh - TYPE.party
      }
    },
  }
}

/**
 * Rangée de cartes (grille). `pin` : posée en bas de la dernière page, au-dessus
 * du pied (margin-top: auto de la maquette).
 */
export function drawCardRow(doc: PdfDoc, blocks: CardBlock[], opts: { pin?: boolean; marginTop?: number; gap?: number; width?: number } = {}): void {
  const list = blocks.filter(Boolean)
  if (!list.length) return
  const gap = opts.gap ?? 12
  const totalWeight = list.reduce((s, b) => s + b.weight, 0)
  // `width` : largeur totale de la rangée, alignée à droite (ex. signature sous les totaux).
  const rowW = opts.width ?? A4.width
  const free = rowW - gap * (list.length - 1)
  const widths = list.map(b => free * b.weight / totalWeight)
  const h = Math.max(...list.map((b, i) => b.measure(widths[i])))
  doc.moveDown(opts.marginTop ?? 12)
  if (opts.pin) doc.pinToBottom(h)
  else doc.ensureSpace(h)
  const top = doc.y
  let x = A4.right - rowW
  list.forEach((b, i) => {
    b.draw(x, top, widths[i], h)
    x += widths[i] + gap
  })
  doc.y = top - h
}

/** Hauteur d'une rangée de cartes (pour décider d'une mise en page). */
export function measureCardRow(blocks: CardBlock[], gap = 12): number {
  const list = blocks.filter(Boolean)
  if (!list.length) return 0
  const totalWeight = list.reduce((s, b) => s + b.weight, 0)
  const free = A4.width - gap * (list.length - 1)
  return Math.max(...list.map(b => b.measure(free * b.weight / totalWeight)))
}

// ─── Rapports : chiffres clés, avancement, liste cochée ───────────────────────

export type Kpi = { label: string; value: string; note?: string | null; noteColor?: RGB; valueColor?: RGB }

/** Grand chiffre (kp.hero). */
export function drawHeroKpi(doc: PdfDoc, k: Kpi, opts: { marginTop?: number } = {}): void {
  const F = doc.fonts
  const vSize = 25.5
  const h = 13.5 * 2 + TYPE.labelLh + 3 + 28.5
  doc.moveDown(opts.marginTop ?? 15)
  doc.ensureSpace(h)
  const top = doc.y
  roundRect(doc.page, { x: A4.side, y: top - h, w: A4.width, h }, { fill: COLOR.fill })
  let y = top - 13.5 - TYPE.label
  textAt(doc.page, pdfText(k.label), { x: A4.side + 16.5, y, font: F.bold, size: TYPE.label, color: COLOR.ink3 })
  y -= TYPE.labelLh - TYPE.label + 3 + vSize * 0.85
  const value = pdfText(k.value)
  textAt(doc.page, value, { x: A4.side + 16.5, y, font: F.heading, size: vSize, color: k.valueColor ?? COLOR.ink })
  if (k.note) {
    const nx = A4.side + 16.5 + F.heading.widthOfTextAtSize(value, vSize) + 10.5
    textAt(doc.page, pdfText(k.note), { x: nx, y, font: F.regular, size: 8.25, color: k.noteColor ?? COLOR.okInk })
  }
  doc.y = top - h
}

/** Grille de chiffres (kps, 3 colonnes par défaut). */
export function drawKpiGrid(doc: PdfDoc, items: Kpi[], opts: { columns?: number; marginTop?: number } = {}): void {
  if (!items.length) return
  const F = doc.fonts
  const cols = opts.columns ?? 3
  const gap = 7.5
  const w = (A4.width - gap * (cols - 1)) / cols
  const vSize = 15
  const cellH = (k: Kpi) => 10.5 * 2 + TYPE.labelLh + 2.25 + 18 + (k.note ? wrapText(pdfText(k.note), F.regular, TYPE.small, w - 27).length * TYPE.smallLh : 0)
  doc.moveDown(opts.marginTop ?? 7.5)
  for (let i = 0; i < items.length; i += cols) {
    const row = items.slice(i, i + cols)
    const h = Math.max(...row.map(cellH))
    if (i > 0) doc.moveDown(gap)
    doc.ensureSpace(h)
    const top = doc.y
    row.forEach((k, j) => {
      const x = A4.side + j * (w + gap)
      roundRect(doc.page, { x, y: top - h, w, h }, { fill: COLOR.fill })
      let y = top - 10.5 - TYPE.label
      textAt(doc.page, wrapText(pdfText(k.label), F.bold, TYPE.label, w - 27)[0] ?? '', { x: x + 13.5, y, font: F.bold, size: TYPE.label, color: COLOR.ink3 })
      y -= TYPE.labelLh - TYPE.label + 2.25 + vSize * 0.9
      textAt(doc.page, wrapText(pdfText(k.value), F.heading, vSize, w - 27)[0] ?? '', { x: x + 13.5, y, font: F.heading, size: vSize, color: k.valueColor ?? COLOR.ink })
      y -= 18 - vSize * 0.9
      if (k.note) {
        for (const line of wrapText(pdfText(k.note), F.regular, TYPE.small, w - 27)) {
          y -= TYPE.small
          textAt(doc.page, line, { x: x + 13.5, y, font: F.regular, size: TYPE.small, color: k.noteColor ?? COLOR.ink3 })
          y -= TYPE.smallLh - TYPE.small
        }
      }
    })
    doc.y = top - h
  }
}

/** Barre d'avancement (pr). */
export function drawProgress(doc: PdfDoc, label: string, pct: number, opts: { marginTop?: number; right?: string } = {}): void {
  const F = doc.fonts
  const value = Math.max(0, Math.min(100, Math.round(pct)))
  doc.moveDown(opts.marginTop ?? 15)
  doc.ensureSpace(12.75 + 6 + 4.5)
  doc.y -= TYPE.body
  textAt(doc.page, pdfText(label), { x: A4.side, y: doc.y, font: F.bold, size: TYPE.body, color: COLOR.ink })
  textAt(doc.page, pdfText(opts.right ?? `${value} %`), { x: A4.side, y: doc.y, font: F.regular, size: TYPE.body, color: COLOR.ink, align: 'right', width: A4.width })
  doc.y -= 12.75 - TYPE.body + 6 - 3
  roundRect(doc.page, { x: A4.side, y: doc.y - 4.5, w: A4.width, h: 4.5, r: 2.25 }, { fill: COLOR.line })
  if (value > 0) roundRect(doc.page, { x: A4.side, y: doc.y - 4.5, w: Math.max(4.5, A4.width * value / 100), h: 4.5, r: 2.25 }, { fill: COLOR.accent })
  doc.y -= 4.5
}

/** Liste cochée sur deux colonnes (chk). `done` faux : rond vide. */
export function drawChecklist(doc: PdfDoc, items: { text: string; done?: boolean }[], opts: { marginTop?: number; columns?: number } = {}): void {
  if (!items.length) return
  const F = doc.fonts
  const cols = opts.columns ?? 2
  const colGap = 18
  const rowGap = 6.75
  const dot = 13.5
  const w = (A4.width - colGap * (cols - 1)) / cols
  const textW = w - dot - 6.75
  doc.moveDown(opts.marginTop ?? 9)
  for (let i = 0; i < items.length; i += cols) {
    const row = items.slice(i, i + cols)
    const wrapped = row.map(it => wrapText(pdfText(it.text), F.regular, TYPE.body, textW))
    const h = Math.max(dot, ...wrapped.map(l => l.length * 12))
    if (i > 0) doc.moveDown(rowGap)
    doc.ensureSpace(h)
    const top = doc.y
    row.forEach((it, j) => {
      const x = A4.side + j * (w + colGap)
      const cy = top - Math.min(h, 12) / 2 - 0.75
      const done = it.done !== false
      doc.page.drawCircle({ x: x + dot / 2, y: cy, size: dot / 2, color: done ? COLOR.ink : undefined, borderColor: done ? undefined : COLOR.lineStrong, borderWidth: done ? undefined : 0.75 })
      if (done) {
        doc.page.drawSvgPath('M 0 2.8 L 2.4 5.2 L 7.5 0', { x: x + dot / 2 - 3.75, y: cy + 2.6, borderColor: COLOR.white, borderWidth: 1.35, borderLineCap: 1 })
      }
      let y = top
      for (const line of wrapped[j]) {
        y -= TYPE.body + 1
        textAt(doc.page, line, { x: x + dot + 6.75, y, font: F.regular, size: TYPE.body, color: COLOR.ink })
        y -= 12 - TYPE.body - 1
      }
    })
    doc.y = top - h
  }
}

/** Histogramme simple (ch) : barres arrondies, la dernière ou celles marquées en orange. */
export function drawBarChart(doc: PdfDoc, label: string, bars: { label: string; value: number; highlight?: boolean; valueLabel?: string }[], opts: { height?: number; marginTop?: number } = {}): void {
  if (!bars.length) return
  const F = doc.fonts
  const chartH = opts.height ?? 112.5
  const labelH = TYPE.labelLh + 4.5
  const axisH = 12
  const h = labelH + chartH + axisH
  doc.moveDown(opts.marginTop ?? 15)
  doc.ensureSpace(h)
  const top = doc.y
  textAt(doc.page, pdfText(label), { x: A4.side, y: top - TYPE.label, font: F.bold, size: TYPE.label, color: COLOR.ink3 })
  const max = Math.max(1, ...bars.map(b => b.value))
  const slot = A4.width / bars.length
  const barW = Math.min(71.25, slot * 0.62)
  const baseY = top - labelH - chartH
  const valueRoom = 12
  bars.forEach((b, i) => {
    const bh = Math.max(b.value > 0 ? 3 : 0, (chartH - valueRoom) * (b.value / max))
    const x = A4.side + i * slot + (slot - barW) / 2
    if (bh > 0) roundRect(doc.page, { x, y: baseY, w: barW, h: bh, r: Math.min(6, bh / 2) }, { fill: b.highlight ? COLOR.accent : COLOR.line })
    if (b.valueLabel) textAt(doc.page, pdfText(b.valueLabel), { x: x - 10, y: baseY + bh + 3, font: F.regular, size: 6.75, color: COLOR.ink3, align: 'center', width: barW + 20 })
    textAt(doc.page, pdfText(b.label), { x: A4.side + i * slot, y: baseY - axisH + 3, font: F.regular, size: 7.5, color: COLOR.ink3, align: 'center', width: slot })
  })
  doc.y = top - h
}

// ─── Journal, paragraphes, photos ─────────────────────────────────────────────

/** Paragraphes de texte courant (les lignes vides séparent les paragraphes). */
export function drawParagraphs(doc: PdfDoc, text: string, opts: { marginTop?: number; color?: RGB } = {}): void {
  const F = doc.fonts
  const paras = String(text ?? '').replace(/\r\n/g, '\n').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
  if (!paras.length) return
  doc.moveDown(opts.marginTop ?? 6)
  paras.forEach((p, i) => {
    if (i) doc.moveDown(4.5)
    for (const line of wrapParagraphs(p, F.regular, TYPE.body, A4.width)) {
      doc.ensureSpace(TYPE.bodyLh)
      doc.y -= TYPE.body
      textAt(doc.page, line, { x: A4.side, y: doc.y, font: F.regular, size: TYPE.body, color: opts.color ?? COLOR.ink2 })
      doc.y -= TYPE.bodyLh - TYPE.body
    }
  })
}

/** Entrées datées (journal, observations) : petite ligne grise puis texte, filet entre deux. */
export function drawEntries(doc: PdfDoc, entries: { meta: string; text: string }[], opts: { marginTop?: number } = {}): void {
  const F = doc.fonts
  doc.moveDown(opts.marginTop ?? 4.5)
  entries.forEach(entry => {
    const lines = wrapParagraphs(entry.text, F.regular, TYPE.body, A4.width)
    const h = 6 + TYPE.labelLh + 1.5 + lines.length * TYPE.bodyLh + 6
    doc.ensureSpace(Math.min(h, TYPE.labelLh + TYPE.bodyLh * 2 + 12))
    doc.y -= 6 + TYPE.label
    textAt(doc.page, pdfText(entry.meta), { x: A4.side, y: doc.y, font: F.bold, size: TYPE.label, color: COLOR.ink3 })
    doc.y -= TYPE.labelLh - TYPE.label + 1.5
    for (const line of lines) {
      doc.ensureSpace(TYPE.bodyLh)
      doc.y -= TYPE.body
      textAt(doc.page, line, { x: A4.side, y: doc.y, font: F.regular, size: TYPE.body, color: COLOR.ink })
      doc.y -= TYPE.bodyLh - TYPE.body
    }
    doc.y -= 6
    hairline(doc.page, A4.side, A4.right, doc.y)
  })
}

export type GridPhoto = { image: PDFImage | null; title: string; caption?: string | null }

/** Grille de photos (pho3) : vignettes arrondies, titre et légende dessous. */
export function drawPhotoGrid(doc: PdfDoc, photos: GridPhoto[], opts: { columns?: number; height?: number; marginTop?: number } = {}): void {
  if (!photos.length) return
  const F = doc.fonts
  const cols = opts.columns ?? 3
  const gap = 9
  const w = (A4.width - gap * (cols - 1)) / cols
  const tileH = opts.height ?? 112.5
  doc.moveDown(opts.marginTop ?? 12)
  for (let i = 0; i < photos.length; i += cols) {
    const row = photos.slice(i, i + cols)
    const texts = row.map(p => ({
      title: wrapText(pdfText(p.title), F.bold, TYPE.label, w),
      caption: p.caption ? wrapText(pdfText(p.caption), F.regular, TYPE.label, w) : [],
    }))
    const textH = Math.max(...texts.map(t => (t.title.length + t.caption.length) * TYPE.labelLh))
    const h = tileH + 4.5 + textH
    if (i > 0) doc.moveDown(gap)
    doc.ensureSpace(h)
    const top = doc.y
    row.forEach((p, j) => {
      const x = A4.side + j * (w + gap)
      roundRect(doc.page, { x, y: top - tileH, w, h: tileH, r: 9 }, { fill: COLOR.fill })
      if (p.image) drawImageContained(doc, p.image, { x, y: top - tileH, w, h: tileH }, 'center')
      let y = top - tileH - 4.5
      for (const line of texts[j].title) {
        y -= TYPE.label
        textAt(doc.page, line, { x, y, font: F.bold, size: TYPE.label, color: COLOR.ink })
        y -= TYPE.labelLh - TYPE.label
      }
      for (const line of texts[j].caption) {
        y -= TYPE.label
        textAt(doc.page, line, { x, y, font: F.regular, size: TYPE.label, color: COLOR.ink3 })
        y -= TYPE.labelLh - TYPE.label
      }
    })
    doc.y = top - h
  }
}
