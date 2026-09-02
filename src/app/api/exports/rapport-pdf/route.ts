import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  getMonthlyReport,
  getAnnualReport,
  getHoursReport,
  getTopClients,
  getTopChantiers,
  getAnnualObjectives,
  getMonthlyObjectives,
} from '@/lib/data/queries/reporting'
import { renderRapportKpiPdf } from '@/lib/pdf/documents/rapport-kpi'
import { assertSafeExternalFetchUrl } from '@/lib/security'

function pdfOrigin(): string {
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin) throw new Error('NEXT_PUBLIC_APP_URL manquant — requis pour charger les polices PDF')
  return origin
}

export const dynamic = 'force-dynamic'

async function fetchLogoAsDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null
  const safeUrl = assertSafeExternalFetchUrl(url)
  if (!safeUrl) return null
  try {
    const res = await fetch(safeUrl, { signal: AbortSignal.timeout(5_000) })
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    const ct = res.headers.get('content-type') ?? 'image/png'
    if (ct.includes('svg')) return null
    return `data:${ct};base64,${Buffer.from(buf).toString('base64')}`
  } catch {
    return null
  }
}

function monthLabelForFileName(month: number): string | null {
  switch (month) {
    case 1: return 'Janvier'
    case 2: return 'Février'
    case 3: return 'Mars'
    case 4: return 'Avril'
    case 5: return 'Mai'
    case 6: return 'Juin'
    case 7: return 'Juillet'
    case 8: return 'Août'
    case 9: return 'Septembre'
    case 10: return 'Octobre'
    case 11: return 'Novembre'
    case 12: return 'Décembre'
    default: return null
  }
}

export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Non authentifié', { status: 401 })

  // Récupérer l'org directement sans React cache() (incompatible avec Route Handlers)
  const { data: membership } = await supabase
    .from('memberships')
    .select('organization_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single()

  const orgId = membership?.organization_id
  if (!orgId) return new NextResponse('Organisation introuvable', { status: 403 })

  // Vérifier les permissions directement
  const { data: permRows } = await supabase
    .from('role_permissions')
    .select('permission_key, roles!inner(memberships!inner(user_id, is_active))')
    .eq('roles.memberships.user_id', user.id)
    .eq('roles.memberships.is_active', true)

  const permSet = new Set((permRows ?? []).map((r: any) => r.permission_key as string))

  // L'owner a accès à tout — vérifier le role slug
  const { data: membershipRole } = await supabase
    .from('memberships')
    .select('roles(slug)')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single()

  const roleSlug = (membershipRole?.roles as any)?.slug ?? null
  const isOwner = roleSlug === 'owner'

  if (!isOwner && !permSet.has('*') && !permSet.has('dashboard.view_ca')) {
    return new NextResponse('Accès refusé', { status: 403 })
  }

  const url = new URL(req.url)
  const vue = url.searchParams.get('vue') === 'annee' ? 'annee' : 'mois'
  const periode = url.searchParams.get('periode') ?? ''

  let year = new Date().getFullYear()
  let month = new Date().getMonth() + 1

  if (vue === 'mois' && /^\d{4}-\d{2}$/.test(periode)) {
    const [y, m] = periode.split('-').map(Number)
    year = y; month = m
  } else if (vue === 'annee' && /^\d{4}$/.test(periode)) {
    year = parseInt(periode)
  }

  const monthLabel = monthLabelForFileName(month)
  if (vue === 'mois' && !monthLabel) {
    return new NextResponse('Mois invalide', { status: 400 })
  }

  const { data: orgData } = await supabase
    .from('organizations')
    .select('id, name, slug, siret, siren, vat_number, email, phone, address_line1, address_line2, city, postal_code, country, logo_url, is_vat_subject, default_vat_rate, primary_color, iban, bic, payment_terms_days, signatory_name, signatory_role, signature_image')
    .eq('id', orgId)
    .single()

  if (!orgData) return new NextResponse('Organisation introuvable', { status: 500 })

  const [monthlyReport, annualReport, hoursReport, topClients, topChantiers, objectives] = await Promise.all([
    vue === 'mois' ? getMonthlyReport(year, month) : Promise.resolve(null),
    vue === 'annee' ? getAnnualReport(year) : Promise.resolve(null),
    getHoursReport(year, vue === 'mois' ? month : undefined),
    getTopClients(year, vue === 'mois' ? month : undefined),
    getTopChantiers(year, vue === 'mois' ? month : undefined),
    vue === 'mois' ? getMonthlyObjectives(year, month) : getAnnualObjectives(year),
  ])

  const logoDataUrl = await fetchLogoAsDataUrl(orgData.logo_url)
  const orgWithLogo = { ...orgData, logo_url: logoDataUrl ?? orgData.logo_url }

  const fileName = vue === 'mois'
    ? `rapport-${monthLabel}-${year}.pdf`
    : `rapport-annuel-${year}.pdf`

  let buffer: Buffer
  try {
    buffer = await renderRapportKpiPdf({
      vue, year, month,
      organization: orgWithLogo as any,
      monthlyReport,
      annualReport,
      hoursReport,
      topClients,
      topChantiers,
      objectives,
    }, pdfOrigin())
  } catch (e) {
    console.error('[exports/rapport-pdf] renderRapportKpiPdf error:', e)
    return new NextResponse(`Erreur génération PDF: ${e instanceof Error ? e.message : String(e)}`, { status: 500 })
  }

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Cache-Control': 'no-store, max-age=0',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    },
  })
}
