import { NextRequest, NextResponse } from 'next/server'
import { verifyOperatorSignature } from '@/lib/operator'
import { createOperatorAdminClient, isOperatorModeEnabled } from '@/lib/supabase/operator'
import { normalizeEinvoicingConfigFromDb, DEFAULT_EINVOICING_CONFIG } from '@/lib/einvoicing-config'
import { isOverflowMode } from '@/lib/quota-catalog'
import { recordOperatorClientEvent, syncClientQuotaConfig } from '@/lib/operator/trial-lifecycle'
import { isSellableTier, type EntitlementSyncPayload } from '@/lib/subscription-access'
import { sendAuthEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!isOperatorModeEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim()
  const secret = process.env.OPERATOR_CONFIG_SYNC_SECRET?.trim() || process.env.OPERATOR_INGEST_SECRET?.trim()
  if (!stripeKey || !secret) return NextResponse.json({ error: 'Configuration manquante' }, { status: 500 })

  const rawBody = await req.text()
  if (!verifyOperatorSignature(rawBody, secret, req.headers.get('x-operator-signature'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  let body: Record<string, unknown>
  try { body = JSON.parse(rawBody) } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const sourceInstance = typeof body.source_instance === 'string' ? body.source_instance : ''
  const organizationId = typeof body.organization_id === 'string' ? body.organization_id : ''
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : ''
  if (!sourceInstance || !organizationId || !reason) {
    return NextResponse.json({ error: 'Organisation et motif requis' }, { status: 400 })
  }
  const allowedSource = process.env.OPERATOR_SELF_SERVICE_SOURCE_INSTANCE?.trim() || 'atelier-app'
  if (sourceInstance !== allowedSource) {
    return NextResponse.json({ error: 'Source instance not allowed' }, { status: 403 })
  }

  const operator = createOperatorAdminClient()
  const [{ data: subscription }, { data: settings }] = await Promise.all([
    operator.from('operator_client_subscriptions').select('*').eq('source_instance', sourceInstance).eq('organization_id', organizationId).maybeSingle(),
    operator.from('operator_client_settings').select('app_url, contact_email').eq('source_instance', sourceInstance).eq('organization_id', organizationId).maybeSingle(),
  ])
  if (!subscription?.stripe_subscription_id || !settings?.app_url) {
    return NextResponse.json({ error: 'Abonnement introuvable' }, { status: 404 })
  }
  if (!isSellableTier(subscription.tier)) {
    return NextResponse.json({ error: 'Formule non résiliable depuis ce parcours' }, { status: 409 })
  }
  if (subscription.cancel_at && new Date(subscription.cancel_at).getTime() > Date.now()) {
    return NextResponse.json({ ok: true, cancel_at: subscription.cancel_at, idempotent: true })
  }

  const cancelAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  const stripeResponse = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscription.stripe_subscription_id)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${stripeKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      cancel_at: String(Math.floor(cancelAt.getTime() / 1000)),
      proration_behavior: 'create_prorations',
      'cancellation_details[comment]': reason,
    }).toString(),
  })
  if (!stripeResponse.ok) {
    const stripeError = await stripeResponse.json().catch(() => ({}))
    console.error('[stripe/cancel-subscription]', stripeError)
    return NextResponse.json({ error: 'Stripe n’a pas pu programmer la résiliation' }, { status: 502 })
  }

  const tier = subscription.tier
  const preferredTier = isSellableTier(subscription.preferred_tier) ? subscription.preferred_tier : (tier === 'expert' ? 'expert' : 'pro')
  const entitlement: EntitlementSyncPayload = {
    access_status: 'canceling',
    effective_tier: tier,
    preferred_tier: preferredTier,
    trial_started_at: subscription.trial_started_at ?? null,
    trial_ends_at: subscription.trial_ends_at ?? null,
    access_ends_at: cancelAt.toISOString(),
  }
  const now = new Date().toISOString()
  const { error: updateError } = await operator.from('operator_client_subscriptions').update({
    access_status: 'canceling',
    cancel_requested_at: now,
    cancel_at: cancelAt.toISOString(),
    access_ends_at: cancelAt.toISOString(),
    notes: reason,
    updated_at: now,
  }).eq('source_instance', sourceInstance).eq('organization_id', organizationId)
  if (updateError) throw new Error(updateError.message)

  const einvoicingConfig = normalizeEinvoicingConfigFromDb({
    mode: subscription.einvoicing_mode ?? DEFAULT_EINVOICING_CONFIG.mode,
    provider: subscription.einvoicing_provider ?? null,
    environment: subscription.einvoicing_environment ?? DEFAULT_EINVOICING_CONFIG.environment,
    annuaire_status: subscription.einvoicing_annuaire_status ?? DEFAULT_EINVOICING_CONFIG.annuaire_status,
    oauth_status: subscription.oauth_status ?? DEFAULT_EINVOICING_CONFIG.oauth_status,
    oauth_connected_at: subscription.oauth_connected_at ?? null,
    super_pdp_connection_id: subscription.super_pdp_connection_id ?? null,
  })
  await syncClientQuotaConfig(
    sourceInstance,
    organizationId,
    settings.app_url,
    tier,
    isOverflowMode(subscription.overflow_mode) ? subscription.overflow_mode : 'block',
    subscription.ai_billing_mode === 'client_owned' ? 'client_owned' : 'orsayn_shared',
    einvoicingConfig,
    entitlement,
  )
  await recordOperatorClientEvent({
    sourceInstance,
    organizationId,
    eventCategory: 'subscription',
    eventType: 'cancellation_scheduled',
    actorEmail: settings.contact_email ?? null,
    metadata: { reason, cancel_at: cancelAt.toISOString(), proration_behavior: 'create_prorations' },
  })
  const displayDate = cancelAt.toLocaleDateString('fr-FR')
  await Promise.allSettled([
    ...(settings.contact_email ? [sendAuthEmail({
      to: settings.contact_email,
      subject: 'Résiliation Atelier confirmée',
      html: `<p>Votre résiliation est programmée au <strong>${displayDate}</strong>.</p><p>Votre accès reste actif jusque-là. Stripe calculera la dernière période au prorata.</p>`,
    })] : []),
    ...(process.env.OPERATOR_ALERT_EMAIL ? [sendAuthEmail({
      to: process.env.OPERATOR_ALERT_EMAIL,
      subject: `[Cockpit Atelier] Résiliation programmée au ${displayDate}`,
      html: `<p>${sourceInstance} / ${organizationId}</p><p>Le motif est enregistré dans le cockpit.</p>`,
    })] : []),
  ])
  return NextResponse.json({ ok: true, cancel_at: cancelAt.toISOString() })
}
