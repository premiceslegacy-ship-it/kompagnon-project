import type { PDFFont, RGB } from 'pdf-lib'
import type { PdfDoc } from './doc'
import { measureTextHeight, textLineHeight, wrapText, type TextStyle } from './text'
import { COLOR, PAGE } from './theme'

export type TableColumn = {
  width: number
  align?: 'left' | 'center' | 'right'
  header: string
}

/**
 * Une cellule peut être une simple valeur, ou une valeur + lignes de détail
 * (ex: description + "Comprend : ..." en dessous, plus petit et grisé).
 */
export type TableCell = {
  value: string
  detailLines?: string[]
  style?: Partial<TextStyle>
}

export type TableRow = {
  cells: TableCell[]
  zebra?: boolean
}

export type DrawTableOptions = {
  x: number
  headerStyle: TextStyle
  cellStyle: TextStyle
  detailStyle: TextStyle
  rowPaddingY: number
  headerPaddingY: number
  repeatHeader?: boolean
  zebra?: boolean
  onHeaderDrawn?: () => void
}

function drawHeaderRow(doc: PdfDoc, cols: TableColumn[], opts: DrawTableOptions): void {
  const rowH = opts.headerStyle.size + opts.headerPaddingY * 2
  doc.ensureSpace(rowH)
  let x = opts.x
  const baselineY = doc.y - opts.headerPaddingY - opts.headerStyle.size
  for (const col of cols) {
    const label = col.header.toUpperCase()
    const labelWidth = opts.headerStyle.font.widthOfTextAtSize(label, opts.headerStyle.size)
    const drawX = col.align === 'right'
      ? x + col.width - labelWidth
      : col.align === 'center'
        ? x + (col.width - labelWidth) / 2
        : x
    doc.page.drawText(label, {
      x: drawX,
      y: baselineY,
      size: opts.headerStyle.size,
      font: opts.headerStyle.font,
      color: opts.headerStyle.color,
    })
    x += col.width
  }
  doc.y -= rowH
  doc.page.drawLine({
    start: { x: opts.x, y: doc.y },
    end: { x: opts.x + cols.reduce((s, c) => s + c.width, 0), y: doc.y },
    thickness: 1,
    color: COLOR.black,
  })
}

function measureRowHeight(row: TableRow, cols: TableColumn[], opts: DrawTableOptions): number {
  let maxH = 0
  row.cells.forEach((cell, i) => {
    const col = cols[i]
    const style: TextStyle = { ...opts.cellStyle, ...cell.style, maxWidth: col.width }
    let h = measureTextHeight(cell.value, style)
    if (cell.detailLines?.length) {
      const detailStyle: TextStyle = { ...opts.detailStyle, maxWidth: col.width }
      h += 3 + cell.detailLines.reduce((s, line) => s + measureTextHeight(line, detailStyle), 0)
    }
    if (h > maxH) maxH = h
  })
  return maxH + opts.rowPaddingY * 2
}

function drawRow(doc: PdfDoc, row: TableRow, cols: TableColumn[], opts: DrawTableOptions, rowTopY: number, rowHeight: number): void {
  if (row.zebra) {
    doc.page.drawRectangle({
      x: opts.x,
      y: rowTopY - rowHeight,
      width: cols.reduce((s, c) => s + c.width, 0),
      height: rowHeight,
      color: COLOR.surface,
    })
  }

  let x = opts.x
  row.cells.forEach((cell, i) => {
    const col = cols[i]
    const style: TextStyle = { ...opts.cellStyle, ...cell.style, maxWidth: col.width, align: col.align }
    let cursorY = rowTopY - opts.rowPaddingY

    const lines = wrapText(cell.value, style.font, style.size, col.width)
    const lh = textLineHeight(style)
    for (const line of lines) {
      cursorY -= style.size
      const lineWidth = style.font.widthOfTextAtSize(line, style.size)
      const drawX = col.align === 'right' ? x + col.width - lineWidth : col.align === 'center' ? x + (col.width - lineWidth) / 2 : x
      doc.page.drawText(line, { x: drawX, y: cursorY, size: style.size, font: style.font, color: style.color })
      cursorY -= lh - style.size
    }

    if (cell.detailLines?.length) {
      cursorY -= 3
      const detailStyle: TextStyle = { ...opts.detailStyle, maxWidth: col.width }
      for (const detailLine of cell.detailLines) {
        const dLines = wrapText(detailLine, detailStyle.font, detailStyle.size, col.width)
        const dlh = textLineHeight(detailStyle)
        for (const dl of dLines) {
          cursorY -= detailStyle.size
          doc.page.drawText(dl, { x, y: cursorY, size: detailStyle.size, font: detailStyle.font, color: detailStyle.color })
          cursorY -= dlh - detailStyle.size
        }
      }
    }

    x += col.width
  })

  doc.page.drawLine({
    start: { x: opts.x, y: rowTopY - rowHeight },
    end: { x: opts.x + cols.reduce((s, c) => s + c.width, 0), y: rowTopY - rowHeight },
    thickness: 0.5,
    color: COLOR.divider,
  })
}

/** Dessine un tableau complet : en-tête + lignes, avec saut de page et répétition d'en-tête. */
export function drawTable(doc: PdfDoc, cols: TableColumn[], rows: TableRow[], opts: DrawTableOptions): void {
  drawHeaderRow(doc, cols, opts)
  opts.onHeaderDrawn?.()

  for (const row of rows) {
    const rowHeight = measureRowHeight(row, cols, opts)
    const bottomLimit = PAGE.footerHeight
    if (doc.y - rowHeight < bottomLimit) {
      doc.addPage()
      if (opts.repeatHeader) {
        drawHeaderRow(doc, cols, opts)
        opts.onHeaderDrawn?.()
      }
    }
    const rowTopY = doc.y
    drawRow(doc, row, cols, opts, rowTopY, rowHeight)
    doc.y -= rowHeight
  }
}

export type SolidBlockLine = { text: string; style: TextStyle }

/** Bloc simple (fond + texte), insécable — pour les lignes "section" dans les tableaux. */
export function drawSolidBlock(doc: PdfDoc, lines: SolidBlockLine[], opts: { x: number; width: number; paddingY: number; paddingX: number; background?: RGB }): void {
  const contentH = lines.reduce((s, l) => s + textLineHeight(l.style), 0)
  const blockH = contentH + opts.paddingY * 2
  doc.ensureSpace(blockH)

  if (opts.background) {
    doc.page.drawRectangle({ x: opts.x, y: doc.y - blockH, width: opts.width, height: blockH, color: opts.background })
  }

  let cursorY = doc.y - opts.paddingY
  for (const line of lines) {
    cursorY -= line.style.size
    doc.page.drawText(line.text, { x: opts.x + opts.paddingX, y: cursorY, size: line.style.size, font: line.style.font, color: line.style.color })
    cursorY -= textLineHeight(line.style) - line.style.size
  }
  doc.y -= blockH
  doc.page.drawLine({
    start: { x: opts.x, y: doc.y },
    end: { x: opts.x + opts.width, y: doc.y },
    thickness: 0.5,
    color: COLOR.divider,
  })
}
