import type { PdfOrganizationData } from '@/lib/pdf/document-types'
import type { MonthlyReport, AnnualReport, HoursReport, TopClientEntry, TopChantierEntry, AnnualObjectives, MonthlyObjectives } from '@/lib/data/queries/reporting'
import { pdfText } from '@/lib/pdf/pdf-design-system'
import { PdfDoc } from '../engine/doc'
import type { FontBytes } from '../engine/fonts'
import { loadFontBytes } from '../engine/fonts'
import { embedImage } from '../engine/image'
import {
  drawCompactHeader, drawHeader, drawKitTable, drawKpiHero, drawKpiTiles, drawMeta, drawProgress, drawSectionHeading, installFooter,
  type KitColumn, type KitRow,
} from '../engine/kit'
import { COLOR, CONTENT_WIDTH } from '../engine/theme'

const MONTHS_FR = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']

const GREEN = COLOR.greenText
const RED = COLOR.redText

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
  organization: Pick<PdfOrganizationData, 'name' | 'logo_url' | 'siret'>
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
  const titre = vue === 'mois' ? `Rapport ${MONTHS_FR[month - 1]} ${year}` : `Rapport Annuel ${year}`

  const r = monthlyReport
  const ar = annualReport
  const actualMargin = r?.beneficeEstime ?? ar?.beneficeEstime ?? 0
  const actualMarginPct = (r?.caHt ?? ar?.caHt ?? 0) > 0 ? actualMargin / (r?.caHt ?? ar?.caHt ?? 1) : 0
  const projectedMargin = r?.projectedMarginHt ?? ar?.projectedMarginHt ?? 0
  const projectedMarginPct = r?.projectedMarginPct ?? ar?.projectedMarginPct ?? 0
  const hasProjectedMargin = r?.hasProjectedCostData ?? ar?.hasProjectedCostData ?? false
  const billedLabel = 'CA HT'
  const billedSub = `${fmt(r?.caTtc ?? ar?.caTtc ?? 0)} TTC`
  const collectedLabel = 'Encaissé TTC'

  const logoImg = organization.logo_url ? await embedImage(doc.doc, organization.logo_url) : null
  const brand = { logo: logoImg, name: organization.name }
  const heading = { title: vue === 'mois' ? 'Rapport mensuel' : 'Rapport annuel', number: vue === 'mois' ? `${MONTHS_FR[month - 1]} ${year}` : String(year) }
  doc.onNewPage = ({ pageIndex }) => pageIndex === 0 ? drawHeader(doc, brand, heading) : drawCompactHeader(doc, brand, heading)
  installFooter(doc, [pdfText([organization.name, organization.siret ? `SIRET ${organization.siret}` : null].filter(Boolean).join(' · '))])
  doc.addPage()

  drawMeta(doc, [
    { label: 'Période', value: vue === 'mois' ? `${MONTHS_FR[month - 1]} ${year}` : `Année ${year}` },
    { label: 'Édité le', value: new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) },
    { label: 'Société', value: organization.name },
  ])

  // ── Chiffres clés ──
  drawKpiHero(doc, billedLabel, fmt(r?.caHt ?? ar?.caHt ?? 0), billedSub)
  drawKpiTiles(doc, [
    { label: collectedLabel, value: fmt(r?.encaisse ?? ar?.encaisse ?? 0) },
    { label: 'TVA facturée', value: fmt(r?.tvaDue ?? ar?.tvaDue ?? 0) },
    { label: 'Bénéfice estimé', value: fmt(actualMargin), note: `${fmtPct(actualMarginPct)} · avant impôts et charges fixes` },
    { label: 'Bénéfice prévu sur factures', value: hasProjectedMargin ? fmt(projectedMargin) : '—', note: hasProjectedMargin ? `${fmtPct(projectedMarginPct)} · coûts lignes` : 'aucun coût interne saisi' },
    { label: 'Chantiers terminés', value: String(r?.chantiersTermines ?? ar?.chantiersTermines ?? 0) },
    ar
      ? { label: 'Nouveaux clients', value: String(ar.nouveauxClients) }
      : { label: 'Factures émises', value: String(r?.nouvellesFactures ?? 0), note: `${r?.facturesPayees ?? 0} payée(s)` },
    { label: 'Heures travaillées', value: fmtH(hoursReport?.total ?? 0) },
  ])

  // ── Objectifs ──
  const hasObjectives = objectives && (objectives.revenue_ht_target || objectives.margin_eur_target || objectives.margin_pct_target || objectives.hours_target || objectives.chantiers_count_target)
  if (hasObjectives && objectives) {
    drawSectionHeading(doc, `Objectifs ${year}`, 18)
    const objList = [
      objectives.revenue_ht_target && { label: billedLabel, current: r?.caHt ?? ar?.caHt ?? 0, target: objectives.revenue_ht_target, format: fmt },
      objectives.margin_eur_target && { label: 'Bénéfice estimé', current: actualMargin, target: objectives.margin_eur_target, format: fmt },
      objectives.margin_pct_target && { label: 'Bénéfice estimé %', current: actualMarginPct * 100, target: objectives.margin_pct_target, format: (n: number) => `${n.toFixed(1)} %` },
      objectives.chantiers_count_target && { label: 'Chantiers', current: r?.chantiersTermines ?? ar?.chantiersTermines ?? 0, target: objectives.chantiers_count_target, format: (n: number) => String(Math.round(n)) },
      objectives.hours_target && { label: 'Heures', current: hoursReport?.total ?? 0, target: objectives.hours_target, format: fmtH },
    ].filter((o): o is { label: string; current: number; target: number; format: (n: number) => string } => Boolean(o))
    for (const obj of objList) {
      drawProgress(doc, obj.label, Math.min((obj.current / obj.target) * 100, 100), 9, `${obj.format(obj.current)} / ${obj.format(obj.target)}`)
    }
  }

  // ── Heures par personne ──
  if (hoursReport && hoursReport.byPerson.length > 0) {
    drawSectionHeading(doc, 'Heures par personne', 18)
    const gap = 7.5
    const cols: KitColumn[] = [
      { width: CONTENT_WIDTH * 0.6 - gap, header: 'Personne' },
      { width: CONTENT_WIDTH * 0.2 - gap, header: 'Heures' },
      { width: CONTENT_WIDTH * 0.2 - gap, header: 'Part' },
    ]
    const rows: KitRow[] = hoursReport.byPerson.map(p => ({
      cells: [
        { value: pdfText(p.personName) },
        { value: fmtH(p.hours), bold: true },
        { value: hoursReport.total > 0 ? `${((p.hours / hoursReport.total) * 100).toFixed(0)} %` : '—' },
      ],
    }))
    drawKitTable(doc, cols, rows, { gap, gapTop: 4 })
  }

  // ── Meilleurs clients ──
  if (topClients.length > 0) {
    drawSectionHeading(doc, 'Meilleurs clients', 18)
    const gap = 7.5
    const cols: KitColumn[] = [
      { width: CONTENT_WIDTH * 0.45 - gap, header: 'Client' },
      { width: CONTENT_WIDTH * 0.25 - gap, header: billedLabel },
      { width: CONTENT_WIDTH * 0.3 - gap, header: 'Marge' },
    ]
    const rows: KitRow[] = topClients.slice(0, 8).map(c => ({
      cells: [
        { value: pdfText(c.clientName) },
        { value: fmt(c.caHt), bold: true },
        { value: fmt(c.marginEur), color: c.marginEur >= 0 ? GREEN : RED },
      ],
    }))
    drawKitTable(doc, cols, rows, { gap, gapTop: 4 })
  }

  // ── Meilleurs chantiers ──
  if (topChantiers.length > 0) {
    drawSectionHeading(doc, 'Meilleurs chantiers', 18)
    const gap = 7.5
    const cols: KitColumn[] = [
      { width: CONTENT_WIDTH * 0.42 - gap, header: 'Chantier' },
      { width: CONTENT_WIDTH * 0.2 - gap, header: billedLabel },
      { width: CONTENT_WIDTH * 0.2 - gap, header: collectedLabel },
      { width: CONTENT_WIDTH * 0.18 - gap, header: 'Marge' },
    ]
    const rows: KitRow[] = topChantiers.slice(0, 8).map(c => ({
      cells: [
        { value: pdfText(c.chantierTitle) },
        { value: fmt(c.caHt), bold: true },
        { value: fmt(c.encaisseTtc), bold: true },
        { value: fmt(c.marginEur), color: c.marginEur >= 0 ? GREEN : RED },
      ],
    }))
    drawKitTable(doc, cols, rows, { gap, gapTop: 4 })
  }

  return doc.save()
}
