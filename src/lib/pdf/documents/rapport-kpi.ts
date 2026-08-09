import type { Organization } from '@/lib/data/queries/organization'
import type { MonthlyReport, AnnualReport, HoursReport, TopClientEntry, TopChantierEntry, AnnualObjectives, MonthlyObjectives } from '@/lib/data/queries/reporting'
import { pdfText } from '@/lib/pdf/pdf-design-system'
import { PdfDoc } from '../engine/doc'
import type { FontBytes } from '../engine/fonts'
import { loadFontBytes } from '../engine/fonts'
import { drawImageContained, embedImage } from '../engine/image'
import { textLineHeight, type TextStyle } from '../engine/text'
import { drawTable, type TableColumn, type TableRow } from '../engine/table'
import { COLOR, CONTENT_WIDTH, PAGE, SIZE, SPACE } from '../engine/theme'
import { rgb } from 'pdf-lib'

const MONTHS_FR = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']

const GREEN = rgb(0x16 / 255, 0xa3 / 255, 0x4a / 255)
const RED = rgb(0xdc / 255, 0x26 / 255, 0x26 / 255)

function fmt(n: number): string {
  return pdfText(new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n))
}
function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)} %`
}
function fmtH(n: number): string {
  return `${n.toFixed(1)} h`
}

export type RapportKpiPdfData = {
  vue: 'mois' | 'annee'
  year: number
  month: number
  organization: Organization & { logo_url: string | null }
  monthlyReport: MonthlyReport | null
  annualReport: AnnualReport | null
  hoursReport: HoursReport | null
  topClients: TopClientEntry[]
  topChantiers: TopChantierEntry[]
  objectives: AnnualObjectives | MonthlyObjectives | null
}

export async function renderRapportKpiPdf(data: RapportKpiPdfData, origin: string): Promise<Buffer> {
  const fontBytes = await loadFontBytes(origin)
  return renderRapportKpiPdfWithFonts(data, fontBytes)
}

export async function renderRapportKpiPdfWithFonts(data: RapportKpiPdfData, fontBytes: FontBytes): Promise<Buffer> {
  const { vue, year, month, organization, monthlyReport, annualReport, hoursReport, topClients, topChantiers, objectives } = data
  const doc = await PdfDoc.create(fontBytes)
  const F = doc.fonts

  const titre = vue === 'mois' ? `Rapport ${MONTHS_FR[month - 1]} ${year}` : `Rapport Annuel ${year}`

  const r = monthlyReport
  const ar = annualReport
  const actualMargin = r?.beneficeEstime ?? ar?.beneficeEstime ?? 0
  const actualMarginPct = (r?.caHt ?? ar?.caHt ?? 0) > 0 ? actualMargin / (r?.caHt ?? ar?.caHt ?? 1) : 0
  const projectedMargin = r?.projectedMarginHt ?? ar?.projectedMarginHt ?? 0
  const projectedMarginPct = r?.projectedMarginPct ?? ar?.projectedMarginPct ?? 0
  const hasProjectedMargin = r?.hasProjectedCostData ?? ar?.hasProjectedCostData ?? false
  const isVatSubject = organization.is_vat_subject
  const billedLabel = isVatSubject ? 'CA HT' : 'Facturé'
  const billedSub = isVatSubject ? `${fmt(r?.caTtc ?? ar?.caTtc ?? 0)} TTC` : 'TVA non applicable'
  const collectedLabel = isVatSubject ? 'Encaissé TTC' : 'Encaissé'

  const logoImg = organization.logo_url ? await embedImage(doc.doc, organization.logo_url) : null

  doc.onNewPage = ({ page }) => {
    let y = PAGE.height - PAGE.headerTop
    const headerTop = y
    const logoSize = 44

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
    if (organization.siret) { ly -= 2 + SIZE.xs; page.drawText(`SIRET : ${pdfText(organization.siret)}`, { x: PAGE.margin + logoSize + SPACE.md, y: ly, size: SIZE.xs, font: F.regular, color: COLOR.secondary }) }

    let ry = headerTop
    const drawRight = (text: string, style: TextStyle) => {
      const w = style.font.widthOfTextAtSize(text, style.size)
      ry -= style.size
      page.drawText(text, { x: PAGE.width - PAGE.margin - w, y: ry, size: style.size, font: style.font, color: style.color })
      ry -= textLineHeight(style) - style.size
    }
    drawRight(titre, { font: F.headingXBold, size: SIZE.xxxl, color: COLOR.black })
    drawRight(`Généré le ${new Date().toLocaleDateString('fr-FR')}`, { font: F.regular, size: SIZE.xs, color: COLOR.secondary })

    y = Math.min(headerTop - logoSize, ry) - SPACE.xl
    page.drawLine({ start: { x: PAGE.margin, y }, end: { x: PAGE.width - PAGE.margin, y }, thickness: 1, color: COLOR.divider })
    y -= SPACE.xl
    return y
  }

  doc.addPage()

  doc.onFinishPage = ({ page, pageIndex, pageCount }) => {
    const label = `${pdfText(organization.name)} - ${titre} - ATELIER`
    const w = F.regular.widthOfTextAtSize(label, SIZE.xxs)
    page.drawText(label, { x: (PAGE.width - w) / 2, y: 24, size: SIZE.xxs, font: F.regular, color: COLOR.secondary })
    if (pageCount > 1) {
      const pageLabel = `${pageIndex + 1} / ${pageCount}`
      const pw = F.regular.widthOfTextAtSize(pageLabel, SIZE.xxs)
      page.drawText(pageLabel, { x: PAGE.width - PAGE.margin - pw, y: 12, size: SIZE.xxs, font: F.regular, color: COLOR.secondary })
    }
  }

  // ── KPI principaux ──
  drawSectionTitle(doc, 'Synthèse', F)
  const kpiRow1: KpiItem[] = [
    { label: billedLabel, value: fmt(r?.caHt ?? ar?.caHt ?? 0), sub: billedSub, accent: true },
    { label: collectedLabel, value: fmt(r?.encaisse ?? ar?.encaisse ?? 0) },
    { label: isVatSubject ? 'TVA facturée' : 'TVA non applicable', value: isVatSubject ? fmt(r?.tvaDue ?? ar?.tvaDue ?? 0) : '-' },
    { label: 'Bénéfice estimé', value: fmt(actualMargin), sub: `${fmtPct(actualMarginPct)} · avant impôts et charges fixes`, valueColor: actualMargin >= 0 ? GREEN : RED },
  ]
  drawKpiRow(doc, kpiRow1, F)
  doc.moveDown(SPACE.sm)

  const kpiRow2: KpiItem[] = [
    { label: 'Bénéfice prévu sur factures', value: hasProjectedMargin ? fmt(projectedMargin) : '-', sub: hasProjectedMargin ? `${fmtPct(projectedMarginPct)} · coûts lignes` : 'Aucun coût interne', valueColor: hasProjectedMargin ? (projectedMargin >= 0 ? GREEN : RED) : undefined },
    { label: 'Chantiers terminés', value: String(r?.chantiersTermines ?? ar?.chantiersTermines ?? 0) },
  ]
  if (ar) kpiRow2.push({ label: 'Nouveaux clients', value: String(ar.nouveauxClients) })
  kpiRow2.push({ label: 'Heures travaillées', value: fmtH(hoursReport?.total ?? 0) })
  if (r) kpiRow2.push({ label: 'Factures émises', value: String(r.nouvellesFactures), sub: `${r.facturesPayees} payée(s)` })
  drawKpiRow(doc, kpiRow2, F)

  // ── Objectifs ──
  const hasObjectives = objectives && (objectives.revenue_ht_target || objectives.margin_eur_target || objectives.margin_pct_target || objectives.hours_target || objectives.chantiers_count_target)
  if (hasObjectives && objectives) {
    doc.moveDown(SPACE.md)
    drawSectionTitle(doc, `Objectifs ${year}`, F)
    doc.moveDown(SPACE.xs)

    const objList = [
      objectives.revenue_ht_target && { label: billedLabel, current: r?.caHt ?? ar?.caHt ?? 0, target: objectives.revenue_ht_target, format: fmt },
      objectives.margin_eur_target && { label: 'Bénéfice estimé', current: actualMargin, target: objectives.margin_eur_target, format: fmt },
      objectives.margin_pct_target && { label: 'Bénéfice estimé %', current: actualMarginPct * 100, target: objectives.margin_pct_target, format: (n: number) => `${n.toFixed(1)} %` },
      objectives.chantiers_count_target && { label: 'Chantiers', current: r?.chantiersTermines ?? ar?.chantiersTermines ?? 0, target: objectives.chantiers_count_target, format: (n: number) => String(Math.round(n)) },
      objectives.hours_target && { label: 'Heures', current: hoursReport?.total ?? 0, target: objectives.hours_target, format: fmtH },
    ].filter((o): o is { label: string; current: number; target: number; format: (n: number) => string } => Boolean(o))

    for (const obj of objList) {
      const pct = Math.min((obj.current / obj.target) * 100, 100)
      doc.ensureSpace(SIZE.xs + 4 + 4)
      doc.y -= SIZE.xs
      doc.page.drawText(obj.label, { x: PAGE.margin, y: doc.y, size: SIZE.xs, font: F.regular, color: COLOR.body })
      const rightText = `${obj.format(obj.current)} / ${obj.format(obj.target)}`
      const rw = F.regular.widthOfTextAtSize(rightText, SIZE.xs)
      doc.page.drawText(rightText, { x: PAGE.width - PAGE.margin - rw, y: doc.y, size: SIZE.xs, font: F.regular, color: COLOR.secondary })
      doc.y -= 4
      doc.page.drawRectangle({ x: PAGE.margin, y: doc.y - 4, width: CONTENT_WIDTH, height: 4, color: COLOR.divider })
      doc.page.drawRectangle({ x: PAGE.margin, y: doc.y - 4, width: CONTENT_WIDTH * (pct / 100), height: 4, color: COLOR.accent })
      doc.y -= 4 + SPACE.sm
    }
  }

  doc.moveDown(SPACE.md)
  doc.ensureSpace(1)
  doc.page.drawLine({ start: { x: PAGE.margin, y: doc.y }, end: { x: PAGE.width - PAGE.margin, y: doc.y }, thickness: 0.5, color: COLOR.divider })
  doc.moveDown(SPACE.lg)

  // ── Heures par personne ──
  if (hoursReport && hoursReport.byPerson.length > 0) {
    drawSectionTitle(doc, 'Heures par personne', F)
    doc.moveDown(SPACE.sm)
    const cols: TableColumn[] = [
      { width: CONTENT_WIDTH * 0.6, header: 'Personne' },
      { width: CONTENT_WIDTH * 0.2, header: 'Heures', align: 'right' },
      { width: CONTENT_WIDTH * 0.2, header: '%', align: 'right' },
    ]
    const rows: TableRow[] = hoursReport.byPerson.map(p => ({
      cells: [
        { value: pdfText(p.personName) },
        { value: fmtH(p.hours), style: { font: F.heading } },
        { value: `${((p.hours / hoursReport.total) * 100).toFixed(0)} %` },
      ],
    }))
    drawTable(doc, cols, rows, tableOpts(F))
    doc.moveDown(SPACE.md)
  }

  // ── Top clients ──
  if (topClients.length > 0) {
    drawSectionTitle(doc, 'Top clients', F)
    doc.moveDown(SPACE.sm)
    const cols: TableColumn[] = [
      { width: CONTENT_WIDTH * 0.45, header: 'Client' },
      { width: CONTENT_WIDTH * 0.25, header: billedLabel, align: 'right' },
      { width: CONTENT_WIDTH * 0.3, header: 'Marge', align: 'right' },
    ]
    const rows: TableRow[] = topClients.slice(0, 8).map(c => ({
      cells: [
        { value: pdfText(c.clientName) },
        { value: fmt(c.caHt), style: { font: F.heading } },
        { value: fmt(c.marginEur), style: { color: c.marginEur >= 0 ? GREEN : RED } },
      ],
    }))
    drawTable(doc, cols, rows, tableOpts(F))
    doc.moveDown(SPACE.md)
  }

  // ── Top chantiers ──
  if (topChantiers.length > 0) {
    drawSectionTitle(doc, 'Top chantiers', F)
    doc.moveDown(SPACE.sm)
    const cols: TableColumn[] = [
      { width: CONTENT_WIDTH * 0.42, header: 'Chantier' },
      { width: CONTENT_WIDTH * 0.2, header: billedLabel, align: 'right' },
      { width: CONTENT_WIDTH * 0.2, header: collectedLabel, align: 'right' },
      { width: CONTENT_WIDTH * 0.18, header: 'Marge', align: 'right' },
    ]
    const rows: TableRow[] = topChantiers.slice(0, 8).map(c => ({
      cells: [
        { value: pdfText(c.chantierTitle) },
        { value: fmt(c.caHt), style: { font: F.heading } },
        { value: fmt(c.encaisseTtc), style: { font: F.heading } },
        { value: fmt(c.marginEur), style: { color: c.marginEur >= 0 ? GREEN : RED } },
      ],
    }))
    drawTable(doc, cols, rows, tableOpts(F))
  }

  return doc.save()
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type KpiItem = { label: string; value: string; sub?: string; accent?: boolean; valueColor?: ReturnType<typeof rgb> }

function drawSectionTitle(doc: PdfDoc, label: string, F: PdfDoc['fonts']): void {
  doc.ensureSpace(SIZE.xs + SPACE.sm)
  doc.y -= SIZE.xs
  doc.page.drawText(pdfText(label).toUpperCase(), { x: PAGE.margin, y: doc.y, size: SIZE.xs, font: F.heading, color: COLOR.black })
  doc.y -= SPACE.sm
}

function drawKpiRow(doc: PdfDoc, items: KpiItem[], F: PdfDoc['fonts']): void {
  const gap = SPACE.sm
  const boxW = (CONTENT_WIDTH - gap * (items.length - 1)) / items.length
  const boxH = 60
  doc.ensureSpace(boxH)
  const y = doc.y
  items.forEach((item, i) => {
    const x = PAGE.margin + i * (boxW + gap)
    doc.page.drawRectangle({ x, y: y - boxH, width: boxW, height: boxH, color: item.accent ? COLOR.accent : COLOR.surface })
    let cy = y - SPACE.md - SIZE.xxs
    doc.page.drawText(item.label.toUpperCase(), { x: x + SPACE.md, y: cy, size: SIZE.xxs, font: F.regular, color: item.accent ? COLOR.black : COLOR.secondary })
    cy -= 5 + SIZE.lg
    doc.page.drawText(item.value, { x: x + SPACE.md, y: cy, size: SIZE.lg, font: F.headingXBold, color: item.valueColor ?? COLOR.black })
    if (item.sub) {
      cy -= 3 + SIZE.xxs
      const subStyle: TextStyle = { font: F.regular, size: SIZE.xxs, color: item.accent ? COLOR.black : COLOR.secondary, maxWidth: boxW - SPACE.md * 2, lineHeight: 1.3 }
      doc.page.drawText(pdfText(item.sub), { x: x + SPACE.md, y: cy, size: subStyle.size, font: subStyle.font, color: subStyle.color })
    }
  })
  doc.y = y - boxH
}

function tableOpts(F: PdfDoc['fonts']) {
  return {
    x: PAGE.margin,
    headerStyle: { font: F.headingXBold, size: SIZE.xxs, color: COLOR.black },
    cellStyle: { font: F.regular, size: SIZE.xs, color: COLOR.body },
    detailStyle: { font: F.regular, size: SIZE.xs, color: COLOR.muted },
    rowPaddingY: SPACE.xs,
    headerPaddingY: SPACE.xs,
    repeatHeader: true,
  }
}
