import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { hasPermission } from '@/lib/data/queries/membership'

export const dynamic = 'force-dynamic'

const BRIEF_TTL_DAYS = 7

// GET /api/sarah/briefs?target=chloe — retourne le brief pending le plus récent pour un assistant cible
export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get('target')
  if (!target || !['chloe', 'nora', 'marco'].includes(target)) return NextResponse.json({ brief: null })

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return NextResponse.json({ brief: null })
  if (!await hasPermission('ai.sarah')) {
    return NextResponse.json({ error: 'permission_denied', code: 'permission_denied' }, { status: 403 })
  }

  const supabase = await createClient()
  const cutoff = new Date(Date.now() - BRIEF_TTL_DAYS * 86400000).toISOString()
  const now = new Date().toISOString()

  const { data } = await supabase
    .from('ai_briefs')
    .select('id, source_assistant, payload, created_at')
    .eq('organization_id', orgId)
    .eq('target_assistant', target)
    .eq('status', 'pending')
    .gte('created_at', cutoff)
    .or(`expires_at.is.null,expires_at.gte.${now}`)
    .order('created_at', { ascending: false })
    .limit(1)

  if (!data?.length) return NextResponse.json({ brief: null })
  return NextResponse.json({ brief: data[0] })
}

// POST /api/sarah/briefs/consume — marque un brief comme consommé
export async function POST(req: NextRequest) {
  const { briefId } = await req.json()
  if (!briefId) return NextResponse.json({ ok: false })

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return NextResponse.json({ ok: false })
  if (!await hasPermission('ai.sarah')) {
    return NextResponse.json({ error: 'permission_denied', code: 'permission_denied' }, { status: 403 })
  }

  const supabase = await createClient()
  await supabase
    .from('ai_briefs')
    .update({ status: 'consumed', consumed_at: new Date().toISOString() })
    .eq('id', briefId)
    .eq('organization_id', orgId)
    .eq('status', 'pending')

  return NextResponse.json({ ok: true })
}
