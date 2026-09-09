import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { hasPermission } from '@/lib/data/queries/membership'
import { syncUsageLogToOperator } from '@/lib/ai/callAI'
import { getOperatorSourceInstance } from '@/lib/operator'

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
    const occurredAt = new Date().toISOString()
    // provider_cost reste null : il n'existe aucune grille de prix ElevenLabs
    // dans le repo (contrairement à OpenRouter, qui la renvoie lui-même via
    // usage.cost). Faire remonter le volume au cockpit vaut mieux que de ne
    // rien synchroniser du tout, comme c'était le cas jusqu'ici — mais un
    // coût inventé serait pire que 0 € affiché : traiter le coût à part.
    const { data: inserted, error: insertError } = await admin
      .from('usage_logs')
      .insert({
        organization_id: orgId,
        provider: 'elevenlabs',
        feature: 'voice_live',
        model: 'elevenlabs_convai',
        input_kind: 'audio',
        status: 'success',
        provider_cost: null,
        currency: 'USD',
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
      .select('id')
      .single()

    if (insertError) {
      console.error('[elevenlabs/session-end.insert]', insertError)
    }

    // Best effort, comme callAI : ne jamais bloquer la réponse métier sur le
    // cockpit opérateur.
    void syncUsageLogToOperator(inserted?.id ?? null, {
      source_instance: getOperatorSourceInstance(),
      organization_id: orgId,
      occurred_at: occurredAt,
      provider: 'elevenlabs',
      feature: 'voice_live',
      model: 'elevenlabs_convai',
      provider_cost: null,
      currency: 'USD',
      total_tokens: null,
      status: 'success',
      quota_feature: 'voice_live_minutes',
      quota_unit: 'minute',
      quota_quantity: durationMinutes,
      over_quota: false,
    })

    return NextResponse.json({ ok: true, minutes_charged: durationMinutes })
  } catch (err) {
    console.error('[elevenlabs/session-end]', err)
    return NextResponse.json({ error: 'server_error', code: 'server_error' }, { status: 500 })
  }
}
