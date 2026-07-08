import { NextResponse } from 'next/server'
import { renderToStream } from '@react-pdf/renderer'
import React from 'react'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { getOrganization } from '@/lib/data/queries/organization'
import { getTourneeRoute } from '@/lib/data/mutations/planning'
import { estimateTravelMin } from '@/app/(app)/chantiers/planning/TourneeOptimizer'
import { TourneePDF } from '@/components/pdf/TourneePDF'
import type { TourneeSlot } from '@/lib/data/queries/chantiers'
import { isValidUuid } from '@/lib/security'

function colorIdx(id: string): number {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff
  return Math.abs(h) % 12
}

export async function GET(
  req: Request,
  { params }: { params: { routeId: string } },
) {
  if (!isValidUuid(params.routeId)) return new NextResponse('Tournée introuvable', { status: 404 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Non authentifié', { status: 401 })

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return new NextResponse('Organisation introuvable', { status: 403 })

  const url = new URL(req.url)
  const download = url.searchParams.get('download') === '1'

  // Fetch slots de la route avec join chantiers (vérification org via organization_id)
  const { data: rows, error } = await supabase
    .from('chantier_plannings')
    .select(`
      id, chantier_id, planned_date, start_time, end_time,
      equipe_id, member_id, label, team_size, notes, created_at,
      route_id, route_order, duration_min, travel_from_prev_min,
      chantier:chantiers!inner(title, city, status, organization_id, address_line1, postal_code)
    `)
    .eq('route_id', params.routeId)
    .order('route_order', { ascending: true })

  if (error) return new NextResponse('Erreur serveur', { status: 500 })
  if (!rows?.length) return new NextResponse('Tournée introuvable', { status: 404 })

  // Vérifier org ownership
  const firstRow = rows[0] as any
  if (firstRow.chantier?.organization_id !== orgId) {
    return new NextResponse('Non autorisé', { status: 403 })
  }

  const organization = await getOrganization()
  if (!organization) return new NextResponse('Organisation introuvable', { status: 500 })

  const tourneeRoute = await getTourneeRoute(params.routeId)

  const slots: TourneeSlot[] = rows.map((row: any) => ({
    id: row.id,
    chantier_id: row.chantier_id,
    planned_date: row.planned_date,
    start_time: row.start_time,
    end_time: row.end_time,
    equipe_id: row.equipe_id,
    member_id: row.member_id,
    label: row.label,
    team_size: row.team_size,
    notes: row.notes,
    created_at: row.created_at,
    route_id: row.route_id,
    route_order: row.route_order,
    duration_min: row.duration_min,
    travel_from_prev_min: row.travel_from_prev_min,
    arrived_at: null,
    chantier_title: row.chantier?.title ?? '-',
    chantier_city: row.chantier?.city ?? null,
    chantier_status: row.chantier?.status ?? 'planifie',
    chantier_color_idx: colorIdx(row.chantier_id),
    chantier_address_line1: row.chantier?.address_line1 ?? null,
    chantier_postal_code: row.chantier?.postal_code ?? null,
  }))

  const date = slots[0].planned_date

  // Si les trajets ne sont pas renseignés en base (tournée créée sans optimisation),
  // les recalculer à la volée depuis les codes postaux pour le PDF.
  const departureForCalc = tourneeRoute?.departure_postal_code ?? organization.departure_postal_code ?? null
  const slotsWithTravel = slots.map((slot, i) => {
    if (slot.travel_from_prev_min != null) return slot
    if (i === 0) {
      if (!departureForCalc) return slot
      return {
        ...slot,
        travel_from_prev_min: estimateTravelMin(
          { id: 'departure', postal_code: departureForCalc },
          { id: slot.id, postal_code: slot.chantier_postal_code, city: slot.chantier_city, address_line1: slot.chantier_address_line1 },
        ),
      }
    }
    const prev = slots[i - 1]
    if (!prev.chantier_postal_code && !prev.chantier_city) return slot
    return {
      ...slot,
      travel_from_prev_min: estimateTravelMin(
        { id: prev.id, postal_code: prev.chantier_postal_code, city: prev.chantier_city, address_line1: prev.chantier_address_line1 },
        { id: slot.id, postal_code: slot.chantier_postal_code, city: slot.chantier_city, address_line1: slot.chantier_address_line1 },
      ),
    }
  })

  const totalSiteMin = slotsWithTravel.reduce((s, sl) => s + (sl.duration_min ?? 0), 0)
  const totalTravelMin = slotsWithTravel.reduce((s, sl) => s + (sl.travel_from_prev_min ?? 0), 0)

  // Nom de la tournée : équipe d'abord, sinon label brut (évite d'afficher un nom propre)
  const firstSlot = rows[0] as any
  let routeLabel = 'Tournée'
  if (firstSlot.equipe_id) {
    const { data: equipe } = await supabase
      .from('chantier_equipes')
      .select('name')
      .eq('id', firstSlot.equipe_id)
      .single()
    if (equipe?.name) routeLabel = equipe.name
  } else {
    // label peut contenir un nom de membre — on affiche le label tel quel
    // mais on préfixe "Tournée du" pour rendre le contexte clair dans le PDF
    const rawLabel = firstSlot.label ?? null
    if (rawLabel && rawLabel !== 'Equipe' && rawLabel !== 'Équipe') {
      routeLabel = rawLabel
    }
  }

  const departureAddress = tourneeRoute?.departure_address ?? organization.departure_address ?? null
  const departurePostalCode = tourneeRoute?.departure_postal_code ?? organization.departure_postal_code ?? null
  const departureCity = tourneeRoute?.departure_city ?? organization.departure_city ?? null

  const stream = await renderToStream(
    React.createElement(TourneePDF, {
      organization: {
        name: organization.name,
        email: organization.email,
        phone: organization.phone,
        siret: organization.siret,
        logo_url: organization.logo_url,
        address_line1: organization.address_line1,
        postal_code: organization.postal_code,
        city: organization.city,
      },
      slots: slotsWithTravel,
      date,
      routeLabel,
      totalSiteMin,
      totalTravelMin,
      departureAddress,
      departurePostalCode,
      departureCity,
    }) as any,
  )

  const safeLabel = routeLabel.replace(/[^a-z0-9]/gi, '-').toLowerCase()
  const fileName = `tournee-${date}-${safeLabel}.pdf`

  return new NextResponse(stream as unknown as ReadableStream, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': download
        ? `attachment; filename="${fileName}"`
        : `inline; filename="${fileName}"`,
    },
  })
}
