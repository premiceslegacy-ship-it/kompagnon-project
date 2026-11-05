import { pdfText } from '@/lib/pdf/pdf-design-system'
import { PdfDoc } from '../engine/doc'
import type { FontBytes } from '../engine/fonts'
import { loadFontBytes } from '../engine/fonts'
import { embedImage } from '../engine/image'
import {
  drawCardRow, drawCentered, drawChecklist, drawLineTable, drawMeta, drawParagraphs, drawParties,
  drawPhotoGrid, drawSectionTitle, flexWidth, setupChrome, signatureCard,
} from '../engine/layout'

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
  return new Date(`${date}T00:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}

function formatTimes(intervention: Intervention): string {
  const hm = (t: string) => { const [h, m] = t.slice(0, 5).split(':'); return `${Number(h)} h ${m}` }
  const parts: string[] = []
  if (intervention.start_time) parts.push(hm(intervention.start_time))
  if (intervention.end_time) parts.push(hm(intervention.end_time))
  const range = parts.length ? parts.join(' à ') : '-'
  return intervention.duration_hours ? `${range} · ${intervention.duration_hours.toLocaleString('fr-FR')} h` : range
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

  // En-tête réduit au logo : coordonnées de l'entreprise dans le pied de page.
  setupChrome(doc, {
    title: "Rapport d'intervention",
    reference: intervention.contract?.title ?? "Intervention d'entretien",
    logo: logoImg,
    orgName: organization.name,
    footerLines: [
      [organization.name, [organization.address_line1, organization.postal_code, organization.city].filter(Boolean).join(', ')].filter(Boolean).join(' · '),
      [organization.email, organization.phone].filter(Boolean).join(' · '),
    ].map(l => pdfText(l)).filter(Boolean),
  })
  doc.addPage()

  drawMeta(doc, [
    { label: 'Date', value: formatDate(intervention.date_intervention) },
    { label: 'Horaires', value: formatTimes(intervention) },
    { label: 'Intervenant', value: intervenantName },
  ])

  const siteAddress = [
    contract?.site_address_line1 ?? chantier?.address_line1 ?? client?.address_line1,
    contract?.site_postal_code ?? chantier?.postal_code ?? client?.postal_code,
    contract?.site_city ?? chantier?.city ?? client?.city,
  ].filter(Boolean).join(', ')
  const siteContact = [contract?.site_contact_name, contract?.site_contact_phone, contract?.site_contact_email].filter(Boolean).join(', ')
  drawParties(doc,
    {
      label: 'Client',
      name: clientName,
      lines: [
        client ? [client.address_line1, [client.postal_code, client.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '',
        contract?.title ? `Contrat : ${contract.title}` : '',
      ],
    },
    {
      label: 'Site',
      name: contract?.site_name ?? chantier?.title ?? intervention.contract?.title ?? '-',
      lines: [siteAddress, siteContact ? `Contact : ${siteContact}` : ''],
    },
  )

  // ── Équipements ──
  if (contract?.equipements?.length) {
    drawSectionTitle(doc, 'Équipements')
    drawLineTable(doc, [
      { header: 'Équipement', width: flexWidth([120, 135]) },
      { header: 'Référence', width: 120, align: 'left' },
      { header: 'Localisation', width: 135, align: 'left' },
    ], contract.equipements.map(eq => ({ cells: [pdfText(eq.nom), pdfText(eq.ref ?? ''), pdfText(eq.localisation ?? '')] })), { marginTop: 4.5, tight: true })
  }

  // ── Opérations réalisées : une liste cochée si le rapport est écrit ligne à ligne ──
  drawSectionTitle(doc, 'Opérations réalisées')
  const operations = (intervention.rapport ?? '').split(/\r?\n/).map(l => l.replace(/^\s*[-•*]\s*/, '').trim()).filter(Boolean)
  if (operations.length >= 2) drawChecklist(doc, operations.map(text => ({ text })))
  else drawParagraphs(doc, intervention.rapport || '-')

  // ── Observations ──
  drawCentered(doc, 'Observations et recommandations', intervention.observations || '-', { marginTop: 18 })

  // ── Photos ──
  if (reportPhotos.length > 0) {
    drawSectionTitle(doc, `Photos de l'intervention (${reportPhotos.length})`)
    const images = await Promise.all(reportPhotos.map(p => embedImage(doc.doc, p.url)))
    drawPhotoGrid(doc, reportPhotos.map((p, i) => ({ image: images[i], title: p.title ?? `Photo ${i + 1}`, caption: p.caption })))
  }

  // ── Signatures, en bas de la dernière page ──
  drawCardRow(doc, [
    signatureCard(doc, "L'intervenant", 'Date et signature', { lines: [intervenantName] }),
    signatureCard(doc, 'Le client', 'Date et signature', { lines: [clientName] }),
  ], { pin: true, marginTop: 18 })

  return doc.save()
}
