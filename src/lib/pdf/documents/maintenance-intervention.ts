import { pdfText } from '@/lib/pdf/pdf-design-system'
import { PdfDoc } from '../engine/doc'
import type { FontBytes } from '../engine/fonts'
import { loadFontBytes } from '../engine/fonts'
import { embedImage } from '../engine/image'
import {
  drawClause, drawCompactHeader, drawHeader, drawKitTable, drawMeta, drawParties, drawPhotoGrid, drawSectionHeading, drawSignatureBoxes, installFooter,
  type KitColumn, type KitPhoto, type KitRow,
} from '../engine/kit'
import { CONTENT_WIDTH } from '../engine/theme'

type Organization = {
  name: string
  logo_url?: string | null
  address_line1?: string | null
  postal_code?: string | null
  city?: string | null
  phone?: string | null
  email?: string | null
}

type Client = {
  company_name?: string | null
  first_name?: string | null
  last_name?: string | null
  address_line1?: string | null
  postal_code?: string | null
  city?: string | null
}

type Intervention = {
  id: string
  date_intervention: string
  statut: string
  start_time: string | null
  end_time: string | null
  duration_hours: number | null
  rapport: string | null
  observations: string | null
  billable_notes: string | null
  cost_parts_ht: number | null
  cost_travel_ht: number | null
  cost_other_ht: number | null
  billable_amount_ht: number | null
  intervenant?: { prenom?: string | null; name?: string | null } | null
  intervenant_profile?: { full_name?: string | null; email?: string | null } | null
  invoice?: { number?: string | null; status?: string | null } | null
  contract?: {
    title: string
    frequence: string
    site_name?: string | null
    site_contact_name?: string | null
    site_contact_email?: string | null
    site_contact_phone?: string | null
    site_address_line1?: string | null
    site_postal_code?: string | null
    site_city?: string | null
    equipements: Array<{ nom: string; ref?: string; localisation?: string }>
    client?: Client | null
    chantier?: { title: string; address_line1?: string | null; postal_code?: string | null; city?: string | null } | null
  } | null
}

export type MaintenanceReportPhoto = {
  id: string
  url: string
  title: string | null
  caption: string | null
}

export type MaintenanceInterventionPdfData = {
  intervention: Intervention
  organization: Organization
  reportPhotos?: MaintenanceReportPhoto[]
}

function formatDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('fr-FR')
}

function formatTimes(intervention: Intervention): string {
  const parts: string[] = []
  if (intervention.start_time) parts.push(intervention.start_time.slice(0, 5))
  if (intervention.end_time) parts.push(intervention.end_time.slice(0, 5))
  const range = parts.length ? parts.join(' - ') : '-'
  return intervention.duration_hours ? `${range} · ${intervention.duration_hours}h` : range
}

export async function renderMaintenanceInterventionPdf(data: MaintenanceInterventionPdfData, origin: string): Promise<Buffer> {
  const fontBytes = await loadFontBytes(origin)
  return renderMaintenanceInterventionPdfWithFonts(data, fontBytes)
}

export async function renderMaintenanceInterventionPdfWithFonts(data: MaintenanceInterventionPdfData, fontBytes: FontBytes): Promise<Buffer> {
  const { intervention, organization, reportPhotos = [] } = data
  const doc = await PdfDoc.create(fontBytes)

  const client = intervention.contract?.client
  const contract = intervention.contract
  const chantier = contract?.chantier
  const clientName = client
    ? client.company_name || [client.first_name, client.last_name].filter(Boolean).join(' ') || 'Client'
    : 'Client'
  const intervenantName = intervention.intervenant_profile?.full_name
    || [intervention.intervenant?.prenom, intervention.intervenant?.name].filter(Boolean).join(' ')
    || 'Non renseigné'

  const logoImg = organization.logo_url ? await embedImage(doc.doc, organization.logo_url) : null
  const brand = { logo: logoImg, name: organization.name }
  const heading = { title: "Rapport d'intervention", number: contract?.title ? pdfText(contract.title) : null }
  doc.onNewPage = ({ pageIndex }) => pageIndex === 0 ? drawHeader(doc, brand, heading) : drawCompactHeader(doc, brand, { title: "Rapport d'intervention", number: null })
  installFooter(doc, [
    [organization.name, [organization.address_line1, organization.postal_code, organization.city].filter(Boolean).join(' ')].filter(Boolean).join(' · '),
    [organization.email, organization.phone].filter(Boolean).join(' · '),
  ].filter(l => l.length > 0).map(pdfText))
  doc.addPage()

  drawMeta(doc, [
    { label: 'Date', value: formatDate(intervention.date_intervention) },
    { label: 'Horaires', value: formatTimes(intervention) },
    { label: 'Intervenant', value: intervenantName },
  ])

  const clientAddress = [client?.address_line1, [client?.postal_code, client?.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  const siteAddress = [
    contract?.site_address_line1 ?? chantier?.address_line1 ?? client?.address_line1,
    [contract?.site_postal_code ?? chantier?.postal_code ?? client?.postal_code, contract?.site_city ?? chantier?.city ?? client?.city].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ')
  const siteContact = [contract?.site_contact_name, contract?.site_contact_phone].filter(Boolean).join(' · ')
  drawParties(
    doc,
    { label: 'Client', name: pdfText(clientName), lines: [clientAddress].filter(Boolean).map(pdfText) },
    {
      label: 'Site',
      name: pdfText(contract?.site_name ?? chantier?.title ?? contract?.title ?? '—'),
      lines: [siteAddress, siteContact, contract?.site_contact_email ?? null].filter((l): l is string => !!l).map(pdfText),
    },
  )

  // ── Équipements ──
  if (contract?.equipements?.length) {
    drawSectionHeading(doc, 'Équipements', 18)
    const gap = 7.5
    const cols: KitColumn[] = [
      { width: CONTENT_WIDTH * 0.45 - gap, header: 'Équipement' },
      { width: CONTENT_WIDTH * 0.25 - gap, header: 'Référence' },
      { width: CONTENT_WIDTH * 0.30 - gap, header: 'Localisation' },
    ]
    const rows: KitRow[] = contract.equipements.map(eq => ({
      cells: [{ value: pdfText(eq.nom) }, { value: pdfText(eq.ref ?? '') }, { value: pdfText(eq.localisation ?? '') }],
    }))
    drawKitTable(doc, cols, rows, { gap, textColumns: 3, gapTop: 4 })
  }

  drawSectionHeading(doc, 'Travaux réalisés', 18)
  drawClause(doc, 'Compte rendu', intervention.rapport || 'Aucun compte rendu saisi.')
  drawClause(doc, 'Observations et recommandations', intervention.observations || 'Aucune observation.')

  // ── Photos ──
  if (reportPhotos.length > 0) {
    drawSectionHeading(doc, `Photos de l'intervention (${reportPhotos.length})`, 18)
    const photos: KitPhoto[] = []
    for (const [i, p] of reportPhotos.entries()) {
      photos.push({ image: await embedImage(doc.doc, p.url), title: p.title ?? `Photo ${i + 1}`, caption: p.caption })
    }
    drawPhotoGrid(doc, photos)
  }

  drawSignatureBoxes(doc, [
    { title: "L'intervenant", name: intervenantName === 'Non renseigné' ? null : intervenantName },
    { title: 'Le client', name: clientName === 'Client' ? null : clientName },
  ], 84)

  return doc.save()
}
