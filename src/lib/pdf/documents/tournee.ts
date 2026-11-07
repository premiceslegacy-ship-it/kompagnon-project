import { pdfText } from '@/lib/pdf/pdf-design-system'
import type { TourneeSlot } from '@/lib/data/queries/chantiers'
import { PdfDoc } from '../engine/doc'
import type { FontBytes } from '../engine/fonts'
import { loadFontBytes } from '../engine/fonts'
import { embedImage } from '../engine/image'
import {
  K, drawCard, drawClause, drawCompactHeader, drawHeader, drawLineText, drawMeta, drawNote, drawSectionHeading, hairline, installFooter,
} from '../engine/kit'
import { wrapText } from '../engine/text'
import { COLOR, CONTENT_WIDTH, PAGE } from '../engine/theme'

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

const fmtShortDate = (iso: string): string => pdfText(new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }))

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
  const slotsWithNotes = slots.filter(s => s.notes)
  const firstStart = slots[0]?.start_time ?? null
  const lastEnd = [...slots].reverse().find(s => s.end_time)?.end_time ?? null

  const logoImg = organization.logo_url ? await embedImage(doc.doc, organization.logo_url) : null
  const brand = { logo: logoImg, name: organization.name }
  const heading = { title: 'Feuille de route', number: pdfText(routeLabel) }
  doc.onNewPage = ({ pageIndex }) => pageIndex === 0 ? drawHeader(doc, brand, heading) : drawCompactHeader(doc, brand, heading)
  installFooter(doc, [
    pdfText([organization.name, orgAddress, organization.siret ? `SIRET ${organization.siret}` : null].filter(Boolean).join(' · ')),
    pdfText([organization.phone, organization.email].filter(Boolean).join(' · ')),
  ].filter(l => l.length > 0))
  doc.addPage()

  drawMeta(doc, [
    { label: 'Date', value: fmtShortDate(date) },
    { label: 'Sites à visiter', value: String(slots.length) },
    { label: 'Premier passage', value: firstStart ? fmtTime(firstStart) : '-' },
    { label: 'Trajet estimé', value: totalTravelMin > 0 ? `~${fmtMin(totalTravelMin)}` : '-' },
    { label: 'Temps sur site', value: totalSiteMin > 0 ? fmtMin(totalSiteMin) : '-' },
  ].slice(0, 4))
  if (departureLabel) drawNote(doc, 'Point de départ', departureLabel, 12)

  // ── Ordre de passage ──
  drawSectionHeading(doc, 'Ordre de passage', 18)
  const circle = 16.5
  const timeW = 46
  const durW = 48
  const gap = 9
  const siteX = PAGE.margin + circle + gap + timeW + gap
  const siteW = CONTENT_WIDTH - (circle + gap + timeW + gap) - durW - gap
  slots.forEach((slot, index) => {
    if (index > 0 && slot.travel_from_prev_min != null) {
      doc.ensureSpace(20)
      const base = doc.y - 5 - K.label
      drawLineText(doc.page, `~${fmtMin(slot.travel_from_prev_min)} de trajet`, PAGE.margin + circle + gap, base, { font: F.regular, size: K.label, color: COLOR.secondary })
      doc.y = base - 5
      hairline(doc.page, PAGE.margin, PAGE.margin + CONTENT_WIDTH, doc.y)
    }
    const name = wrapText(pdfText(slot.chantier_title), F.bold, K.body + 0.2, siteW)
    const subs = [slot.label ? pdfText(slot.label) : null, addressForSlot(slot) || null]
      .filter((l): l is string => !!l)
      .flatMap(l => wrapText(l, F.regular, K.small, siteW))
    const lh = (K.body + 0.2) * 1.35
    const slh = K.small * 1.45
    const h = 11 + name.length * lh + 1.5 + subs.length * slh + 11
    doc.ensureSpace(h)
    const top = doc.y
    drawCard(doc.page, { x: PAGE.margin, top: top - 11, w: circle, h: circle, r: circle / 2, fill: COLOR.black })
    const num = String(slot.route_order ?? index + 1)
    drawLineText(doc.page, num, PAGE.margin, top - 11 - circle / 2 - 2.6, { font: F.bold, size: K.small + 0.4, color: COLOR.white, align: 'center', width: circle })
    drawLineText(doc.page, fmtTime(slot.start_time), PAGE.margin + circle + gap, top - 11 - K.body, { font: F.bold, size: K.body, color: COLOR.black })
    if (slot.end_time) drawLineText(doc.page, `fin ${fmtTime(slot.end_time)}`, PAGE.margin + circle + gap, top - 11 - K.body - K.small * 1.5, { font: F.regular, size: K.small, color: COLOR.secondary })
    name.forEach((line, i) => doc.page.drawText(line, { x: siteX, y: top - 11 - (K.body + 0.2) - i * lh, size: K.body + 0.2, font: F.bold, color: COLOR.black }))
    subs.forEach((line, i) => doc.page.drawText(line, { x: siteX, y: top - 11 - name.length * lh - 1.5 - K.small - i * slh, size: K.small, font: F.regular, color: COLOR.secondary }))
    drawLineText(doc.page, slot.duration_min ? fmtMin(slot.duration_min) : '-', PAGE.margin, top - 11 - K.body, { font: F.regular, size: K.body, color: COLOR.secondary, align: 'right', width: CONTENT_WIDTH })
    doc.y = top - h
    hairline(doc.page, PAGE.margin, PAGE.margin + CONTENT_WIDTH, doc.y)
  })
  if (lastEnd) drawNote(doc, null, `Fin prévisionnelle de la tournée : ${fmtTime(lastEnd)}`, 9)

  // ── Notes terrain ──
  if (slotsWithNotes.length > 0) {
    drawSectionHeading(doc, 'Notes terrain', 18)
    slotsWithNotes.forEach((slot, index) => {
      drawClause(doc, `Passage ${slot.route_order ?? index + 1} · ${pdfText(slot.chantier_title)}`, slot.notes ?? '')
    })
  }

  // ── Consignes ──
  drawClause(
    doc,
    "Consignes d'utilisation",
    "Les temps de trajet indiqués sont des estimations basées sur la proximité géographique des codes postaux. En cas d'imprévu terrain, l'ordre de passage peut être adapté par l'intervenant.",
  )

  return doc.save()
}
