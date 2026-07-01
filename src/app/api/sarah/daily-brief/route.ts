import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { hasPermission } from '@/lib/data/queries/membership'
import { todayParis } from '@/lib/utils'

export const dynamic = 'force-dynamic'

// GET /api/sarah/daily-brief
// Retourne le brief du jour s'il existe et n'a pas encore été lu.
// Utilisé par le badge Sarah (AppShell) et par sarah-secretary/route.ts au premier message.

export async function GET() {
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return NextResponse.json({ brief: null })
  if (!await hasPermission('ai.sarah')) {
    return NextResponse.json({ error: 'permission_denied', code: 'permission_denied' }, { status: 403 })
  }

  const supabase = await createClient()
  const today = todayParis()

  const { data } = await supabase
    .from('company_memory')
    .select('id, content, metadata, created_at')
    .eq('organization_id', orgId)
    .eq('type', 'daily_brief')
    .eq('metadata->>date', today)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)

  if (!data?.length) return NextResponse.json({ brief: null })

  const brief = data[0]
  const isRead = brief.metadata?.read === true

  return NextResponse.json({
    brief: {
      id: brief.id,
      content: brief.content,
      date: today,
      read: isRead,
    },
  })
}

// POST /api/sarah/daily-brief — marque le brief du jour comme lu
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
    .from('company_memory')
    .update({ metadata: { date: todayParis(), read: true } })
    .eq('id', briefId)
    .eq('organization_id', orgId)
    .eq('type', 'daily_brief')

  return NextResponse.json({ ok: true })
}
