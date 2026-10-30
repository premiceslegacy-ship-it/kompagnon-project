import { NextRequest, NextResponse } from 'next/server'
import { hasOperatorMasterSecret, readOperatorRequest } from '@/lib/operator'
import { recordOperatorClientEvent } from '@/lib/operator/trial-lifecycle'
import { createOperatorAdminClient, isOperatorModeEnabled } from '@/lib/supabase/operator'
import { isSellableTier, type SellableTier } from '@/lib/subscription-access'

type SignupPayload = {
  source_instance: string
  organization_id: string
  app_url: string
  contact_email: string
  full_name?: string | null
  preferred_tier: SellableTier
  signup_source?: string
}

function isValidPayload(value: unknown): value is SignupPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return typeof row.source_instance === 'string'
    && typeof row.organization_id === 'string'
    && typeof row.app_url === 'string'
    && typeof row.contact_email === 'string'
    && (row.full_name === undefined || row.full_name === null || typeof row.full_name === 'string')
    && isSellableTier(row.preferred_tier)
    && (row.signup_source === undefined || typeof row.signup_source === 'string')
}

export async function POST(req: NextRequest) {
  if (!isOperatorModeEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!hasOperatorMasterSecret()) return NextResponse.json({ error: 'Operator secret missing' }, { status: 500 })

  const rawBody = await req.text()
  const check = readOperatorRequest<Record<string, unknown>>(rawBody, req.headers, { requireMaster: true })
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status })
  const payload: unknown = check.body
  if (!isValidPayload(payload)) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  const allowedSource = process.env.OPERATOR_SELF_SERVICE_SOURCE_INSTANCE?.trim() || 'atelier-app'
  if (payload.source_instance !== allowedSource) return NextResponse.json({ error: 'Source instance not allowed' }, { status: 403 })

  const operator = createOperatorAdminClient()
  const email = payload.contact_email.trim().toLowerCase()
  const label = payload.full_name?.trim() || email.split('@')[0] || 'Inscription en cours'
  const now = new Date().toISOString()

  const { error: settingsError } = await operator.from('operator_client_settings').upsert({
    source_instance: payload.source_instance,
    organization_id: payload.organization_id,
    label,
    app_url: payload.app_url,
    contact_email: email,
    signup_source: payload.signup_source ?? 'direct',
    monthly_fee_ht: 0,
    is_active: true,
    updated_at: now,
  }, { onConflict: 'source_instance,organization_id' })
  if (settingsError) {
    console.error('[self-service/signup.settings]', settingsError)
    return NextResponse.json({ error: 'Unable to register signup' }, { status: 500 })
  }

  const { data: subscription } = await operator.from('operator_client_subscriptions')
    .select('source_instance')
    .eq('source_instance', payload.source_instance)
    .eq('organization_id', payload.organization_id)
    .maybeSingle()
  if (!subscription) {
    const { error: subscriptionError } = await operator.from('operator_client_subscriptions').insert({
      source_instance: payload.source_instance,
      organization_id: payload.organization_id,
      tier: 'setup_only',
      preferred_tier: payload.preferred_tier,
      access_status: 'locked',
      mrr_ht: 0,
      is_active: true,
      updated_at: now,
    })
    if (subscriptionError) {
      console.error('[self-service/signup.subscription]', subscriptionError)
      return NextResponse.json({ error: 'Unable to register signup subscription' }, { status: 500 })
    }
  }

  const { data: previousEvent } = await operator.from('operator_client_events')
    .select('id')
    .eq('source_instance', payload.source_instance)
    .eq('organization_id', payload.organization_id)
    .eq('event_type', 'signup_created')
    .limit(1)
    .maybeSingle()
  if (!previousEvent) {
    await recordOperatorClientEvent({
      sourceInstance: payload.source_instance,
      organizationId: payload.organization_id,
      eventCategory: 'subscription',
      eventType: 'signup_created',
      actorEmail: email,
      metadata: {
        signup_source: payload.signup_source ?? 'direct',
        preferred_tier: payload.preferred_tier,
        onboarding_status: 'pending',
      },
    })
  }

  return NextResponse.json({ ok: true, idempotent: Boolean(previousEvent) })
}
