import { fmtCurrency, pdfText } from '@/lib/pdf/pdf-design-system'
import type { IndividualMember, MemberPointage } from '@/lib/data/queries/members'
import { PdfDoc } from '../engine/doc'
import type { FontBytes } from '../engine/fonts'
import { loadFontBytes } from '../engine/fonts'
import { embedImage } from '../engine/image'
import {
  drawAside, drawLineTable, drawMeta, drawParties, drawSectionTitle, drawTotals, flexWidth,
  setupChrome, type LineColumn,
} from '../engine/layout'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '-'
  const part = iso.includes('T') ? iso.split('T')[0] : iso
  const [y, m, d] = part.split('-').map(Number)
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1)).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

const fmtHours = (hours: number): string => {
  let h = Math.floor(hours)
  let min = Math.round((hours - h) * 60)
  if (min === 60) { h += 1; min = 0 }
  return min ? `${h} h ${String(min).padStart(2, '0')}` : `${h} h`
}

const fmtRate = (rate: number): string => `${fmtCurrency(rate)} par heure`

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

  const periodLabel = isAnnual ? `Année ${annualYear}` : `Du ${fmtDate(periodFrom)} au ${fmtDate(periodTo)}`
  const orgAddress = [organization.address_line1, [organization.postal_code, organization.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')

  const logoImg = organization.logo_url ? await embedImage(doc.doc, organization.logo_url) : null
  setupChrome(doc, {
    title: isAnnual ? 'Rapport annuel' : "Rapport d'heures",
    reference: periodLabel,
    logo: logoImg,
    orgName: organization.name,
    footerLines: [`Rapport généré par ${pdfText(organization.name)}. Document à conserver pour vos archives.`],
  })
  doc.addPage()

  drawMeta(doc, [
    { label: isAppMember ? 'Membre' : 'Intervenant', value: pdfText(memberFullName) || '-' },
    { label: 'Période', value: periodLabel },
    { label: 'Total pointé', value: fmtHours(totalHours) },
  ])

  drawParties(doc,
    { label: isAppMember ? 'Membre' : 'Intervenant', name: memberFullName || '-', lines: [member.role_label ?? '', member.email ?? ''] },
    { label: 'Entreprise', name: organization.name, lines: [orgAddress] },
  )

  // ── Heures pointées par chantier ──
  drawSectionTitle(doc, 'Détail des heures pointées')
  if (chantierRows.length === 0) {
    drawAside(doc, 'Aucune heure pointée sur la période.', { align: 'left' })
  } else {
    const fixed = showRateCol ? [120, 67.5] : [67.5]
    const cols: LineColumn[] = [
      { header: 'Chantier', width: flexWidth(fixed) },
      ...(showRateCol ? [{ header: 'Taux', width: 120 }] : []),
      { header: 'Heures', width: 67.5 },
    ]
    drawLineTable(doc, cols, chantierRows.map(row => ({
      cells: [
        pdfText(row.chantier_title),
        ...(showRateCol ? [row.rate != null ? fmtRate(row.rate) : '-'] : []),
        { text: fmtHours(row.hours), bold: true },
      ],
    })), { marginTop: 4.5 })
  }

  // ── Ventilation par taux horaire ──
  if (rateSlices.length > 1) {
    drawSectionTitle(doc, 'Ventilation par taux horaire')
    drawLineTable(doc, [
      { header: 'Taux', width: flexWidth([67.5, 82.5]) },
      { header: 'Heures', width: 67.5 },
      { header: 'Coût', width: 82.5 },
    ], rateSlices.map(slice => ({
      cells: [
        slice.rate != null ? fmtRate(slice.rate) : 'Sans taux défini',
        fmtHours(slice.hours),
        { text: slice.rate != null ? fmtCurrency(slice.cost) : '-', bold: true },
      ],
    })), { marginTop: 4.5, tight: true })
  }

  // ── Totaux ──
  drawTotals(doc, hasRateData
    ? { lines: [{ label: 'Total heures de la période', value: fmtHours(totalHours) }], grands: [{ label: "Coût main-d'œuvre", value: fmtCurrency(totalCost) }] }
    : { lines: [], grands: [{ label: 'Total heures de la période', value: fmtHours(totalHours) }] })

  return doc.save()
}
