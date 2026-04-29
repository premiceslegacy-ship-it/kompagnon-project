import { NextResponse } from 'next/server'
import React from 'react'
import { renderToStream } from '@react-pdf/renderer'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { createAdminClient } from '@/lib/supabase/admin'
import MemberHoursReportPDF from '@/components/pdf/MemberHoursReportPDF'
import type { IndividualMember } from '@/lib/data/queries/members'
import type { MemberPointage } from '@/lib/data/queries/members'

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Non authentifié', { status: 401 })

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return new NextResponse('Organisation introuvable', { status: 403 })

  const url = new URL(req.url)
  const dateFrom = url.searchParams.get('from') ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)
  const dateTo   = url.searchParams.get('to')   ?? new Date().toISOString().slice(0, 10)
  const download = url.searchParams.get('download') === '1'
  // ?type=user pour les membres auth (user_id), par défaut member (fantôme)
  const idType   = url.searchParams.get('type') ?? 'member'

  const admin = createAdminClient()

  const orgResult = await admin
    .from('organizations')
    .select('name, logo_url, address_line1, postal_code, city')
    .eq('id', orgId)
    .single()

  if (!orgResult.data) {
    return new NextResponse('Organisation introuvable', { status: 404 })
  }

  let member: IndividualMember | null = null
  let pointages: MemberPointage[] = []

  if (idType === 'user') {
    // Membre auth : chercher dans profiles + memberships pour le nom et taux
    const [profileRes, membershipRes] = await Promise.all([
      admin.from('profiles').select('id, full_name').eq('id', params.id).maybeSingle(),
      admin.from('memberships')
        .select('id, labor_cost_per_hour, roles(name)')
        .eq('user_id', params.id)
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle(),
    ])

    if (!profileRes.data) {
      return new NextResponse('Membre introuvable', { status: 404 })
    }

    const fullName = profileRes.data.full_name ?? 'Membre'
    const parts = fullName.trim().split(/\s+/)
    const roleLabel = (membershipRes.data?.roles as any)?.name ?? null
    member = {
      id: params.id,
      organization_id: orgId,
      equipe_id: null,
      prenom: parts.length > 1 ? parts[0] : null,
      name: parts.length > 1 ? parts.slice(1).join(' ') : fullName,
      email: null,
      role_label: roleLabel,
      taux_horaire: membershipRes.data?.labor_cost_per_hour ?? null,
      profile_id: params.id,
      created_at: '',
    }

    // Pointages via user_id
    let q = admin
      .from('chantier_pointages')
      .select(`
        id, chantier_id, tache_id, date, hours, start_time, description,
        chantiers!inner ( title ),
        chantier_taches ( title )
      `)
      .eq('user_id', params.id)
      .order('date', { ascending: false })

    if (dateFrom) q = q.gte('date', dateFrom)
    if (dateTo)   q = q.lte('date', dateTo)

    const { data: rows } = await q
    pointages = (rows ?? []).map((r: any) => ({
      id:             r.id,
      chantier_id:    r.chantier_id,
      chantier_title: r.chantiers?.title ?? '',
      tache_id:       r.tache_id,
      tache_title:    r.chantier_taches?.title ?? null,
      date:           r.date,
      hours:          Number(r.hours),
      start_time:     r.start_time,
      description:    r.description,
    }))
  } else {
    // Membre fantôme : chercher dans chantier_equipe_membres par id
    const { data: memberRow } = await admin
      .from('chantier_equipe_membres')
      .select('id, organization_id, equipe_id, prenom, name, email, role_label, taux_horaire, profile_id, created_at')
      .eq('id', params.id)
      .single()

    if (!memberRow || memberRow.organization_id !== orgId) {
      return new NextResponse('Membre introuvable', { status: 404 })
    }

    member = memberRow as IndividualMember

    let q = admin
      .from('chantier_pointages')
      .select(`
        id, chantier_id, tache_id, date, hours, start_time, description,
        chantiers!inner ( title ),
        chantier_taches ( title )
      `)
      .eq('member_id', params.id)
      .order('date', { ascending: false })

    if (dateFrom) q = q.gte('date', dateFrom)
    if (dateTo)   q = q.lte('date', dateTo)

    const { data: rows } = await q
    pointages = (rows ?? []).map((r: any) => ({
      id:             r.id,
      chantier_id:    r.chantier_id,
      chantier_title: r.chantiers?.title ?? '',
      tache_id:       r.tache_id,
      tache_title:    r.chantier_taches?.title ?? null,
      date:           r.date,
      hours:          Number(r.hours),
      start_time:     r.start_time,
      description:    r.description,
    }))
  }

  const totalHours = pointages.reduce((s, p) => s + p.hours, 0)

  let stream: NodeJS.ReadableStream
  try {
    stream = await renderToStream(
      React.createElement(MemberHoursReportPDF as any, {
        member,
        organization: orgResult.data,
        pointages,
        periodFrom: dateFrom,
        periodTo: dateTo,
        totalHours,
      }) as any,
    )
  } catch (e) {
    console.error('[pdf/member] renderToStream error:', e)
    return new NextResponse(`Erreur génération PDF: ${e instanceof Error ? e.message : String(e)}`, { status: 500 })
  }

  const memberSlug = [member.prenom, member.name].filter(Boolean).join('-').toLowerCase().replace(/[^a-z0-9-]/gi, '-')
  const fileName = `rapport-heures-${memberSlug}-${dateFrom}-${dateTo}.pdf`

  return new NextResponse(stream as unknown as ReadableStream, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': download
        ? `attachment; filename="${fileName}"`
        : `inline; filename="${fileName}"`,
    },
  })
}
