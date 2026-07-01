import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { hasPermission } from '@/lib/data/queries/membership'

export const dynamic = 'force-dynamic'

const MAX_SESSION_SECONDS = 15 * 60 // 15 min — plafond de sécurité anti-abus

export async function POST(req: NextRequest) {
  try {
    const orgId = await getCurrentOrganizationId()
    if (!orgId) {
      return NextResponse.json({ error: 'unauthenticated', code: 'unauthenticated' }, { status: 401 })
    }

    const aiAllowed = await hasPermission('ai.sarah')
    if (!aiAllowed) {
      return NextResponse.json({ error: 'permission_denied', code: 'permission_denied' }, { status: 403 })
    }

    const body = await req.json()
    const rawDuration = Number(body?.duration_seconds ?? 0)
    const durationSeconds = Math.min(Math.max(0, rawDuration), MAX_SESSION_SECONDS)
    const durationMinutes = Math.ceil(durationSeconds / 60)

    if (durationMinutes <= 0) {
      return NextResponse.json({ ok: true, minutes_charged: 0 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const admin = createAdminClient()
    await admin.from('usage_logs').insert({
      organization_id: orgId,
      provider: 'elevenlabs',
      feature: 'voice_live',
      model: 'elevenlabs_convai',
      input_kind: 'audio',
      status: 'success',
      quota_feature: 'voice_live_minutes',
      quota_unit: 'minute',
      quota_quantity: durationMinutes,
      over_quota: false,
      metadata: {
        event: 'session_end',
        duration_seconds: durationSeconds,
        user_id: user?.id ?? null,
      },
    })

    return NextResponse.json({ ok: true, minutes_charged: durationMinutes })
  } catch (err) {
    console.error('[elevenlabs/session-end]', err)
    return NextResponse.json({ error: 'server_error', code: 'server_error' }, { status: 500 })
  }
}
