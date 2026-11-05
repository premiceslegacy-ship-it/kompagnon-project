import type { PdfOrganizationData } from '@/lib/pdf/document-types'
import type { MonthlyReport, AnnualReport, HoursReport, TopClientEntry, TopChantierEntry, AnnualObjectives, MonthlyObjectives } from '@/lib/data/queries/reporting'
import { pdfText } from '@/lib/pdf/pdf-design-system'
import { PdfDoc } from '../engine/doc'
import type { FontBytes } from '../engine/fonts'
import { loadFontBytes } from '../engine/fonts'
import { embedImage } from '../engine/image'
import {
  drawHeroKpi, drawKpiGrid, drawLineTable, drawMeta, drawProgress, drawSectionTitle, flexWidth,
  setupChrome, type Kpi,
} from '../engine/layout'
import { COLOR } from '../engine/theme'

const MONTHS_FR = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']

const GREEN = COLOR.okInk
const RED = COLOR.alertInk

function fmt(n: number): string {
  return pdfText(new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n))
}
function fmtPct(n: number): string {
  return `${(n * 100).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`
}
function fmtH(n: number): string {
  return `${n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} h`
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
  /** Date d'édition (défaut : maintenant). */
  editedAt?: string | null
}

export async function renderRapportKpiPdf(data: RapportKpiPdfData, origin: string): Promise<Buffer> {
  const fontBytes = await loadFontBytes(origin)
  return renderRapportKpiPdfWithFonts(data, fontBytes)
}

