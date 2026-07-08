import { NextResponse } from 'next/server'
import { renderToStream } from '@react-pdf/renderer'
import React from 'react'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { getOrganization } from '@/lib/data/queries/organization'
import MaintenanceInterventionPDF from '@/components/pdf/MaintenanceInterventionPDF'
import type { MaintenanceReportPhoto } from '@/components/pdf/MaintenanceInterventionPDF'
import { assertSafeExternalFetchUrl, isValidUuid } from '@/lib/security'

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

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  if (!isValidUuid(params.id)) return new NextResponse('Intervention introuvable', { status: 404 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Non authentifié', { status: 401 })

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return new NextResponse('Organisation introuvable', { status: 403 })

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
      .eq('id', params.id)
      .eq('organization_id', orgId)
      .single(),
    getOrganization(),
  ])

  if (interventionRes.error || !interventionRes.data) {
    return new NextResponse('Intervention introuvable', { status: 404 })
  }
  if (!organization) return new NextResponse('Organisation introuvable', { status: 500 })

  const intervention = normalizeIntervention(interventionRes.data)
  const [logoDataUrl, reportPhotos] = await Promise.all([
    fetchAsDataUrl(organization.logo_url),
    loadInterventionPhotos(supabase, params.id),
  ])
  const orgWithLogo = { ...organization, logo_url: logoDataUrl ?? organization.logo_url }
  const url = new URL(req.url)
  const download = url.searchParams.get('download') === '1'
  const stream = await renderToStream(
    React.createElement(MaintenanceInterventionPDF, { intervention, organization: orgWithLogo, reportPhotos }) as any,
  )

  const fileName = `rapport-intervention-${params.id.slice(0, 8)}.pdf`
  return new NextResponse(stream as unknown as ReadableStream, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': download
        ? `attachment; filename="${fileName}"`
        : `inline; filename="${fileName}"`,
    },
  })
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
    const signedUrl = urlMap.get(row.storage_path)
    const dataUrl = await fetchAsDataUrl(signedUrl ?? null)
    if (!dataUrl) return null
    return {
      id: row.id,
      url: dataUrl,
      title: row.title ?? null,
      caption: row.caption ?? null,
    }
  }))

  return photos.filter((photo): photo is MaintenanceReportPhoto => photo !== null)
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
