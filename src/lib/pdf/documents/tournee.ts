import { pdfText } from '@/lib/pdf/pdf-design-system'
import type { TourneeSlot } from '@/lib/data/queries/chantiers'
import { PdfDoc } from '../engine/doc'
import type { FontBytes } from '../engine/fonts'
import { loadFontBytes } from '../engine/fonts'
import { embedImage } from '../engine/image'
import {
  drawCardRow, drawCentered, drawEntries, drawLineTable, drawMeta, drawSectionTitle, flexWidth,
  infoCard, setupChrome,
} from '../engine/layout'

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

  const orgAddress = [organization.address_line1, organization.postal_code, organization.city].filter(Boolean).join(', ')
  const departureLabel = [departureAddress, departurePostalCode, departureCity].filter(Boolean).join(', ')
  const generatedAt = pdfText(new Date().toLocaleDateString('fr-FR'))
  const slotsWithNotes = slots.filter(s => s.notes)
  const firstStart = slots[0]?.start_time ?? null
  const lastEnd = [...slots].reverse().find(s => s.end_time)?.end_time ?? null

  const logoImg = organization.logo_url ? await embedImage(doc.doc, organization.logo_url) : null

  // En-tête réduit au logo : coordonnées de l'entreprise dans le pied de page.
  const dateLabel = fmtDate(date)
  setupChrome(doc, {
    title: 'Tournée du jour',
    reference: dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1),
    logo: logoImg,
    orgName: organization.name,
    footerLines: [
      [organization.name, orgAddress, organization.siret ? `SIRET ${organization.siret}` : null].filter(Boolean).join(' · '),
      [organization.phone ? `Tél. ${organization.phone}` : null, organization.email].filter(Boolean).join(' · '),
      `Généré le ${generatedAt}${lastEnd ? ` · Fin prévisionnelle : ${fmtTime(lastEnd)}` : ''}`,
    ].map(l => pdfText(l)).filter(Boolean),
  })
  doc.addPage()

  drawMeta(doc, [
    { label: 'Sites à visiter', value: String(slots.length) },
    { label: 'Premier passage', value: firstStart ? fmtTime(firstStart) : '-' },
    { label: 'Trajet estimé', value: totalTravelMin > 0 ? `${fmtMin(totalTravelMin)} environ` : '-' },
    { label: 'Temps sur site', value: totalSiteMin > 0 ? fmtMin(totalSiteMin) : '-' },
  ])

  if (routeLabel || departureLabel) {
    drawCentered(doc, departureLabel ? 'Point de départ' : null, [routeLabel ? `Tournée : ${pdfText(routeLabel)}` : null, departureLabel || null].filter(Boolean).join(' · '), { marginTop: 13.5 })
  }

  // ── Ordre de passage ──
  drawSectionTitle(doc, 'Ordre de passage')
  const fixed = [18, 45, 105, 45, 52.5]
  drawLineTable(doc, [
    { header: 'N°', width: 18, align: 'left' },
    { header: 'Horaire', width: 45, align: 'left' },
    { header: 'Site', width: flexWidth(fixed), align: 'left' },
    { header: 'Intervention', width: 105, align: 'left' },
    { header: 'Durée', width: 45 },
    { header: 'Trajet', width: 52.5 },
  ], slots.map((slot, index) => ({
    cells: [
      { text: String(index + 1), bold: true },
      { text: fmtTime(slot.start_time), detail: slot.end_time ? [`fin ${fmtTime(slot.end_time)}`] : [] },
      { text: pdfText(slot.chantier_title), bold: true, detail: [addressForSlot(slot) || '-'] },
      pdfText(slot.label ?? ''),
      slot.duration_min ? fmtMin(slot.duration_min) : '-',
      slot.travel_from_prev_min != null ? `${fmtMin(slot.travel_from_prev_min)} env.` : '-',
    ],
  })), { marginTop: 4.5, leftColumns: 4 })

  // ── Notes terrain ──
  if (slotsWithNotes.length > 0) {
    drawSectionTitle(doc, 'Notes terrain')
    drawEntries(doc, slotsWithNotes.map((slot, index) => ({
      meta: `Passage ${slot.route_order ?? index + 1} · ${pdfText(slot.chantier_title)}`,
      text: slot.notes ?? '',
    })))
  }

  // ── Consignes ──
  drawCardRow(doc, [infoCard(doc, "Consignes d'utilisation", [
    "Les temps de trajet indiqués sont des estimations basées sur la proximité géographique des codes postaux. En cas d'imprévu terrain, l'ordre de passage peut être adapté par l'intervenant. Les heures réellement effectuées doivent être pointées depuis l'espace personnel ou depuis la fiche chantier.",
  ])], { marginTop: 18 })

  return doc.save()
}
