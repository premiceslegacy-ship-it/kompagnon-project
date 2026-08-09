import type { Organization } from '@/lib/data/queries/organization'
import { fmtCapitalSocial, pdfText } from '@/lib/pdf/pdf-design-system'
import { PdfDoc } from '../engine/doc'
import type { FontBytes } from '../engine/fonts'
import { loadFontBytes } from '../engine/fonts'
import { drawImageContained, embedImage } from '../engine/image'
import { textLineHeight, wrapText, type TextStyle } from '../engine/text'
import { COLOR, CONTENT_WIDTH, PAGE, SIZE, SPACE } from '../engine/theme'
import { rgb } from 'pdf-lib'

// ─── Types ────────────────────────────────────────────────────────────────────

export type DgdLine = {
  label: string
  reference?: string | null
  date?: string | null
  amount_ht: number
  retention_pct?: number | null
  retention_amount?: number | null
  net_ht?: number | null
  cumulative_pct?: number | null
  type: 'marche' | 'avenant' | 'situation' | 'solde' | 'liberation_rg' | 'total'
}

export type DgdPdfData = {
  chantierTitle: string
  chantierAddress?: string | null
  clientName?: string | null
  marketReference?: string | null
  lines: DgdLine[]
  totalMarcheHt: number
  totalSituationsHt: number
  totalRetentionHt: number
  totalNetHt: number
  receptionDate?: string | null
  receptionStatus?: string | null
  organization: Organization
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  pdfText(new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n))

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-'

const TYPE_COLORS: Record<DgdLine['type'], ReturnType<typeof rgb>> = {
  marche: rgb(0x1e / 255, 0x40 / 255, 0xaf / 255),
  avenant: rgb(0x7c / 255, 0x3a / 255, 0xed / 255),
  situation: COLOR.body,
  solde: rgb(0x06 / 255, 0x5f / 255, 0x46 / 255),
  liberation_rg: rgb(0xb4 / 255, 0x53 / 255, 0x09 / 255),
  total: COLOR.black,
}

const TYPE_LABELS: Record<DgdLine['type'], string> = {
  marche: 'Marché',
  avenant: 'Avenant',
  situation: 'Situation',
  solde: 'Solde',
  liberation_rg: 'Libération RG',
  total: 'TOTAL',
}

export async function renderDgdPdf(data: DgdPdfData, origin: string): Promise<Buffer> {
  const fontBytes = await loadFontBytes(origin)
  return renderDgdPdfWithFonts(data, fontBytes)
}

