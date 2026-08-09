import { NextRequest, NextResponse } from 'next/server'
import { verifyOperatorSignature } from '@/lib/operator'
import { recordOperatorClientEvent } from '@/lib/operator/trial-lifecycle'
import { sendAuthEmail } from '@/lib/email'
import { createOperatorAdminClient, isOperatorModeEnabled } from '@/lib/supabase/operator'
import { isSellableTier, type SellableTier } from '@/lib/subscription-access'

type RegistrationPayload = {
  source_instance: string
  organization_id: string
  app_url: string
  company_name: string
  contact_email: string
  siret: string
  preferred_tier: SellableTier
  signup_source?: string
}

function isValidPayload(value: unknown): value is RegistrationPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return (
    typeof row.source_instance === 'string'
    && typeof row.organization_id === 'string'
    && typeof row.app_url === 'string'
    && typeof row.company_name === 'string'
    && typeof row.contact_email === 'string'
    && typeof row.siret === 'string'
    && isSellableTier(row.preferred_tier)
    && (row.signup_source === undefined || typeof row.signup_source === 'string')
  )
}

export async function POST(req: NextRequest) {
  if (!isOperatorModeEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const secret = process.env.OPERATOR_CONFIG_SYNC_SECRET?.trim()
    || process.env.OPERATOR_INGEST_SECRET?.trim()
  if (!secret) return NextResponse.json({ error: 'Operator secret missing' }, { status: 500 })

  const rawBody = await req.text()
  if (!verifyOperatorSignature(rawBody, secret, req.headers.get('x-operator-signature'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  let payload: unknown
  try { payload = JSON.parse(rawBody) } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!isValidPayload(payload)) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  const allowedSource = process.env.OPERATOR_SELF_SERVICE_SOURCE_INSTANCE?.trim() || 'atelier-app'
  if (payload.source_instance !== allowedSource) {
    return NextResponse.json({ error: 'Source instance not allowed' }, { status: 403 })
  }
  const siret = payload.siret.replace(/\s/g, '')
  if (!/^\d{14}$/.test(siret)) return NextResponse.json({ error: 'SIRET required' }, { status: 400 })
  try {
    if (new URL(payload.app_url).protocol !== 'https:' && new URL(payload.app_url).hostname !== 'localhost') {
      return NextResponse.json({ error: 'Invalid app URL' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid app URL' }, { status: 400 })
  }

  const operator = createOperatorAdminClient()
  const { data: existing } = await operator.from('operator_client_settings')
    .select('source_instance')
    .eq('source_instance', payload.source_instance)
    .eq('organization_id', payload.organization_id)
    .maybeSingle()
  const now = new Date().toISOString()
  const { error: settingsError } = await operator.from('operator_client_settings').upsert({
    source_instance: payload.source_instance,
    organization_id: payload.organization_id,
    label: payload.company_name.trim(),
    app_url: payload.app_url,
    contact_email: payload.contact_email.trim().toLowerCase(),
    company_siret: siret,
    signup_source: payload.signup_source ?? 'direct',
    monthly_fee_ht: 0,
    is_active: true,
    updated_at: now,
  }, { onConflict: 'source_instance,organization_id' })
  if (settingsError) {
    console.error('[self-service/register.settings]', settingsError)
    return NextResponse.json({ error: 'Unable to register organization' }, { status: 500 })
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
      console.error('[self-service/register.subscription]', subscriptionError)
      return NextResponse.json({ error: 'Unable to register subscription' }, { status: 500 })
    }
  }

  if (!existing) {
    await recordOperatorClientEvent({
      sourceInstance: payload.source_instance,
      organizationId: payload.organization_id,
      eventCategory: 'subscription',
      eventType: 'self_service_signup',
      actorEmail: payload.contact_email,
      metadata: { signup_source: payload.signup_source ?? 'direct', preferred_tier: payload.preferred_tier },
    })
    const operatorEmail = process.env.OPERATOR_ALERT_EMAIL?.trim()
    if (operatorEmail) await sendAuthEmail({
      to: operatorEmail,
      subject: `[Atelier] Nouvelle inscription — ${payload.company_name}`,
      html: `<p><strong>${payload.company_name}</strong> vient de terminer son inscription.</p><p>Préférence : ${payload.preferred_tier}. Source : ${payload.signup_source ?? 'direct'}.</p>`,
    })
  }

  return NextResponse.json({ ok: true, idempotent: Boolean(existing) })
}
