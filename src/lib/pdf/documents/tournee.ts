import { pdfText } from '@/lib/pdf/pdf-design-system'
import type { TourneeSlot } from '@/lib/data/queries/chantiers'
import { PdfDoc } from '../engine/doc'
import type { FontBytes } from '../engine/fonts'
import { loadFontBytes } from '../engine/fonts'
import { drawImageContained, embedImage } from '../engine/image'
import { textLineHeight, wrapText, type TextStyle } from '../engine/text'
import { COLOR, CONTENT_WIDTH, PAGE, SIZE, SPACE } from '../engine/theme'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtMin = (min: number): string => {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m} min`
  if (m === 0) return `${h} h`
  return `${h} h ${String(m).padStart(2, '0')}`
}

const fmtDate = (iso: string): string => {
  const d = new Date(`${iso}T12:00:00`)
  return pdfText(d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))
}

const fmtTime = (time: string | null): string => {
  if (!time) return '-'
  const [h, m] = time.slice(0, 5).split(':')
  return `${h} h ${m}`
}

function addressForSlot(slot: TourneeSlot): string {
  return pdfText([slot.chantier_address_line1, slot.chantier_postal_code, slot.chantier_city].filter(Boolean).join(', '))
}

export type TourneePdfData = {
  organization: {
    name: string
    email?: string | null
    phone?: string | null
    siret?: string | null
    logo_url?: string | null
    address_line1?: string | null
    postal_code?: string | null
    city?: string | null
  }
  slots: TourneeSlot[]
  date: string
  routeLabel: string
  totalSiteMin: number
  totalTravelMin: number
  departureAddress?: string | null
  departurePostalCode?: string | null
  departureCity?: string | null
}

export async function renderTourneePdf(data: TourneePdfData, origin: string): Promise<Buffer> {
  const fontBytes = await loadFontBytes(origin)
  return renderTourneePdfWithFonts(data, fontBytes)
}

export async function renderTourneePdfWithFonts(data: TourneePdfData, fontBytes: FontBytes): Promise<Buffer> {
  const { organization, slots, date, routeLabel, totalSiteMin, totalTravelMin, departureAddress, departurePostalCode, departureCity } = data
  const doc = await PdfDoc.create(fontBytes)
  const F = doc.fonts

  const orgAddress = [organization.address_line1, organization.postal_code, organization.city].filter(Boolean).join(', ')
  const departureLabel = [departureAddress, departurePostalCode, departureCity].filter(Boolean).join(', ')
  const generatedAt = pdfText(new Date().toLocaleDateString('fr-FR'))
  const slotsWithNotes = slots.filter(s => s.notes)
  const firstStart = slots[0]?.start_time ?? null
  const lastEnd = [...slots].reverse().find(s => s.end_time)?.end_time ?? null

  const logoImg = organization.logo_url ? await embedImage(doc.doc, organization.logo_url) : null

  doc.onNewPage = ({ page }) => {
    let y = PAGE.height - PAGE.headerTop
    const headerTop = y

    if (logoImg) {
      drawImageContained(doc, logoImg, { x: PAGE.margin, y: headerTop - 42, w: 88, h: 42 })
    } else {
      page.drawRectangle({ x: PAGE.margin, y: headerTop - 42, width: 88, height: 42, color: COLOR.black })
      page.drawText(pdfText(organization.name.slice(0, 2).toUpperCase()), { x: PAGE.margin + 28, y: headerTop - 26, size: SIZE.lg, font: F.headingXBold, color: COLOR.white })
    }

    const rightX = PAGE.width - PAGE.margin - 235
    let ry = headerTop
    const drawRight = (text: string, style: TextStyle) => {
      const w = style.font.widthOfTextAtSize(text, style.size)
      ry -= style.size
      page.drawText(text, { x: rightX + 235 - w, y: ry, size: style.size, font: style.font, color: style.color })
      ry -= textLineHeight(style) - style.size
    }
    drawRight(pdfText(organization.name).toUpperCase(), { font: F.headingXBold, size: SIZE.md, color: COLOR.black })
    ry -= 2
    if (orgAddress) drawRight(pdfText(orgAddress), { font: F.regular, size: SIZE.xs, color: COLOR.secondary })
    if (organization.phone) drawRight(`Tél. : ${pdfText(organization.phone)}`, { font: F.regular, size: SIZE.xs, color: COLOR.secondary })
    if (organization.email) drawRight(pdfText(organization.email), { font: F.regular, size: SIZE.xs, color: COLOR.secondary })
    if (organization.siret) drawRight(`SIRET : ${pdfText(organization.siret)}`, { font: F.regular, size: SIZE.xs, color: COLOR.secondary })

    y = Math.min(headerTop - 42, ry) - SPACE.lg
    page.drawLine({ start: { x: PAGE.margin, y }, end: { x: PAGE.width - PAGE.margin, y }, thickness: 1, color: COLOR.divider })
    y -= SPACE.md
    return y
  }

  doc.addPage()

  doc.onFinishPage = ({ page, pageIndex, pageCount }) => {
    const footerY = 16
    page.drawLine({ start: { x: PAGE.margin, y: footerY + 10 }, end: { x: PAGE.width - PAGE.margin, y: footerY + 10 }, thickness: 0.5, color: COLOR.divider })
    const label = `Généré le ${generatedAt}${lastEnd ? ` - Fin prévisionnelle : ${fmtTime(lastEnd)}` : ''}`
    page.drawText(label, { x: PAGE.margin, y: footerY, size: SIZE.xxs, font: F.regular, color: COLOR.muted })
    const pageLabel = `Page ${pageIndex + 1}/${pageCount}`
    const w = F.regular.widthOfTextAtSize(pageLabel, SIZE.xxs)
    page.drawText(pageLabel, { x: PAGE.width - PAGE.margin - w, y: footerY, size: SIZE.xxs, font: F.regular, color: COLOR.muted })
  }

  // ── Titre ──
  doc.ensureSpace(23 + 20)
  doc.y -= 23
  doc.page.drawText('FEUILLE DE ROUTE', { x: PAGE.margin, y: doc.y, size: 23, font: F.headingXBold, color: COLOR.black })
  doc.y -= 6
  doc.y -= SIZE.xs
  doc.page.drawText(`Date : ${fmtDate(date)}`, { x: PAGE.margin, y: doc.y, size: SIZE.xs, font: F.regular, color: COLOR.secondary })
  doc.page.drawText(`Tournée : ${pdfText(routeLabel)}`, { x: PAGE.margin + 200, y: doc.y, size: SIZE.xs, font: F.regular, color: COLOR.secondary })
  doc.y -= SPACE.sm + 1
  doc.page.drawRectangle({ x: PAGE.margin, y: doc.y, width: 42, height: 3, color: COLOR.accent })
  doc.y -= SPACE.sm + 3
  doc.page.drawLine({ start: { x: PAGE.margin, y: doc.y }, end: { x: PAGE.width - PAGE.margin, y: doc.y }, thickness: 1, color: COLOR.black })
  doc.y -= SPACE.md

  // ── Point de départ ──
  if (departureLabel) {
    const boxH = SPACE.sm * 2 + SIZE.xxs + 2 + SIZE.sm
    doc.ensureSpace(boxH)
    doc.page.drawRectangle({ x: PAGE.margin, y: doc.y - boxH, width: CONTENT_WIDTH, height: boxH, color: COLOR.surface })
    doc.page.drawRectangle({ x: PAGE.margin, y: doc.y - boxH, width: 2, height: boxH, color: COLOR.accent })
    let cy = doc.y - SPACE.sm - SIZE.xxs
    doc.page.drawText('POINT DE DEPART', { x: PAGE.margin + SPACE.sm, y: cy, size: SIZE.xxs, font: F.headingXBold, color: COLOR.secondary })
    cy -= 2 + SIZE.sm
    doc.page.drawText(pdfText(departureLabel), { x: PAGE.margin + SPACE.sm, y: cy, size: SIZE.sm, font: F.regular, color: COLOR.body })
    doc.y -= boxH
    doc.moveDown(SPACE.md)
  }

  // ── Bande résumé (4 KPI) ──
  const kpis = [
    { value: String(slots.length), label: 'Sites à visiter' },
    { value: totalSiteMin > 0 ? fmtMin(totalSiteMin) : '-', label: 'Temps sur site' },
    { value: totalTravelMin > 0 ? `~${fmtMin(totalTravelMin)}` : '-', label: 'Trajet estimé' },
    { value: firstStart ? fmtTime(firstStart) : '-', label: 'Premier passage' },
  ]
  const kpiGap = 10
  const kpiW = (CONTENT_WIDTH - kpiGap * 3) / 4
  const kpiH = 44
  doc.ensureSpace(kpiH)
  const kpiY = doc.y
  kpis.forEach((kpi, i) => {
    const x = PAGE.margin + i * (kpiW + kpiGap)
    doc.page.drawRectangle({ x, y: kpiY - kpiH, width: kpiW, height: kpiH, color: COLOR.surface })
    doc.page.drawRectangle({ x, y: kpiY - kpiH, width: 2, height: kpiH, color: COLOR.accent })
    let cy = kpiY - 10 - SIZE.xl
    doc.page.drawText(kpi.value, { x: x + 10, y: cy, size: SIZE.xl, font: F.headingXBold, color: COLOR.black })
    cy -= 2 + SIZE.xxs
    doc.page.drawText(kpi.label.toUpperCase(), { x: x + 10, y: cy, size: SIZE.xxs, font: F.regular, color: COLOR.secondary })
  })
  doc.y = kpiY - kpiH
  doc.moveDown(SPACE.md)

  // ── Consignes ──
  const infoText = "Les temps de trajet indiqués sont des estimations basées sur la proximité géographique des codes postaux. En cas d'imprévu terrain, l'ordre de passage peut être adapté par l'intervenant. Les heures réellement effectuées doivent être pointées depuis l'espace personnel ou depuis la fiche chantier."
  const infoStyle: TextStyle = { font: F.regular, size: SIZE.sm, color: COLOR.body, maxWidth: CONTENT_WIDTH - SPACE.md * 2, lineHeight: 1.45 }
  const infoLines = wrapText(infoText, infoStyle.font, infoStyle.size, infoStyle.maxWidth!)
  const infoBoxH = SPACE.sm * 2 + SIZE.xxs + 3 + infoLines.length * textLineHeight(infoStyle)
  doc.ensureSpace(infoBoxH)
  doc.page.drawRectangle({ x: PAGE.margin, y: doc.y - infoBoxH, width: CONTENT_WIDTH, height: infoBoxH, color: COLOR.surface })
  doc.page.drawRectangle({ x: PAGE.margin, y: doc.y - infoBoxH, width: CONTENT_WIDTH, height: infoBoxH, borderColor: COLOR.divider, borderWidth: 0.5 })
  let icy = doc.y - SPACE.sm - SIZE.xxs
  doc.page.drawText("CONSIGNES D'UTILISATION", { x: PAGE.margin + SPACE.md, y: icy, size: SIZE.xxs, font: F.headingXBold, color: COLOR.secondary })
  icy -= 3 + infoStyle.size
  for (const line of infoLines) {
    doc.page.drawText(line, { x: PAGE.margin + SPACE.md, y: icy, size: infoStyle.size, font: infoStyle.font, color: infoStyle.color })
    icy -= textLineHeight(infoStyle)
  }
  doc.y -= infoBoxH
  doc.moveDown(SPACE.md)

  // ── Tableau des étapes ──
  const colNum = 24, colTime = 58, colDuration = 50, colTravel = 48
  const remaining = CONTENT_WIDTH - colNum - colTime - colDuration - colTravel
  const colSite = remaining * (2.1 / 4.5)
  const colAddress = remaining - colSite

  doc.ensureSpace(SIZE.xxs + SPACE.sm)
  const thY = doc.y
  const thStyle: TextStyle = { font: F.headingXBold, size: SIZE.xxs, color: COLOR.black }
  let tx = PAGE.margin
  doc.page.drawText('#', { x: tx, y: thY - SIZE.xxs, size: SIZE.xxs, font: thStyle.font, color: thStyle.color }); tx += colNum
  doc.page.drawText('SITE', { x: tx, y: thY - SIZE.xxs, size: SIZE.xxs, font: thStyle.font, color: thStyle.color }); tx += colSite
  doc.page.drawText('ADRESSE', { x: tx, y: thY - SIZE.xxs, size: SIZE.xxs, font: thStyle.font, color: thStyle.color }); tx += colAddress
  doc.page.drawText('HORAIRE', { x: tx, y: thY - SIZE.xxs, size: SIZE.xxs, font: thStyle.font, color: thStyle.color }); tx += colTime
  doc.page.drawText('DUREE', { x: tx, y: thY - SIZE.xxs, size: SIZE.xxs, font: thStyle.font, color: thStyle.color }); tx += colDuration
  doc.page.drawText('TRAJET', { x: tx, y: thY - SIZE.xxs, size: SIZE.xxs, font: thStyle.font, color: thStyle.color })
  doc.y -= SIZE.xxs + SPACE.sm - 2
  doc.page.drawLine({ start: { x: PAGE.margin, y: doc.y }, end: { x: PAGE.width - PAGE.margin, y: doc.y }, thickness: 1, color: COLOR.black })

  slots.forEach((slot, index) => {
    const siteStyle: TextStyle = { font: F.heading, size: SIZE.sm, color: COLOR.black, maxWidth: colSite - 8, lineHeight: 1.35 }
    const siteLines = wrapText(pdfText(slot.chantier_title), siteStyle.font, siteStyle.size, siteStyle.maxWidth!)
    const labelStyle: TextStyle = { font: F.regular, size: SIZE.xs, color: COLOR.secondary, maxWidth: colSite - 8, lineHeight: 1.35 }
    const labelLines = slot.label ? wrapText(pdfText(slot.label), labelStyle.font, labelStyle.size, labelStyle.maxWidth!) : []
    const addrStyle: TextStyle = { font: F.regular, size: SIZE.sm, color: COLOR.body, maxWidth: colAddress - 8, lineHeight: 1.35 }
    const addrLines = wrapText(addressForSlot(slot) || '-', addrStyle.font, addrStyle.size, addrStyle.maxWidth!)

    const contentLineCount = Math.max(siteLines.length + labelLines.length, addrLines.length, 2)
    const rowH = SPACE.sm * 2 + contentLineCount * (SIZE.sm * 1.35)

    doc.ensureSpace(rowH)
    const rowTop = doc.y
    if (index % 2 === 1) {
      doc.page.drawRectangle({ x: PAGE.margin, y: rowTop - rowH, width: CONTENT_WIDTH, height: rowH, color: COLOR.surface })
    }

    let x = PAGE.margin
    // Badge numéro
    const badgeR = 8.5
    const badgeCy = rowTop - SPACE.sm - badgeR
    doc.page.drawEllipse({ x: x + badgeR, y: badgeCy, xScale: badgeR, yScale: badgeR, color: COLOR.black })
    const numLabel = String(index + 1)
    const nw = F.headingXBold.widthOfTextAtSize(numLabel, SIZE.xxs)
    doc.page.drawText(numLabel, { x: x + badgeR - nw / 2, y: badgeCy - SIZE.xxs / 2 + 1, size: SIZE.xxs, font: F.headingXBold, color: COLOR.white })
    x += colNum

    let cy = rowTop - SPACE.sm - siteStyle.size
    for (const l of siteLines) {
      doc.page.drawText(l, { x, y: cy, size: siteStyle.size, font: siteStyle.font, color: siteStyle.color })
      cy -= textLineHeight(siteStyle)
    }
    for (const l of labelLines) {
      doc.page.drawText(l, { x, y: cy, size: labelStyle.size, font: labelStyle.font, color: labelStyle.color })
      cy -= textLineHeight(labelStyle)
    }
    x += colSite

    let acy = rowTop - SPACE.sm - addrStyle.size
    for (const l of addrLines) {
      doc.page.drawText(l, { x, y: acy, size: addrStyle.size, font: addrStyle.font, color: addrStyle.color })
      acy -= textLineHeight(addrStyle)
    }
    x += colAddress

    let tcy = rowTop - SPACE.sm - SIZE.sm
    doc.page.drawText(fmtTime(slot.start_time), { x, y: tcy, size: SIZE.sm, font: F.regular, color: COLOR.body })
    if (slot.end_time) {
      tcy -= textLineHeight({ font: F.regular, size: SIZE.sm, color: COLOR.body })
      doc.page.drawText(`fin ${fmtTime(slot.end_time)}`, { x, y: tcy, size: SIZE.xs, font: F.regular, color: COLOR.secondary })
    }
    x += colTime

    doc.page.drawText(slot.duration_min ? fmtMin(slot.duration_min) : '-', { x, y: rowTop - SPACE.sm - SIZE.sm, size: SIZE.sm, font: F.regular, color: COLOR.body })
    x += colDuration

    doc.page.drawText(slot.travel_from_prev_min != null ? `~${fmtMin(slot.travel_from_prev_min)}` : '-', { x, y: rowTop - SPACE.sm - SIZE.sm, size: SIZE.sm, font: F.regular, color: COLOR.body })

    doc.y = rowTop - rowH
    doc.page.drawLine({ start: { x: PAGE.margin, y: doc.y }, end: { x: PAGE.width - PAGE.margin, y: doc.y }, thickness: 0.5, color: COLOR.divider })
  })

  // ── Notes terrain ──
  if (slotsWithNotes.length > 0) {
    doc.moveDown(SPACE.lg)
    doc.ensureSpace(SIZE.xxs + SPACE.sm)
    doc.y -= SIZE.xxs
    doc.page.drawText('NOTES TERRAIN', { x: PAGE.margin, y: doc.y, size: SIZE.xxs, font: F.headingXBold, color: COLOR.secondary })
    doc.moveDown(SPACE.sm)

    slotsWithNotes.forEach((slot, index) => {
      const titleText = `Passage ${slot.route_order ?? index + 1} - ${pdfText(slot.chantier_title)}`
      const noteStyle: TextStyle = { font: F.regular, size: SIZE.sm, color: COLOR.body, maxWidth: CONTENT_WIDTH - SPACE.sm * 2, lineHeight: 1.35 }
      const noteLines = wrapText(pdfText(slot.notes), noteStyle.font, noteStyle.size, noteStyle.maxWidth!)
      const boxH = SPACE.sm * 2 + SIZE.sm + 2 + noteLines.length * textLineHeight(noteStyle)
      doc.ensureSpace(boxH + 6)
      doc.page.drawRectangle({ x: PAGE.margin, y: doc.y - boxH, width: CONTENT_WIDTH, height: boxH, color: COLOR.surface })
      doc.page.drawRectangle({ x: PAGE.margin, y: doc.y - boxH, width: 2, height: boxH, color: COLOR.accent })
      let ncy = doc.y - SPACE.sm - SIZE.sm
      doc.page.drawText(titleText, { x: PAGE.margin + SPACE.sm, y: ncy, size: SIZE.sm, font: F.heading, color: COLOR.black })
      ncy -= 2
      for (const l of noteLines) {
        ncy -= noteStyle.size
        doc.page.drawText(l, { x: PAGE.margin + SPACE.sm, y: ncy, size: noteStyle.size, font: noteStyle.font, color: noteStyle.color })
        ncy -= textLineHeight(noteStyle) - noteStyle.size
      }
      doc.y -= boxH
      doc.moveDown(6)
    })
  }

  return doc.save()
}