export async function renderRapportKpiPdfWithFonts(data: RapportKpiPdfData, fontBytes: FontBytes): Promise<Buffer> {
  const { vue, year, month, organization, monthlyReport, annualReport, hoursReport, topClients, topChantiers, objectives } = data
  const doc = await PdfDoc.create(fontBytes)

  const titre = vue === 'mois' ? `Rapport ${MONTHS_FR[month - 1]} ${year}` : `Rapport annuel ${year}`

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

  const editedAt = new Date(data.editedAt ?? Date.now()).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
  setupChrome(doc, {
    title: titre,
    reference: `Édité le ${editedAt}`,
    logo: logoImg,
    orgName: organization.name,
    footerLines: [[organization.name, organization.siret ? `SIRET ${organization.siret}` : null].filter(Boolean).join(' · ')].map(l => pdfText(l)),
  })
  doc.addPage()

  drawMeta(doc, [
    { label: 'Période', value: vue === 'mois' ? `${MONTHS_FR[month - 1]} ${year}` : `Année ${year}` },
    { label: 'Édité le', value: editedAt },
    { label: 'Société', value: pdfText(organization.name) },
  ])

  // ── Synthèse ──
  drawHeroKpi(doc, { label: billedLabel, value: fmt(r?.caHt ?? ar?.caHt ?? 0), note: billedSub, noteColor: COLOR.ink3 })
  const kpis: Kpi[] = [
    { label: collectedLabel, value: fmt(r?.encaisse ?? ar?.encaisse ?? 0) },
    { label: 'TVA facturée', value: fmt(r?.tvaDue ?? ar?.tvaDue ?? 0) },
    { label: 'Bénéfice estimé', value: fmt(actualMargin), note: `${fmtPct(actualMarginPct)} · avant impôts et charges fixes`, valueColor: actualMargin >= 0 ? GREEN : RED },
    { label: 'Bénéfice prévu sur factures', value: hasProjectedMargin ? fmt(projectedMargin) : '-', note: hasProjectedMargin ? `${fmtPct(projectedMarginPct)} · coûts lignes` : 'Aucun coût interne', valueColor: hasProjectedMargin ? (projectedMargin >= 0 ? GREEN : RED) : undefined },
    { label: 'Chantiers terminés', value: String(r?.chantiersTermines ?? ar?.chantiersTermines ?? 0) },
  ]
  if (ar) kpis.push({ label: 'Nouveaux clients', value: String(ar.nouveauxClients) })
  kpis.push({ label: 'Heures travaillées', value: fmtH(hoursReport?.total ?? 0) })
  if (r) kpis.push({ label: 'Factures émises', value: String(r.nouvellesFactures), note: `${r.facturesPayees} payée(s)` })
  drawKpiGrid(doc, kpis, { columns: 4 })

  // ── Objectifs ──
  const hasObjectives = objectives && (objectives.revenue_ht_target || objectives.margin_eur_target || objectives.margin_pct_target || objectives.hours_target || objectives.chantiers_count_target)
  if (hasObjectives && objectives) {
    drawSectionTitle(doc, `Objectifs ${year}`)
    const objList = [
      objectives.revenue_ht_target && { label: billedLabel, current: r?.caHt ?? ar?.caHt ?? 0, target: objectives.revenue_ht_target, format: fmt },
      objectives.margin_eur_target && { label: 'Bénéfice estimé', current: actualMargin, target: objectives.margin_eur_target, format: fmt },
      objectives.margin_pct_target && { label: 'Bénéfice estimé %', current: actualMarginPct * 100, target: objectives.margin_pct_target, format: (n: number) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %` },
      objectives.chantiers_count_target && { label: 'Chantiers', current: r?.chantiersTermines ?? ar?.chantiersTermines ?? 0, target: objectives.chantiers_count_target, format: (n: number) => String(Math.round(n)) },
      objectives.hours_target && { label: 'Heures', current: hoursReport?.total ?? 0, target: objectives.hours_target, format: fmtH },
    ].filter((o): o is { label: string; current: number; target: number; format: (n: number) => string } => Boolean(o))
    objList.forEach((obj, i) => {
      drawProgress(doc, obj.label, Math.min((obj.current / obj.target) * 100, 100), { marginTop: i ? 10.5 : 9, right: `${obj.format(obj.current)} sur ${obj.format(obj.target)}` })
    })
  }

  // ── Heures par personne ──
  if (hoursReport && hoursReport.byPerson.length > 0) {
    drawSectionTitle(doc, 'Heures par personne')
    drawLineTable(doc, [
      { header: 'Personne', width: flexWidth([82.5, 60]) },
      { header: 'Heures', width: 82.5 },
      { header: 'Part', width: 60 },
    ], hoursReport.byPerson.map(p => ({
      cells: [
        pdfText(p.personName),
        { text: fmtH(p.hours), bold: true },
        hoursReport.total > 0 ? `${((p.hours / hoursReport.total) * 100).toFixed(0)} %` : '-',
      ],
    })), { marginTop: 4.5, tight: true })
  }

  // ── Top clients ──
  if (topClients.length > 0) {
    drawSectionTitle(doc, 'Top clients')
    drawLineTable(doc, [
      { header: 'Client', width: flexWidth([90, 90]) },
      { header: billedLabel, width: 90 },
      { header: 'Marge', width: 90 },
    ], topClients.slice(0, 8).map(c => ({
      cells: [
        pdfText(c.clientName),
        { text: fmt(c.caHt), bold: true },
        { text: fmt(c.marginEur), color: c.marginEur >= 0 ? GREEN : RED },
      ],
    })), { marginTop: 4.5, tight: true })
  }

  // ── Top chantiers ──
  if (topChantiers.length > 0) {
    drawSectionTitle(doc, 'Top chantiers')
    drawLineTable(doc, [
      { header: 'Chantier', width: flexWidth([82.5, 82.5, 82.5]) },
      { header: billedLabel, width: 82.5 },
      { header: collectedLabel, width: 82.5 },
      { header: 'Marge', width: 82.5 },
    ], topChantiers.slice(0, 8).map(c => ({
      cells: [
        pdfText(c.chantierTitle),
        { text: fmt(c.caHt), bold: true },
        fmt(c.encaisseTtc),
        { text: fmt(c.marginEur), color: c.marginEur >= 0 ? GREEN : RED },
      ],
    })), { marginTop: 4.5, tight: true })
  }

  return doc.save()
}
