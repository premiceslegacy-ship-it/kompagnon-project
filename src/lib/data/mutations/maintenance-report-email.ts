'use server'

import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { getOrganization } from '@/lib/data/queries/organization'
import { hasPermission } from '@/lib/data/queries/membership'
import { sendEmail } from '@/lib/email'
import { renderEmailShell, renderInfoBox, escHtml } from '@/lib/email/layout'
import { assertSafeExternalFetchUrl } from '@/lib/security'
import MaintenanceInterventionPDF from '@/components/pdf/MaintenanceInterventionPDF'
import type { MaintenanceReportPhoto } from '@/components/pdf/MaintenanceInterventionPDF'

export async function sendMaintenanceInterventionReportEmail(
  interventionId: string,
): Promise<{ error: string | null; recipient?: string }> {
  if (!(await hasPermission('chantiers.edit'))) return { error: 'Action non autorisée.' }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }

  const supabase = await createClient()
  const [interventionRes, organization] = await Promise.all([
    supabase
      .from('maintenance_interventions')
      .select(`
        id, date_intervention, statut, start_time, end_time, duration_hours,
        rapport, observations, billable_notes, cost_parts_ht, cost_travel_ht,
        cost_other_ht, billable_amount_ht,
        intervenant:chantier_equipe_membres!maintenance_interventions_intervenant_member_id_fkey(id, prenom, name),
        intervenant_profile:profiles!maintenance_interventions_intervenant_user_id_fkey(id, full_name, email),
        invoice:invoices(id, number, status),
        contract:maintenance_contracts!inner(
          id, title, frequence, equipements, organization_id,
          site_name, site_contact_name, site_contact_email, site_contact_phone,
          site_address_line1, site_postal_code, site_city,
          client:clients(company_name, first_name, last_name, email, address_line1, postal_code, city),
          chantier:chantiers!maintenance_contracts_chantier_id_fkey(title, address_line1, postal_code, city)
        )
      `)
      .eq('id', interventionId)
      .eq('organization_id', orgId)
      .single(),
    getOrganization(),
  ])

  if (interventionRes.error || !interventionRes.data) return { error: 'Intervention introuvable.' }
  if (!organization) return { error: 'Organisation introuvable.' }

  const intervention = normalizeIntervention(interventionRes.data)
  const contract = intervention.contract
  const recipient = contract?.site_contact_email || contract?.client?.email
  if (!recipient) return { error: "Aucune adresse email trouvée. Ajoutez un email de contact site ou un email client." }

  const [logoDataUrl, reportPhotos] = await Promise.all([
    fetchAsDataUrl(organization.logo_url),
    loadInterventionPhotos(supabase, interventionId),
  ])
  const orgWithLogo = { ...organization, logo_url: logoDataUrl ?? organization.logo_url }

  const pdfBuffer: Buffer = await renderToBuffer(
    React.createElement(MaintenanceInterventionPDF, {
      intervention,
      organization: orgWithLogo,
      reportPhotos,
    }) as any,
  )

  const fileName = `rapport-intervention-${interventionId.slice(0, 8)}.pdf`
  const subject = `Rapport d'intervention : ${contract?.title ?? 'Entretien'}`
  const recipientName = contract?.site_contact_name || contract?.client?.company_name || [contract?.client?.first_name, contract?.client?.last_name].filter(Boolean).join(' ') || null
  const html = buildEmailHtml({
    recipientName,
    contractTitle: contract?.title ?? 'Intervention entretien',
    date: formatDate(intervention.date_intervention),
    orgName: organization.name,
    orgEmail: organization.email ?? null,
  })

  const { error } = await sendEmail({
    organizationId: orgId,
    to: recipient,
    subject,
    html,
    attachments: [{ filename: fileName, content: pdfBuffer }],
  })

  if (error) return { error }
  return { error: null, recipient }
}