export async function renderDgdPdfWithFonts(data: DgdPdfData, fontBytes: FontBytes): Promise<Buffer> {
  const {
    chantierTitle, chantierAddress, clientName, marketReference, lines,
    totalMarcheHt, totalSituationsHt, totalRetentionHt, totalNetHt,
    receptionDate, receptionStatus, organization,
  } = data
  const doc = await PdfDoc.create(fontBytes)
  const F = doc.fonts

  const orgPostalCity = [organization.postal_code, organization.city].filter(Boolean).join(' ')

  const line2Parts: string[] = []
  if (organization.siret) line2Parts.push(`SIRET : ${organization.siret}`)
  if (organization.rcs && organization.rcs_ville) line2Parts.push(`RCS ${organization.rcs_ville} ${organization.rcs}`)
  else if (organization.rcs) line2Parts.push(`RCS ${organization.rcs}`)
  const isVatSubject = organization.is_vat_subject !== false
  if (!isVatSubject) line2Parts.push('TVA non applicable, art. 293B du CGI')
  else if (organization.vat_number) line2Parts.push(`TVA : ${organization.vat_number}`)

  const legalLines: string[] = [
    [organization.forme_juridique, fmtCapitalSocial(organization.capital_social) ? `Capital social : ${fmtCapitalSocial(organization.capital_social)}` : null].filter(Boolean).join(' · '),
    line2Parts.join(' · '),
    organization.insurance_info ? `Assurance RC${organization.decennale_enabled ? ' et décennale' : ''} : ${organization.insurance_info}` : null,
  ].filter((l): l is string => !!l && l.length > 0)

  const logoImg = organization.logo_url ? await embedImage(doc.doc, organization.logo_url) : null

  doc.onNewPage = ({ page }) => {
    let y = PAGE.height - PAGE.headerTop
    const headerTop = y

    if (logoImg) {
      drawImageContained(doc, logoImg, { x: PAGE.margin, y: headerTop - 45, w: 90, h: 45 })
    } else {
      page.drawRectangle({ x: PAGE.margin, y: headerTop - 45, width: 90, height: 45, color: COLOR.black })
      page.drawText(pdfText(organization.name.slice(0, 2).toUpperCase()), { x: PAGE.margin + 30, y: headerTop - 28, size: SIZE.lg, font: F.headingXBold, color: COLOR.white })
    }

    const rightX = PAGE.width - PAGE.margin - 210
    let ry = headerTop
    const drawRight = (text: string, style: TextStyle) => {
      const w = style.font.widthOfTextAtSize(text, style.size)
      ry -= style.size
      page.drawText(text, { x: rightX + 210 - w, y: ry, size: style.size, font: style.font, color: style.color })
      ry -= textLineHeight(style) - style.size
    }
    drawRight(pdfText(organization.name).toUpperCase(), { font: F.headingXBold, size: SIZE.md, color: COLOR.black })
    ry -= 4
    if (organization.address_line1) drawRight(pdfText(organization.address_line1), { font: F.regular, size: SIZE.xs, color: COLOR.secondary })
    if (orgPostalCity) drawRight(pdfText(orgPostalCity), { font: F.regular, size: SIZE.xs, color: COLOR.secondary })
    if (organization.phone) drawRight(pdfText(organization.phone), { font: F.regular, size: SIZE.xs, color: COLOR.secondary })

    y = Math.min(headerTop - 45, ry) - SPACE.md
    page.drawLine({ start: { x: PAGE.margin, y }, end: { x: PAGE.width - PAGE.margin, y }, thickness: 1, color: COLOR.divider })
    y -= SPACE.md
    return y
  }

  doc.addPage()

  doc.onFinishPage = ({ page }) => {
    const footerY = 14
    let ly = footerY + legalLines.length * (SIZE.xxs * 1.4)
    for (const line of legalLines) {
      page.drawText(line, { x: PAGE.margin, y: ly, size: SIZE.xxs, font: F.regular, color: COLOR.muted })
      ly -= SIZE.xxs * 1.4
    }
  }

  // ── Titre ──
  doc.ensureSpace(SIZE.lg + SIZE.sm + SPACE.lg)
  doc.y -= 16
  doc.page.drawText('DECOMPTE GENERAL DEFINITIF', { x: PAGE.margin, y: doc.y, size: 16, font: F.heading, color: COLOR.black })
  doc.y -= SPACE.xs
  doc.y -= SIZE.sm
  doc.page.drawText('NF P 03-001 / Marche prive de travaux', { x: PAGE.margin, y: doc.y, size: SIZE.sm, font: F.regular, color: COLOR.muted })
  doc.moveDown(SPACE.lg)

  // ── Infos chantier / client ──
  const twoBoxW = clientName ? (CONTENT_WIDTH - SPACE.lg) / 2 : CONTENT_WIDTH
  function measureChantierBox(): number {
    let n = 1
    if (chantierAddress) n++
    if (marketReference) n++
    if (receptionDate) n++
    return SPACE.md * 2 + SIZE.xs + 2 + SIZE.md + n * (SIZE.sm + 2) - (SIZE.sm + 2)
  }
  const chantierBoxH = measureChantierBox()
  const clientBoxH = SPACE.md * 2 + SIZE.xs + 2 + SIZE.md
  const rowH = Math.max(chantierBoxH, clientBoxH)
  doc.ensureSpace(rowH)
  const rowY = doc.y

  doc.page.drawRectangle({ x: PAGE.margin, y: rowY - rowH, width: twoBoxW, height: rowH, color: COLOR.surface })
  let cy = rowY - SPACE.md - SIZE.xs
  doc.page.drawText('CHANTIER', { x: PAGE.margin + SPACE.md, y: cy, size: SIZE.xs, font: F.headingXBold, color: COLOR.muted })
  cy -= 2 + SIZE.md
  doc.page.drawText(pdfText(chantierTitle), { x: PAGE.margin + SPACE.md, y: cy, size: SIZE.md, font: F.heading, color: COLOR.black })
  if (chantierAddress) { cy -= SIZE.sm + 2; doc.page.drawText(pdfText(chantierAddress), { x: PAGE.margin + SPACE.md, y: cy, size: SIZE.sm, font: F.regular, color: COLOR.body }) }
  if (marketReference) { cy -= SIZE.sm + 2; doc.page.drawText(pdfText(`Ref. marche : ${marketReference}`), { x: PAGE.margin + SPACE.md, y: cy, size: SIZE.sm, font: F.regular, color: COLOR.muted }) }
  if (receptionDate) {
    cy -= SIZE.sm + 2
    const statusLabel = receptionStatus === 'sans_reserve' ? 'sans reserve' : receptionStatus === 'reserve_levee' ? 'reserves levees' : 'avec reserves'
    doc.page.drawText(pdfText(`Reception : ${fmtDate(receptionDate)} — ${statusLabel}`), { x: PAGE.margin + SPACE.md, y: cy, size: SIZE.sm, font: F.regular, color: COLOR.muted })
  }

  if (clientName) {
    const cx = PAGE.margin + twoBoxW + SPACE.lg
    doc.page.drawRectangle({ x: cx, y: rowY - rowH, width: twoBoxW, height: rowH, color: COLOR.surface })
    let cy2 = rowY - SPACE.md - SIZE.xs
    doc.page.drawText("MAITRE D'OUVRAGE", { x: cx + SPACE.md, y: cy2, size: SIZE.xs, font: F.headingXBold, color: COLOR.muted })
    cy2 -= 2 + SIZE.md
    doc.page.drawText(pdfText(clientName), { x: cx + SPACE.md, y: cy2, size: SIZE.md, font: F.heading, color: COLOR.black })
  }

  doc.y = rowY - rowH
  doc.moveDown(SPACE.xl)

  // ── Tableau des lignes ──
  const colDesignW = CONTENT_WIDTH - 60 - 80 - 60 - 85
  doc.ensureSpace(2)
  doc.page.drawLine({ start: { x: PAGE.margin, y: doc.y }, end: { x: PAGE.width - PAGE.margin, y: doc.y }, thickness: 1, color: COLOR.divider })
  doc.moveDown(SPACE.xs)

  doc.ensureSpace(SIZE.xs + SPACE.xs)
  const headerY = doc.y
  const headerStyle: TextStyle = { font: F.headingXBold, size: SIZE.xs, color: COLOR.muted }
  doc.page.drawText('DESIGNATION', { x: PAGE.margin + SPACE.sm, y: headerY - SIZE.xs, size: SIZE.xs, font: headerStyle.font, color: headerStyle.color })
  drawRightHeader(doc, 'AVCT %', PAGE.margin + SPACE.sm + colDesignW, 60, headerStyle)
  drawRightHeader(doc, 'MONTANT HT', PAGE.margin + SPACE.sm + colDesignW + 60, 80, headerStyle)
  drawRightHeader(doc, 'RG', PAGE.margin + SPACE.sm + colDesignW + 60 + 80, 60, headerStyle)
  drawRightHeader(doc, 'NET HT', PAGE.margin + SPACE.sm + colDesignW + 60 + 80 + 60, 85, headerStyle)
  doc.y -= SIZE.xs + SPACE.xs
  doc.page.drawLine({ start: { x: PAGE.margin, y: doc.y }, end: { x: PAGE.width - PAGE.margin, y: doc.y }, thickness: 0.5, color: COLOR.divider })

  for (const line of lines) {
    const isTotal = line.type === 'total'
    const labelText = pdfText(`[${TYPE_LABELS[line.type]}] ${line.label}`)
    const labelStyle: TextStyle = { font: isTotal ? F.heading : F.regular, size: SIZE.sm, color: TYPE_COLORS[line.type], maxWidth: colDesignW }
    const labelLines = wrapText(labelText, labelStyle.font, labelStyle.size, colDesignW)
    let extraLines = 0
    if (line.reference) extraLines++
    if (line.date) extraLines++
    const rowH2 = SPACE.xs * 2 + labelLines.length * textLineHeight(labelStyle) + extraLines * (SIZE.xs + 1)

    doc.ensureSpace(rowH2)
    const rowTop = doc.y
    if (isTotal) {
      doc.page.drawRectangle({ x: PAGE.margin, y: rowTop - rowH2, width: CONTENT_WIDTH, height: rowH2, color: COLOR.surface })
    }

    let cy2 = rowTop - SPACE.xs
    for (const l of labelLines) {
      cy2 -= labelStyle.size
      doc.page.drawText(l, { x: PAGE.margin + SPACE.sm, y: cy2, size: labelStyle.size, font: labelStyle.font, color: labelStyle.color })
      cy2 -= textLineHeight(labelStyle) - labelStyle.size
    }
    if (line.reference) { cy2 -= SIZE.xs; doc.page.drawText(pdfText(line.reference), { x: PAGE.margin + SPACE.sm, y: cy2, size: SIZE.xs, font: F.regular, color: COLOR.muted }); cy2 -= 1 }
    if (line.date) { cy2 -= SIZE.xs; doc.page.drawText(pdfText(fmtDate(line.date)), { x: PAGE.margin + SPACE.sm, y: cy2, size: SIZE.xs, font: F.regular, color: COLOR.muted }); cy2 -= 1 }

    const firstLineY = rowTop - SPACE.xs - labelStyle.size
    drawRightCell(doc, line.cumulative_pct != null ? `${line.cumulative_pct}%` : '', PAGE.margin + SPACE.sm + colDesignW, 60, firstLineY, { font: F.regular, size: SIZE.sm, color: COLOR.body })
    drawRightCell(doc, fmt(line.amount_ht), PAGE.margin + SPACE.sm + colDesignW + 60, 80, firstLineY, { font: isTotal ? F.heading : F.regular, size: SIZE.sm, color: TYPE_COLORS[line.type] })
    drawRightCell(doc, line.retention_amount ? `-${fmt(line.retention_amount)}` : '', PAGE.margin + SPACE.sm + colDesignW + 60 + 80, 60, firstLineY, { font: F.regular, size: SIZE.sm, color: rgb(0xea / 255, 0x58 / 255, 0x0c / 255) })
    drawRightCell(doc, fmt(line.net_ht ?? line.amount_ht), PAGE.margin + SPACE.sm + colDesignW + 60 + 80 + 60, 85, firstLineY, { font: isTotal ? F.heading : F.regular, size: SIZE.sm, color: isTotal ? COLOR.black : COLOR.body })

    doc.y = rowTop - rowH2
    doc.page.drawLine({ start: { x: PAGE.margin, y: doc.y }, end: { x: PAGE.width - PAGE.margin, y: doc.y }, thickness: 0.5, color: COLOR.divider })
  }

  // ── Récapitulatif ──
  doc.moveDown(SPACE.xl)
  const recapW = 280
  const recapX = PAGE.width - PAGE.margin - recapW
  doc.ensureSpace(SIZE.md + SPACE.xs * 3 + SIZE.sm * 2 + 8)

  function drawRecapRow(label: string, value: string, style: TextStyle): void {
    doc.y -= style.size
    const w = style.font.widthOfTextAtSize(value, style.size)
    doc.page.drawText(label, { x: recapX, y: doc.y, size: style.size, font: style.font, color: style.color })
    doc.page.drawText(value, { x: recapX + recapW - w, y: doc.y, size: style.size, font: style.font, color: style.color })
    doc.y -= 4
  }

  drawRecapRow('Marche initial + avenants HT', fmt(totalMarcheHt), { font: F.regular, size: SIZE.sm, color: COLOR.muted })
  drawRecapRow('Total facture HT', fmt(totalSituationsHt), { font: F.regular, size: SIZE.sm, color: COLOR.body })
  if (totalRetentionHt > 0) {
    drawRecapRow('Retenues de garantie prelevees', `-${fmt(totalRetentionHt)}`, { font: F.regular, size: SIZE.sm, color: rgb(0xea / 255, 0x58 / 255, 0x0c / 255) })
  }
  doc.page.drawLine({ start: { x: recapX, y: doc.y }, end: { x: recapX + recapW, y: doc.y }, thickness: 1, color: COLOR.black })
  doc.y -= 4
  drawRecapRow('SOLDE NET HT', fmt(totalNetHt), { font: F.heading, size: SIZE.md, color: COLOR.black })

  // ── Signatures ──
  doc.moveDown(SPACE.xl * 2)
  const sigColW = (CONTENT_WIDTH - SPACE.xl) / 2
  doc.ensureSpace(SIZE.sm + SPACE.xs + SIZE.xs * 2 + SPACE.xl + SPACE.xs)
  const sigTopY = doc.y
  doc.page.drawLine({ start: { x: PAGE.margin, y: sigTopY }, end: { x: PAGE.margin + sigColW, y: sigTopY }, thickness: 1, color: COLOR.divider })
  doc.page.drawLine({ start: { x: PAGE.margin + sigColW + SPACE.xl, y: sigTopY }, end: { x: PAGE.margin + sigColW + SPACE.xl + sigColW, y: sigTopY }, thickness: 1, color: COLOR.divider })

  const parties = [
    { label: `L'Entrepreneur — ${organization.name}`, sub: organization.signatory_name ?? '' },
    { label: "Le Maitre d'ouvrage", sub: clientName ?? '' },
  ]
  parties.forEach((party, i) => {
    const x = PAGE.margin + i * (sigColW + SPACE.xl)
    let cy2 = sigTopY - SPACE.sm - SIZE.sm
    doc.page.drawText(pdfText(party.label), { x, y: cy2, size: SIZE.sm, font: F.heading, color: COLOR.black })
    if (party.sub) { cy2 -= SPACE.xs + SIZE.xs; doc.page.drawText(pdfText(party.sub), { x, y: cy2, size: SIZE.xs, font: F.regular, color: COLOR.muted }) }
    cy2 -= SPACE.lg
    doc.page.drawText('Date :', { x, y: cy2, size: SIZE.xs, font: F.regular, color: COLOR.muted })
    cy2 -= SPACE.xl
    doc.page.drawLine({ start: { x, y: cy2 }, end: { x: x + sigColW, y: cy2 }, thickness: 0.5, color: COLOR.divider })
    cy2 -= SPACE.xs
    doc.page.drawText('Signature :', { x, y: cy2, size: SIZE.xs, font: F.regular, color: COLOR.muted })
  })

  return doc.save()
}

function drawRightHeader(doc: PdfDoc, label: string, x: number, w: number, style: TextStyle): void {
  const lw = style.font.widthOfTextAtSize(label, style.size)
  doc.page.drawText(label, { x: x + w - lw, y: doc.y - style.size, size: style.size, font: style.font, color: style.color })
}

function drawRightCell(doc: PdfDoc, text: string, x: number, w: number, y: number, style: TextStyle): void {
  if (!text) return
  const tw = style.font.widthOfTextAtSize(text, style.size)
  doc.page.drawText(text, { x: x + w - tw, y, size: style.size, font: style.font, color: style.color })
}
