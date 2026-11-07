import { fmtCurrency, pdfText } from '@/lib/pdf/pdf-design-system'
import type { IndividualMember, MemberPointage } from '@/lib/data/queries/members'
import { PdfDoc } from '../engine/doc'
import type { FontBytes } from '../engine/fonts'
import { loadFontBytes } from '../engine/fonts'
import { embedImage } from '../engine/image'
import {
  drawCompactHeader, drawHeader, drawKitTable, drawMeta, drawNote, drawSectionHeading, drawTotals, installFooter,
  type KitColumn, type KitRow, type TotalLine,
} from '../engine/kit'
import { CONTENT_WIDTH } from '../engine/theme'

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
  return `${h} h ${String(min).padStart(2, '0')}`
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

  const logoImg = organization.logo_url ? await embedImage(doc.doc, organization.logo_url) : null
  const brand = { logo: logoImg, name: organization.name }
  const title = isAnnual ? 'Rapport annuel' : "Rapport d'heures"
  const heading = { title, number: pdfText(memberFullName) }
  doc.onNewPage = ({ pageIndex }) => pageIndex === 0 ? drawHeader(doc, brand, heading) : drawCompactHeader(doc, brand, heading)
  installFooter(doc, [pdfText(`Rapport généré par ${organization.name}. Document à conserver pour vos archives.`)])
  doc.addPage()

  drawMeta(doc, [
    { label: isAppMember ? 'Membre' : 'Intervenant', value: pdfText(memberFullName) || '—' },
    { label: 'Période', value: isAnnual ? `Année ${annualYear}` : `${fmtDate(periodFrom)} au ${fmtDate(periodTo)}` },
    { label: 'Total pointé', value: fmtHours(totalHours) },
  ])
  const contact = [member.role_label, member.email].filter(Boolean).join(' · ')
  if (contact) drawNote(doc, null, pdfText(contact), 9)

  // ── Heures par chantier ──
  drawSectionHeading(doc, 'Détail des heures pointées', 18)
  if (chantierRows.length === 0) {
    drawNote(doc, null, 'Aucune heure pointée sur la période.', 12)
  } else {
    const gap = 7.5
    const cols: KitColumn[] = [
      { width: showRateCol ? CONTENT_WIDTH - 80 - 70 - gap * 2 : CONTENT_WIDTH - 70 - gap, header: 'Chantier' },
      ...(showRateCol ? [{ width: 80, header: 'Taux' }] : []),
      { width: 70, header: 'Heures' },
    ]
    const rows: KitRow[] = chantierRows.map(row => ({
      cells: [
        { value: pdfText(row.chantier_title) },
        ...(showRateCol ? [{ value: row.rate != null ? `${row.rate} €/h` : '—' }] : []),
        { value: fmtHours(row.hours), bold: true },
      ],
    }))
    drawKitTable(doc, cols, rows, { gap, gapTop: 4 })
  }

  // ── Ventilation par taux horaire ──
  if (rateSlices.length > 1) {
    drawSectionHeading(doc, 'Ventilation par taux horaire', 18)
    const gap = 7.5
    const cols: KitColumn[] = [
      { width: CONTENT_WIDTH - 90 - 100 - gap * 2, header: 'Taux' },
      { width: 90, header: 'Heures' },
      { width: 100, header: 'Coût' },
    ]
    const rows: KitRow[] = rateSlices.map(slice => ({
      cells: [
        { value: slice.rate != null ? `${slice.rate} € par heure` : 'Sans taux défini' },
        { value: fmtHours(slice.hours) },
        { value: slice.rate != null ? fmtCurrency(slice.cost) : '—', bold: true },
      ],
    }))
    drawKitTable(doc, cols, rows, { gap, gapTop: 4 })
  }

  // ── Totaux ──
  const totals: TotalLine[] = [{ label: 'Total heures de la période', value: fmtHours(totalHours) }]
  drawTotals(doc, totals, hasRateData ? { label: "Coût main-d'œuvre", value: fmtCurrency(totalCost) } : { label: 'Total heures', value: fmtHours(totalHours) })

  return doc.save()
}