function normalizeIntervention(row: any) {
  const contract = Array.isArray(row.contract) ? row.contract[0] : row.contract
  return {
    ...row,
    intervenant: Array.isArray(row.intervenant) ? row.intervenant[0] : row.intervenant,
    intervenant_profile: Array.isArray(row.intervenant_profile) ? row.intervenant_profile[0] : row.intervenant_profile,
    invoice: Array.isArray(row.invoice) ? row.invoice[0] : row.invoice,
    contract: contract
      ? {
          ...contract,
          equipements: Array.isArray(contract.equipements) ? contract.equipements : [],
          client: Array.isArray(contract.client) ? contract.client[0] : contract.client,
          chantier: Array.isArray(contract.chantier) ? contract.chantier[0] : contract.chantier,
        }
      : null,
  }
}

async function loadInterventionPhotos(
  supabase: Awaited<ReturnType<typeof createClient>>,
  interventionId: string,
): Promise<MaintenanceReportPhoto[]> {
  const { data: photoRows } = await supabase
    .from('chantier_photos')
    .select('id, storage_path, title, caption')
    .eq('maintenance_intervention_id', interventionId)
    .order('created_at', { ascending: true })

  if (!photoRows?.length) return []

  const paths = photoRows.map(row => row.storage_path as string)
  const { data: signedUrls } = await supabase.storage.from('chantier-photos').createSignedUrls(paths, 3600)
  const urlMap = new Map<string, string>()
  signedUrls?.forEach(item => { if (item.signedUrl && item.path) urlMap.set(item.path, item.signedUrl) })

  const photos = await Promise.all(photoRows.map(async row => {
    const dataUrl = await fetchAsDataUrl(urlMap.get(row.storage_path) ?? null)
    if (!dataUrl) return null
    return { id: row.id, url: dataUrl, title: row.title ?? null, caption: row.caption ?? null }
  }))

  return photos.filter((photo): photo is MaintenanceReportPhoto => photo !== null)
}

async function fetchAsDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null
  const safeUrl = assertSafeExternalFetchUrl(url)
  if (!safeUrl) return null
  try {
    const res = await fetch(safeUrl)
    if (!res.ok) return null
    const buffer = await res.arrayBuffer()
    const mime = res.headers.get('content-type') ?? 'image/jpeg'
    return `data:${mime};base64,${Buffer.from(buffer).toString('base64')}`
  } catch {
    return null
  }
}

function formatDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
}

function buildEmailHtml(ctx: {
  recipientName: string | null
  contractTitle: string
  date: string
  orgName: string
  orgEmail: string | null
}) {
  const contactLine = ctx.orgEmail
    ? `<p style="margin:14px 0 0;font-size:13px;color:#555555;line-height:1.5;font-family:'Inter',sans-serif;">Pour toute question, n'hésitez pas à nous contacter à <a href="mailto:${escHtml(ctx.orgEmail)}" style="color:#FF9F1C;">${escHtml(ctx.orgEmail)}</a>.</p>`
    : ''
  const body = `
<p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#A1A1AA;text-transform:uppercase;letter-spacing:0.8px;font-family:'Inter',sans-serif;">Rapport d'intervention</p>
<h1 style="margin:0 0 12px;font-size:22px;font-weight:800;color:#FFFFFF;line-height:1.3;font-family:'Plus Jakarta Sans',sans-serif;">
  Bonjour${ctx.recipientName ? ' ' + escHtml(ctx.recipientName) : ''},
</h1>
<p style="margin:0 0 24px;font-size:15px;color:#A1A1AA;line-height:1.6;font-family:'Inter',sans-serif;">
  Vous trouverez en pièce jointe le rapport de l'intervention réalisée le ${escHtml(ctx.date)}. Il reprend les travaux effectués, les observations éventuelles et les photos associées lorsqu'elles sont disponibles.
</p>
${renderInfoBox([{ label: 'Contrat', value: escHtml(ctx.contractTitle), large: true }])}
<p style="margin:0;font-size:13px;color:#555555;line-height:1.5;font-family:'Inter',sans-serif;">Le rapport complet est joint en PDF.</p>
${contactLine}`

  return renderEmailShell({
    title: `Rapport d'intervention : ${ctx.contractTitle}`,
    headerName: ctx.orgName,
    bodyHtml: body,
  })
}
