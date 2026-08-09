import { fmtCurrency, pdfText } from '@/lib/pdf/pdf-design-system'
import type { IndividualMember, MemberPointage } from '@/lib/data/queries/members'
import { PdfDoc } from '../engine/doc'
import type { FontBytes } from '../engine/fonts'
import { loadFontBytes } from '../engine/fonts'
import { drawKeyValueRow, textLineHeight, type TextStyle } from '../engine/text'
import { drawTable, type TableColumn, type TableRow } from '../engine/table'
import { COLOR, CONTENT_WIDTH, PAGE, SIZE, SPACE } from '../engine/theme'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '-'
  const part = iso.includes('T') ? iso.split('T')[0] : iso
  const [y, m, d] = part.split('-')
  return `${(d ?? '').padStart(2, '0')}/${(m ?? '').padStart(2, '0')}/${y ?? ''}`
}

const fmtHours = (hours: number): string => {
  const h = Math.floor(hours)
  const min = Math.round((hours - h) * 60)
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

export type MemberHoursReportPdfData = {
  member: IndividualMember
  organization: {
    name: string
    logo_url?: string | null
    address_line1?: string | null
    postal_code?: string | null
    city?: string | null
  }
  pointages: MemberPointage[]
  periodFrom: string
  periodTo: string
  totalHours: number
  isAppMember?: boolean
}

export async function renderMemberHoursReportPdf(data: MemberHoursReportPdfData, origin: string): Promise<Buffer> {
  const fontBytes = await loadFontBytes(origin)
  return renderMemberHoursReportPdfWithFonts(data, fontBytes)
}

export async function renderMemberHoursReportPdfWithFonts(data: MemberHoursReportPdfData, fontBytes: FontBytes): Promise<Buffer> {
  const { member, organization, pointages, periodFrom, periodTo, totalHours, isAppMember = false } = data
  const doc = await PdfDoc.create(fontBytes)
  const F = doc.fonts

  const memberFullName = [member.prenom, member.name].filter(Boolean).join(' ')

  const isAnnual = periodFrom.endsWith('-01-01') && periodTo.endsWith('-12-31') && periodFrom.slice(0, 4) === periodTo.slice(0, 4)
  const annualYear = isAnnual ? periodFrom.slice(0, 4) : null

  const fallbackRate = member.taux_horaire ?? null
  type RateSlice = { rate: number | null; hours: number; cost: number }
  const rateMap = new Map<string, RateSlice>()
  for (const p of pointages) {
    const effectiveRate = p.rate_snapshot ?? fallbackRate
    const key = effectiveRate != null ? String(effectiveRate) : '__none__'
    const existing = rateMap.get(key)
    const cost = effectiveRate != null ? p.hours * effectiveRate : 0
    if (existing) {
      existing.hours += p.hours
      existing.cost += cost
    } else {
      rateMap.set(key, { rate: effectiveRate, hours: p.hours, cost })
    }
  }
  const rateSlices: RateSlice[] = Array.from(rateMap.values()).sort((a, b) => (a.rate ?? -1) - (b.rate ?? -1))
  const totalCost = rateSlices.reduce((s, r) => s + r.cost, 0)
  const hasRateData = rateSlices.some(r => r.rate != null)

  type ChantierRow = { chantier_id: string; chantier_title: string; hours: number; rate: number | null }
  const chantierMap = new Map<string, ChantierRow>()
  const chantierRateCount = new Map<string, Map<string, number>>()
  for (const p of pointages) {
    const effectiveRateC = p.rate_snapshot ?? fallbackRate
    const existing = chantierMap.get(p.chantier_id)
    if (existing) {
      existing.hours += p.hours
    } else {
      chantierMap.set(p.chantier_id, { chantier_id: p.chantier_id, chantier_title: p.chantier_title, hours: p.hours, rate: effectiveRateC })
    }
    const rateKey = effectiveRateC != null ? String(effectiveRateC) : '__none__'
    if (!chantierRateCount.has(p.chantier_id)) chantierRateCount.set(p.chantier_id, new Map())
    const counts = chantierRateCount.get(p.chantier_id)!
    counts.set(rateKey, (counts.get(rateKey) ?? 0) + 1)
  }
  for (const [cid, row] of chantierMap) {
    const counts = chantierRateCount.get(cid)
    if (counts) {
      let bestKey = '__none__'; let bestCount = 0
      for (const [k, c] of counts) { if (c > bestCount) { bestCount = c; bestKey = k } }
      row.rate = bestKey !== '__none__' ? Number(bestKey) : null
    }
  }
  const chantierRows = Array.from(chantierMap.values()).sort((a, b) => a.chantier_title.localeCompare(b.chantier_title, 'fr'))
  const showRateCol = chantierRows.some(r => r.rate != null)

  const orgLines = [
    organization.address_line1,
    [organization.postal_code, organization.city].filter(Boolean).join(' ') || null,
  ].filter((l): l is string => !!l).map(pdfText)

  doc.onNewPage = ({ page }) => {
    let y = PAGE.height - PAGE.headerTop
    const headerTop = y

    let ly = headerTop
    ly -= SIZE.xl
    page.drawText(pdfText(organization.name), { x: PAGE.margin, y: ly, size: SIZE.xl, font: F.heading, color: COLOR.black })
    for (const line of orgLines) {
      ly -= SIZE.xs + 2
      page.drawText(line, { x: PAGE.margin, y: ly, size: SIZE.xs, font: F.regular, color: COLOR.secondary })
    }

    let ry = headerTop
    const drawRight = (text: string, style: TextStyle) => {
      const w = style.font.widthOfTextAtSize(text, style.size)
      ry -= style.size
      page.drawText(text, { x: PAGE.width - PAGE.margin - w, y: ry, size: style.size, font: style.font, color: style.color })
      ry -= textLineHeight(style) - style.size
    }
    drawRight(isAnnual ? 'RAPPORT ANNUEL' : "RAPPORT D'HEURES", { font: F.regular, size: SIZE.sm, color: COLOR.secondary })
    ry -= 2
    drawRight(pdfText(memberFullName), { font: F.heading, size: SIZE.xxl, color: COLOR.black })
    drawRight(isAnnual ? `Annee ${annualYear}` : `Du ${fmtDate(periodFrom)} au ${fmtDate(periodTo)}`, { font: F.regular, size: SIZE.md, color: COLOR.secondary })

    y = Math.min(ly, ry) - SPACE.lg
    page.drawLine({ start: { x: PAGE.margin, y }, end: { x: PAGE.width - PAGE.margin, y }, thickness: 1, color: COLOR.divider })
    y -= SPACE.xl
    return y
  }

  doc.addPage()

  doc.onFinishPage = ({ page, pageIndex, pageCount }) => {
    const label = `Rapport genere par ${pdfText(organization.name)} - Document a conserver pour vos archives.`
    const w = F.regular.widthOfTextAtSize(label, SIZE.xxs)
    page.drawText(label, { x: (PAGE.width - w) / 2, y: 24, size: SIZE.xxs, font: F.regular, color: COLOR.secondary })
    void pageIndex
    void pageCount
  }

  // ── Section Membre ──
  doc.ensureSpace(SIZE.sm + SPACE.sm)
  doc.y -= SIZE.sm
  doc.page.drawText((isAppMember ? 'MEMBRE' : 'INTERVENANT'), { x: PAGE.margin, y: doc.y, size: SIZE.sm, font: F.heading, color: COLOR.black })
  doc.moveDown(SPACE.sm)

  function drawMemberRow(label: string, value: string): void {
    doc.ensureSpace(SIZE.md + 4)
    doc.y -= SIZE.md
    doc.page.drawText(label, { x: PAGE.margin, y: doc.y, size: SIZE.md, font: F.regular, color: COLOR.secondary })
    doc.page.drawText(value, { x: PAGE.margin + 80, y: doc.y, size: SIZE.md, font: F.regular, color: COLOR.black })
    doc.y -= 4
  }
  drawMemberRow('Nom', pdfText(memberFullName) || '-')
  if (member.email) drawMemberRow('Email', pdfText(member.email))
  if (member.role_label) drawMemberRow('Role', pdfText(member.role_label))

  doc.moveDown(SPACE.lg)

  // ── Tableau des pointages par chantier ──
  doc.ensureSpace(SIZE.md + SPACE.sm)
  doc.y -= SIZE.md
  doc.page.drawText('DETAIL DES HEURES POINTEES', { x: PAGE.margin, y: doc.y, size: SIZE.md, font: F.heading, color: COLOR.black })
  doc.moveDown(SPACE.sm)

  if (chantierRows.length === 0) {
    doc.ensureSpace(SIZE.md + SPACE.md * 2)
    doc.page.drawRectangle({ x: PAGE.margin, y: doc.y - (SIZE.md + SPACE.md * 2), width: CONTENT_WIDTH, height: SIZE.md + SPACE.md * 2, borderColor: COLOR.divider, borderWidth: 1, color: undefined })
    const label = 'Aucune heure pointee sur la periode.'
    const w = F.regular.widthOfTextAtSize(label, SIZE.md)
    doc.page.drawText(label, { x: PAGE.margin + (CONTENT_WIDTH - w) / 2, y: doc.y - SPACE.md - SIZE.md, size: SIZE.md, font: F.regular, color: COLOR.secondary })
    doc.y -= SIZE.md + SPACE.md * 2
  } else {
    const cols: TableColumn[] = [
      { width: showRateCol ? CONTENT_WIDTH - 80 - 70 : CONTENT_WIDTH - 80, header: 'Chantier' },
      ...(showRateCol ? [{ width: 80, header: 'Taux', align: 'right' as const }] : []),
      { width: 70, header: 'Heures', align: 'right' as const },
    ]
    const rows: TableRow[] = chantierRows.map(row => ({
      cells: [
        { value: pdfText(row.chantier_title) },
        ...(showRateCol ? [{ value: row.rate != null ? `${row.rate} EUR/h` : '-' }] : []),
        { value: fmtHours(row.hours) },
      ],
    }))
    drawTable(doc, cols, rows, {
      x: PAGE.margin,
      headerStyle: { font: F.headingXBold, size: SIZE.xxs, color: COLOR.secondary },
      cellStyle: { font: F.regular, size: SIZE.sm, color: COLOR.body },
      detailStyle: { font: F.regular, size: SIZE.xs, color: COLOR.muted },
      rowPaddingY: SPACE.xs,
      headerPaddingY: SPACE.xs,
      repeatHeader: true,
    })
  }

  doc.moveDown(SPACE.lg)

  // ── Totaux ──
  const totalsBoxW = CONTENT_WIDTH
  doc.ensureSpace(SPACE.md * 2 + SIZE.lg)
  const totalsY = doc.y
  const totalsRows = 1 + (hasRateData ? 1 : 0)
  const totalsBoxH = SPACE.md * 2 + totalsRows * (SIZE.lg + 4)
  doc.page.drawRectangle({ x: PAGE.margin, y: totalsY - totalsBoxH, width: totalsBoxW, height: totalsBoxH, color: COLOR.surface })
  doc.page.drawRectangle({ x: PAGE.margin, y: totalsY - totalsBoxH, width: 3, height: totalsBoxH, color: COLOR.accent })

  doc.y = totalsY - SPACE.md
  drawKeyValueRow(doc, 'Total heures de la periode', fmtHours(totalHours), {
    x: PAGE.margin + SPACE.md, width: totalsBoxW - SPACE.md * 2,
    labelStyle: { font: F.regular, size: SIZE.md, color: COLOR.secondary },
    valueStyle: { font: F.heading, size: SIZE.lg, color: COLOR.black },
    rowHeight: SIZE.lg + 4,
  })
  if (hasRateData) {
    drawKeyValueRow(doc, "Cout main-d'oeuvre total", fmtCurrency(totalCost), {
      x: PAGE.margin + SPACE.md, width: totalsBoxW - SPACE.md * 2,
      labelStyle: { font: F.regular, size: SIZE.md, color: COLOR.secondary },
      valueStyle: { font: F.heading, size: SIZE.md, color: COLOR.black },
      rowHeight: SIZE.md + 4,
    })
  }
  doc.y = totalsY - totalsBoxH

  if (rateSlices.length > 1) {
    doc.moveDown(SPACE.md)
    doc.ensureSpace(SIZE.xs + SPACE.xs)
    doc.y -= SIZE.xs
    doc.page.drawText('VENTILATION PAR TAUX HORAIRE', { x: PAGE.margin, y: doc.y, size: SIZE.xs, font: F.heading, color: COLOR.secondary })
    doc.moveDown(SPACE.xs)
    for (const slice of rateSlices) {
      const rowH = SIZE.xs + SPACE.xs
      doc.ensureSpace(rowH + 2)
      doc.page.drawRectangle({ x: PAGE.margin, y: doc.y - rowH, width: CONTENT_WIDTH, height: rowH, color: COLOR.surface })
      const label = `${slice.rate != null ? `${slice.rate} EUR/h` : 'Sans taux defini'} - ${fmtHours(slice.hours)}`
      const value = slice.rate != null ? fmtCurrency(slice.cost) : fmtHours(slice.hours)
      const cy = doc.y - rowH / 2 - SIZE.xs / 2 + 1
      doc.page.drawText(label, { x: PAGE.margin + SPACE.sm, y: cy, size: SIZE.xs, font: F.regular, color: COLOR.secondary })
      const vw = F.headingXBold.widthOfTextAtSize(value, SIZE.xs)
      doc.page.drawText(value, { x: PAGE.margin + CONTENT_WIDTH - SPACE.sm - vw, y: cy, size: SIZE.xs, font: F.headingXBold, color: COLOR.black })
      doc.y -= rowH + 2
    }
  }

  return doc.save()
}
