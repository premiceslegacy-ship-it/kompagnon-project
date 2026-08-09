import type { Organization } from '@/lib/data/queries/organization'
import { pdfText } from '@/lib/pdf/pdf-design-system'
import { PdfDoc } from '../engine/doc'
import type { FontBytes } from '../engine/fonts'
import { loadFontBytes } from '../engine/fonts'
import { drawImageContained, embedImage } from '../engine/image'
import { textLineHeight, type TextStyle } from '../engine/text'
import { drawTable, type TableColumn, type TableRow } from '../engine/table'
import { COLOR, CONTENT_WIDTH, PAGE, SIZE, SPACE } from '../engine/theme'

export type ReportInvoice = {
  id: string
  number: string | null
  title: string | null
  status: string
  invoice_type: string
  total_ht: number
  total_tva: number
  total_ttc: number
  total_paid: number
  currency: string
  issue_date: string | null
  due_date: string | null
  paid_at: string | null
  created_at: string
  client_name: string | null
  items_cost_total: number
  payments: Array<{
    id: string
    amount: number
    payment_date: string | null
  }>
}

export type ReportQuote = {
  id: string
  number: string | null
  title: string | null
  status: string
  total_ht: number
  currency: string
  created_at: string
  client_name: string | null
}

export type MonthlyReportData = {
  month: string
  organization: Organization & { logo_url: string | null }
  invoices: ReportInvoice[]
  quotes: ReportQuote[]
}

const MONTHS_FR = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']

function fmtMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${MONTHS_FR[m - 1]} ${y}`
}

function fmt(amount: number, currency = 'EUR'): string {
  return pdfText(new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount))
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  return pdfText(new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }))
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon', sent: 'Envoyée', viewed: 'Vue', partial: 'Partielle', paid: 'Payée', overdue: 'En retard', cancelled: 'Annulée', refunded: 'Remboursée',
}
const QUOTE_STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon', sent: 'Envoyé', viewed: 'Consulté',
  accepted: 'Accepté', refused: 'Refusé', expired: 'Expiré', converted: 'Converti',
  fully_invoiced: 'Facturé',
}

export async function renderMonthlyReportPdf(data: MonthlyReportData, origin: string): Promise<Buffer> {
  const fontBytes = await loadFontBytes(origin)
  return renderMonthlyReportPdfWithFonts(data, fontBytes)
}

export async function renderMonthlyReportPdfWithFonts(data: MonthlyReportData, fontBytes: FontBytes): Promise<Buffer> {
  const { organization, invoices, quotes, month } = data
  const doc = await PdfDoc.create(fontBytes)
  const F = doc.fonts

  const isVatSubject = organization.is_vat_subject
  const currency = invoices[0]?.currency ?? quotes[0]?.currency ?? 'EUR'
  const invoiceIssuedStatuses = ['sent', 'viewed', 'partial', 'paid', 'overdue']
  const invoiceWaitingStatuses = ['sent', 'viewed', 'partial', 'overdue']

  const invoicesIssuedInMonth = invoices.filter(inv => inv.issue_date?.startsWith(month))
  const sentPaid = invoicesIssuedInMonth.filter(inv => invoiceIssuedStatuses.includes(inv.status))
  const caHt = sentPaid.reduce((s, inv) => s + inv.total_ht, 0)
  const paidTtcTotal = (inv: ReportInvoice) => inv.status === 'paid' ? inv.total_ttc : inv.status === 'partial' ? inv.total_paid : 0
  const paidTtcInMonth = (inv: ReportInvoice) => {
    const fromPayments = inv.payments.filter(p => p.payment_date?.startsWith(month)).reduce((s, p) => s + p.amount, 0)
    if (fromPayments > 0) return fromPayments
    if (inv.status === 'paid' && inv.paid_at?.startsWith(month)) return inv.total_ttc
    return 0
  }
  const htFromTtc = (inv: ReportInvoice, amountTtc: number) =>
    inv.total_ttc > 0 ? Math.min(inv.total_ht, inv.total_ht * (amountTtc / inv.total_ttc)) : 0
  const tvaFromTtc = (inv: ReportInvoice, amountTtc: number) =>
    inv.total_ttc > 0 ? Math.min(inv.total_tva, inv.total_tva * (amountTtc / inv.total_ttc)) : 0
  const remainingHt = (inv: ReportInvoice) => ['sent', 'viewed', 'overdue'].includes(inv.status) ? inv.total_ht : inv.status === 'partial' ? Math.max(0, inv.total_ht - htFromTtc(inv, paidTtcTotal(inv))) : 0
  const encaisseHt = invoices.reduce((s, inv) => s + htFromTtc(inv, paidTtcInMonth(inv)), 0)
  const encaisseTtc = invoices.reduce((s, inv) => s + paidTtcInMonth(inv), 0)
  const resteHt = invoicesIssuedInMonth.reduce((s, inv) => s + remainingHt(inv), 0)
  const totalInternalCost = invoicesIssuedInMonth.reduce((s, inv) => s + inv.items_cost_total, 0)
  const margeHt = caHt - totalInternalCost
  const margePct = caHt > 0 ? Math.round((margeHt / caHt) * 100) : 0
  const hasMargin = totalInternalCost > 0

  const tvaTotale = isVatSubject ? invoices.reduce((s, inv) => s + tvaFromTtc(inv, paidTtcInMonth(inv)), 0) : 0

  const qEmis = quotes.length
  const qAccepted = quotes.filter(q => q.status === 'accepted').length
  const qAcceptedHt = quotes.filter(q => q.status === 'accepted').reduce((s, q) => s + q.total_ht, 0)
  const qConvRate = qEmis > 0 ? Math.round((qAccepted / qEmis) * 100) : 0

  const sentPaidCount = invoicesIssuedInMonth.filter(i => invoiceIssuedStatuses.includes(i.status)).length
  const sentCount = invoicesIssuedInMonth.filter(i => invoiceWaitingStatuses.includes(i.status)).length

  const logoImg = organization.logo_url ? await embedImage(doc.doc, organization.logo_url) : null

  doc.onNewPage = ({ page }) => {
    let y = PAGE.height - PAGE.headerTop
    const headerTop = y
    const logoSize = 48

    if (logoImg) {
      drawImageContained(doc, logoImg, { x: PAGE.margin, y: headerTop - logoSize, w: logoSize, h: logoSize })
    } else {
      page.drawRectangle({ x: PAGE.margin, y: headerTop - logoSize, width: logoSize, height: logoSize, color: COLOR.black })
      const initials = pdfText(organization.name.slice(0, 2).toUpperCase())
      const iw = F.headingXBold.widthOfTextAtSize(initials, SIZE.lg)
      page.drawText(initials, { x: PAGE.margin + (logoSize - iw) / 2, y: headerTop - logoSize / 2 - SIZE.lg / 2 + 2, size: SIZE.lg, font: F.headingXBold, color: COLOR.white })
    }

    let ly = headerTop - SIZE.xl
    page.drawText(pdfText(organization.name), { x: PAGE.margin + logoSize + SPACE.md, y: ly, size: SIZE.xl, font: F.headingXBold, color: COLOR.black })
    if (organization.siret) { ly -= 3 + SIZE.xs; page.drawText(`SIRET : ${pdfText(organization.siret)}`, { x: PAGE.margin + logoSize + SPACE.md, y: ly, size: SIZE.xs, font: F.regular, color: COLOR.secondary }) }
    if (organization.email) { ly -= 3 + SIZE.xs; page.drawText(pdfText(organization.email), { x: PAGE.margin + logoSize + SPACE.md, y: ly, size: SIZE.xs, font: F.regular, color: COLOR.secondary }) }

    let ry = headerTop
    const drawRight = (text: string, style: TextStyle) => {
      const w = style.font.widthOfTextAtSize(text, style.size)
      ry -= style.size
      page.drawText(text, { x: PAGE.width - PAGE.margin - w, y: ry, size: style.size, font: style.font, color: style.color })
      ry -= textLineHeight(style) - style.size
    }
    drawRight(fmtMonth(month), { font: F.headingXBold, size: SIZE.xxxl, color: COLOR.black })
    drawRight(`Rapport mensuel - généré le ${fmtDate(new Date().toISOString())}`, { font: F.regular, size: SIZE.sm, color: COLOR.secondary })

    y = Math.min(headerTop - logoSize, ry) - SPACE.xl
    page.drawLine({ start: { x: PAGE.margin, y }, end: { x: PAGE.width - PAGE.margin, y }, thickness: 1, color: COLOR.divider })
    y -= SPACE.xl
    return y
  }

  doc.addPage()

  doc.onFinishPage = ({ page, pageIndex, pageCount }) => {
    const label = `${organization.name} - Rapport ${fmtMonth(month)} - ATELIER`
    const w = F.regular.widthOfTextAtSize(label, SIZE.xxs)
    page.drawText(label, { x: (PAGE.width - w) / 2, y: 24, size: SIZE.xxs, font: F.regular, color: COLOR.secondary })
    if (pageCount > 1) {
      const pageLabel = `${pageIndex + 1} / ${pageCount}`
      const pw = F.regular.widthOfTextAtSize(pageLabel, SIZE.xxs)
      page.drawText(pageLabel, { x: PAGE.width - PAGE.margin - pw, y: 12, size: SIZE.xxs, font: F.regular, color: COLOR.secondary })
    }
  }

  // ── KPI Factures ──
  drawSectionTitle(doc, 'Synthèse facturation', F)
  const kpiItems: { label: string; value: string; sub?: string; accent?: boolean }[] = [
    { label: 'Montant facturé HT', value: fmt(caHt, currency), sub: `${sentPaidCount} facture${sentPaidCount > 1 ? 's' : ''}`, accent: true },
    { label: 'Encaissé HT', value: fmt(encaisseHt, currency), sub: isVatSubject ? `TTC : ${fmt(encaisseTtc, currency)}` : undefined },
    { label: 'Reste à recouvrer', value: fmt(resteHt, currency), sub: `${sentCount} facture${sentCount > 1 ? 's' : ''} en attente` },
  ]
  if (hasMargin) kpiItems.push({ label: 'Bénéfice prévu', value: `${margePct}%`, sub: `${fmt(margeHt, currency)} HT · coûts lignes` })
  drawKpiRow(doc, kpiItems, F)
  doc.moveDown(SPACE.md)

  // ── TVA ──
  if (isVatSubject) {
    drawInfoBand(doc, F, (cy) => {
      doc.page.drawText('TVA COLLECTÉE', { x: PAGE.margin + SPACE.md, y: cy, size: SIZE.xxs, font: F.regular, color: COLOR.secondary })
      cy -= SPACE.xs + SIZE.lg
      doc.page.drawText(fmt(tvaTotale, currency), { x: PAGE.margin + SPACE.md, y: cy, size: SIZE.lg, font: F.headingXBold, color: COLOR.black })
      cy -= 4 + SIZE.xxs
      doc.page.drawText(`Calculée sur ${fmt(encaisseTtc, currency)} TTC encaissé`, { x: PAGE.margin + SPACE.md, y: cy, size: SIZE.xxs, font: F.regular, color: COLOR.secondary })
    })
  } else {
    drawInfoBand(doc, F, (cy) => {
      doc.page.drawText('TVA non applicable - Art. 293B du CGI (franchise en base)', { x: PAGE.margin + SPACE.md, y: cy - SIZE.sm, size: SIZE.sm, font: F.regular, color: COLOR.secondary })
    })
  }
  doc.moveDown(SPACE.md)

  // ── KPI Devis ──
  drawSectionTitle(doc, 'Synthèse devis', F)
  drawKpiRow(doc, [
    { label: 'Devis émis', value: String(qEmis) },
    { label: 'Acceptés', value: String(qAccepted), sub: `${fmt(qAcceptedHt, currency)} HT` },
    { label: 'Taux de conversion', value: `${qConvRate}%`, accent: true },
  ], F)

  doc.moveDown(SPACE.lg)
  doc.ensureSpace(1)
  doc.page.drawLine({ start: { x: PAGE.margin, y: doc.y }, end: { x: PAGE.width - PAGE.margin, y: doc.y }, thickness: 0.5, color: COLOR.divider })
  doc.moveDown(SPACE.lg)

  // ── Tableau factures ──
  if (invoices.length > 0) {
    drawSectionTitle(doc, 'Détail des factures', F)
    doc.moveDown(SPACE.sm)

    const numW = 55, dateW = 65, htW = 65, tvaW = isVatSubject ? 50 : 0, ttcW = 60
    const clientW = CONTENT_WIDTH - numW - dateW - htW - tvaW - ttcW - 75
    const statusW = 75

    const cols: TableColumn[] = [
      { width: numW, header: 'N°' },
      { width: clientW, header: 'Client' },
      { width: dateW, header: 'Date' },
      { width: htW, header: 'HT', align: 'right' },
      ...(isVatSubject ? [{ width: tvaW, header: 'TVA', align: 'right' as const }] : []),
      { width: ttcW, header: 'TTC', align: 'right' },
      { width: statusW, header: 'Statut', align: 'right' },
    ]
    const rows: TableRow[] = invoices.map(inv => ({
      cells: [
        { value: inv.number ?? '—' },
        { value: pdfText(inv.client_name ?? '—') },
        { value: fmtDate(inv.issue_date ?? inv.created_at) },
        { value: fmt(inv.total_ht, inv.currency), style: { font: F.heading } },
        ...(isVatSubject ? [{ value: fmt(inv.total_tva, inv.currency) }] : []),
        { value: fmt(inv.total_ttc, inv.currency) },
        { value: STATUS_LABELS[inv.status] ?? inv.status },
      ],
    }))
    drawTable(doc, cols, rows, {
      x: PAGE.margin,
      headerStyle: { font: F.headingXBold, size: SIZE.xxs, color: COLOR.black },
      cellStyle: { font: F.regular, size: SIZE.xs, color: COLOR.body },
      detailStyle: { font: F.regular, size: SIZE.xs, color: COLOR.muted },
      rowPaddingY: SPACE.xs,
      headerPaddingY: SPACE.xs,
      repeatHeader: true,
    })
  }

  // ── Tableau devis ──
  if (quotes.length > 0) {
    doc.moveDown(SPACE.lg)
    drawSectionTitle(doc, 'Détail des devis', F)
    doc.moveDown(SPACE.sm)

    const numW = 55, dateW = 65, htW = 75, statusW = 60
    const remaining = CONTENT_WIDTH - numW - dateW - htW - statusW
    const titleW = remaining * 0.56
    const clientW = remaining - titleW

    const cols: TableColumn[] = [
      { width: numW, header: 'N°' },
      { width: titleW, header: 'Titre' },
      { width: clientW, header: 'Client' },
      { width: dateW, header: 'Date' },
      { width: htW, header: 'HT', align: 'right' },
      { width: statusW, header: 'Statut', align: 'right' },
    ]
    const rows: TableRow[] = quotes.map(q => ({
      cells: [
        { value: q.number ?? '—' },
        { value: pdfText(q.title ?? 'Sans titre') },
        { value: pdfText(q.client_name ?? '—'), style: { color: COLOR.secondary } },
        { value: fmtDate(q.created_at) },
        { value: fmt(q.total_ht, q.currency), style: { font: F.heading } },
        { value: QUOTE_STATUS_LABELS[q.status] ?? q.status },
      ],
    }))
    drawTable(doc, cols, rows, {
      x: PAGE.margin,
      headerStyle: { font: F.headingXBold, size: SIZE.xxs, color: COLOR.black },
      cellStyle: { font: F.regular, size: SIZE.xs, color: COLOR.body },
      detailStyle: { font: F.regular, size: SIZE.xs, color: COLOR.muted },
      rowPaddingY: SPACE.xs,
      headerPaddingY: SPACE.xs,
      repeatHeader: true,
    })
  }

  return doc.save()
}

// ─── Helpers de blocs ────────────────────────────────────────────────────────

function drawSectionTitle(doc: PdfDoc, label: string, F: PdfDoc['fonts']): void {
  doc.ensureSpace(SIZE.sm + SPACE.sm)
  doc.y -= SIZE.sm
  doc.page.drawText(pdfText(label).toUpperCase(), { x: PAGE.margin, y: doc.y, size: SIZE.sm, font: F.heading, color: COLOR.black })
  doc.y -= SPACE.sm
}

function drawKpiRow(doc: PdfDoc, items: { label: string; value: string; sub?: string; accent?: boolean }[], F: PdfDoc['fonts']): void {
  const gap = SPACE.sm
  const boxW = (CONTENT_WIDTH - gap * (items.length - 1)) / items.length
  const boxH = 62
  doc.ensureSpace(boxH)
  const y = doc.y
  items.forEach((item, i) => {
    const x = PAGE.margin + i * (boxW + gap)
    doc.page.drawRectangle({ x, y: y - boxH, width: boxW, height: boxH, color: item.accent ? COLOR.accent : COLOR.surface })
    let cy = y - SPACE.md - SIZE.xxs
    doc.page.drawText(item.label.toUpperCase(), { x: x + SPACE.md, y: cy, size: SIZE.xxs, font: F.regular, color: item.accent ? COLOR.black : COLOR.secondary })
    cy -= 6 + SIZE.xl
    doc.page.drawText(item.value, { x: x + SPACE.md, y: cy, size: SIZE.xl, font: F.headingXBold, color: COLOR.black })
    if (item.sub) {
      cy -= 4 + SIZE.xxs
      doc.page.drawText(pdfText(item.sub), { x: x + SPACE.md, y: cy, size: SIZE.xxs, font: F.regular, color: item.accent ? COLOR.black : COLOR.secondary })
    }
  })
  doc.y = y - boxH
}

function drawInfoBand(doc: PdfDoc, F: PdfDoc['fonts'], draw: (cy: number) => void): void {
  const boxH = SPACE.sm * 2 + SIZE.xxs + 6 + SIZE.lg
  doc.ensureSpace(boxH)
  doc.page.drawRectangle({ x: PAGE.margin, y: doc.y - boxH, width: CONTENT_WIDTH, height: boxH, color: COLOR.surface })
  draw(doc.y - SPACE.sm)
  doc.y -= boxH
}
