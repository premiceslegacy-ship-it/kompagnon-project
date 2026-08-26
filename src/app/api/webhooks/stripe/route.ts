import { NextRequest, NextResponse } from 'next/server'
import { createOperatorAdminClient } from '@/lib/supabase/operator'
import { constantTimeEqual } from '@/lib/security'
import {
  initializeQuotasForTier,
  recordOperatorClientEvent,
  syncClientQuotaConfig,
  UNRESOLVED_ORGANIZATION_ID,
} from '@/lib/operator/trial-lifecycle'
import { DEFAULT_EINVOICING_CONFIG, normalizeEinvoicingConfigFromDb } from '@/lib/einvoicing-config'
import { isOverflowMode, isSubscriptionTier, type SubscriptionTier } from '@/lib/quota-catalog'
import { isSellableTier, type AccessStatus, type EntitlementSyncPayload } from '@/lib/subscription-access'
import { sendAuthEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'

type StripeObject = Record<string, any>
type TenantContext = { sourceInstance: string; organizationId: string }

function tierFromPriceId(priceId: string | null | undefined): SubscriptionTier | null {
  if (!priceId) return null
  // STRIPE_PRICE_STARTER volontairement conservé : Starter n'est plus vendu, mais un
  // customer.subscription.updated peut encore arriver pour un abonné historique sur cette
  // Price ID. La retirer ferait échouer le webhook pour lui ("Price ID non reconnu").
  const entries: Array<[string | undefined, SubscriptionTier]> = [
    [process.env.STRIPE_PRICE_STARTER, 'starter'],
    [process.env.STRIPE_PRICE_PRO, 'pro'],
    [process.env.STRIPE_PRICE_EXPERT, 'expert'],
    [process.env.STRIPE_PRICE_EXPERT_LEGACY, 'expert'],
  ]
  return entries.find(([id]) => id && id === priceId)?.[1] ?? null
}

async function verifyStripeSignature(body: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false
  const values = header.split(',').reduce<Record<string, string[]>>((acc, part) => {
    const [key, value] = part.split('=')
    if (key && value) (acc[key] ||= []).push(value)
    return acc
  }, {})
  const timestamp = values.t?.[0]
  if (!timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const bytes = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${body}`))
  const computed = Array.from(new Uint8Array(bytes)).map((value) => value.toString(16).padStart(2, '0')).join('')
  return values.v1?.some((candidate) => constantTimeEqual(computed, candidate)) ?? false
}

function metadataOf(object: StripeObject): Record<string, string> {
  const metadata = object?.metadata
  return metadata && typeof metadata === 'object' ? metadata : {}
}

function subscriptionIdOf(object: StripeObject): string | null {
  if (typeof object.subscription === 'string') return object.subscription
  if (typeof object.parent?.subscription_details?.subscription === 'string') return object.parent.subscription_details.subscription
  return null
}

async function retrieveStripeSubscription(subscriptionId: string): Promise<StripeObject | null> {
  const key = process.env.STRIPE_SECRET_KEY?.trim()
  if (!key) return null
  const response = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    headers: { Authorization: `Bearer ${key}` },
  })
  if (!response.ok) return null
  return response.json() as Promise<StripeObject>
}

async function resolveTenant(object: StripeObject): Promise<TenantContext | null> {
  const metadata = metadataOf(object)
  const sourceInstance = metadata.source_instance
  const organizationId = metadata.organization_id
  if (sourceInstance && organizationId) return { sourceInstance, organizationId }

  const subscriptionId = subscriptionIdOf(object) || (object.object === 'subscription' ? String(object.id || '') : '')
  if (subscriptionId) {
    const operator = createOperatorAdminClient()
    const { data } = await operator.from('operator_client_subscriptions')
      .select('source_instance, organization_id')
      .eq('stripe_subscription_id', subscriptionId)
      .maybeSingle()
    if (data?.source_instance && data.organization_id) {
      return { sourceInstance: data.source_instance, organizationId: data.organization_id }
    }
    const remote = await retrieveStripeSubscription(subscriptionId)
    const remoteMetadata = remote ? metadataOf(remote) : {}
    if (remoteMetadata.source_instance && remoteMetadata.organization_id) {
      return { sourceInstance: remoteMetadata.source_instance, organizationId: remoteMetadata.organization_id }
    }
  }

  // Compatibilité des anciens Payment Links per-client.
  const legacySource = typeof object.client_reference_id === 'string' ? object.client_reference_id.trim().toLowerCase() : ''
  if (!legacySource) return null
  const operator = createOperatorAdminClient()
  const { data } = await operator.from('operator_client_settings')
    .select('organization_id')
    .eq('source_instance', legacySource)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.organization_id ? { sourceInstance: legacySource, organizationId: data.organization_id } : null
}

function accessStatusFromStripe(status: string, cancelAt?: number | null): AccessStatus {
  if (cancelAt && cancelAt * 1000 > Date.now() && ['active', 'trialing'].includes(status)) return 'canceling'
  if (status === 'active') return 'active'
  if (status === 'past_due') return 'past_due'
  if (status === 'unpaid') return 'unpaid'
  if (status === 'canceled' || status === 'incomplete_expired') return 'expired'
  if (status === 'trialing') return 'trialing'
  return 'locked'
}

function isoFromUnix(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value) ? new Date(value * 1000).toISOString() : null
}

async function notifyLifecycle(to: string | null, eventType: string, tier: SubscriptionTier) {
  const messages: Record<string, { subject: string; body: string }> = {
    payment_succeeded: { subject: 'Votre accès Atelier est activé', body: `Votre formule ${tier === 'expert' ? 'Expert' : 'Pro'} est active. Toute votre équipe peut reprendre le travail.` },
    payment_failed: { subject: 'Votre paiement Atelier doit être régularisé', body: 'Stripe va retenter le paiement. Votre accès reste ouvert pendant cette phase ; mettez votre moyen de paiement à jour pour éviter une interruption.' },
    payment_recovered: { subject: 'Paiement régularisé — accès Atelier maintenu', body: 'Votre paiement a bien été récupéré. Vous pouvez continuer à utiliser Atelier normalement.' },
    subscription_cancelled: { subject: 'Votre accès Atelier est arrivé à son terme', body: 'Votre abonnement est terminé. Vos données restent exportables depuis le hall d’activation.' },
  }
  const message = messages[eventType]
  if (!message) return
  const deliveries = []
  if (to) deliveries.push(sendAuthEmail({
    to,
    subject: message.subject,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto"><h1 style="font-size:22px">${message.subject}</h1><p style="line-height:1.6">${message.body}</p><p style="color:#666;font-size:13px">L’équipe Atelier by Orsayn</p></div>`,
  }))
  const operatorEmail = process.env.OPERATOR_ALERT_EMAIL?.trim()
  if (operatorEmail && operatorEmail !== to) deliveries.push(sendAuthEmail({
    to: operatorEmail,
    subject: `[Cockpit Atelier] ${message.subject}`,
    html: `<p>${message.body}</p><p>Formule : <strong>${tier}</strong>. Événement : <strong>${eventType}</strong>.</p>`,
  }))
  await Promise.allSettled(deliveries)
}

async function applySubscriptionState(input: {
  tenant: TenantContext
  subscription: StripeObject
  forcedStatus?: AccessStatus
  eventType: string
}) {
  const operator = createOperatorAdminClient()
  const { sourceInstance, organizationId } = input.tenant
  const [{ data: settings }, { data: previous }] = await Promise.all([
    operator.from('operator_client_settings').select('app_url, contact_email').eq('source_instance', sourceInstance).eq('organization_id', organizationId).maybeSingle(),
    operator.from('operator_client_subscriptions').select('*').eq('source_instance', sourceInstance).eq('organization_id', organizationId).maybeSingle(),
  ])
  if (!settings) throw new Error(`Organisation cockpit introuvable: ${sourceInstance}/${organizationId}`)

  const metadata = metadataOf(input.subscription)
  const priceId = input.subscription.items?.data?.[0]?.price?.id as string | undefined
  const tier = tierFromPriceId(priceId)
    || (isSubscriptionTier(metadata.tier) ? metadata.tier : null)
    || (isSubscriptionTier(previous?.tier) ? previous.tier : null)
  if (!tier) throw new Error(`Price ID non reconnu: ${priceId || 'absent'}`)

  const stripeStatus = String(input.subscription.status || previous?.stripe_status || 'active')
  const cancelAt = typeof input.subscription.cancel_at === 'number' ? input.subscription.cancel_at : null
  const accessStatus = input.forcedStatus ?? accessStatusFromStripe(stripeStatus, cancelAt)
  const selfServiceSource = process.env.OPERATOR_SELF_SERVICE_SOURCE_INSTANCE?.trim() || 'atelier-app'
  const isSelfServiceTenant = sourceInstance === selfServiceSource
  const preferredTier = isSellableTier(tier)
    ? tier
    : isSellableTier(previous?.preferred_tier) ? previous.preferred_tier : 'pro'
  const accessEndsAt = accessStatus === 'canceling'
    ? isoFromUnix(cancelAt) || previous?.cancel_at || previous?.access_ends_at || null
    : accessStatus === 'expired' || accessStatus === 'unpaid' ? new Date().toISOString() : null
  const trialStartedAt = previous?.trial_started_at ?? null
  const trialEndsAt = previous?.trial_ends_at ?? null
  const syncedTier: SubscriptionTier = !isSelfServiceTenant && accessStatus === 'expired'
    ? 'setup_only'
    : tier
  const entitlement: EntitlementSyncPayload = {
    access_status: accessStatus,
    effective_tier: syncedTier,
    preferred_tier: preferredTier,
    trial_started_at: trialStartedAt,
    trial_ends_at: trialEndsAt,
    access_ends_at: accessEndsAt,
  }
  const now = new Date().toISOString()
  const mrr = accessStatus === 'expired'
    ? 0
    : tier === 'pro' ? 69 : tier === 'expert' ? 169 : previous?.mrr_ht ?? 0
  const stripeCustomerId = typeof input.subscription.customer === 'string' ? input.subscription.customer : previous?.stripe_customer_id
  const stripeSubscriptionId = String(input.subscription.id || previous?.stripe_subscription_id || '')
  const { error } = await operator.from('operator_client_subscriptions').upsert({
    source_instance: sourceInstance,
    organization_id: organizationId,
    tier: syncedTier,
    preferred_tier: preferredTier,
    access_status: accessStatus,
    access_ends_at: accessEndsAt,
    cancel_at: accessStatus === 'canceling' ? accessEndsAt : null,
    stripe_status: stripeStatus,
    stripe_customer_id: stripeCustomerId || null,
    stripe_subscription_id: stripeSubscriptionId || null,
    mrr_ht: mrr,
    is_active: ['active', 'past_due', 'canceling', 'trialing'].includes(accessStatus),
    renews_at: isoFromUnix(input.subscription.current_period_end),
    trial_converted: ['active', 'past_due', 'canceling'].includes(accessStatus),
    payment_failed_at: accessStatus === 'past_due' || accessStatus === 'unpaid' ? previous?.payment_failed_at || now : null,
    updated_at: now,
  }, { onConflict: 'source_instance,organization_id' })
  if (error) throw new Error(error.message)

  if (['active', 'past_due', 'canceling'].includes(accessStatus)) {
    await initializeQuotasForTier(sourceInstance, organizationId, syncedTier)
  }
  const einvoicingConfig = normalizeEinvoicingConfigFromDb({
    mode: previous?.einvoicing_mode ?? DEFAULT_EINVOICING_CONFIG.mode,
    provider: previous?.einvoicing_provider ?? null,
    environment: previous?.einvoicing_environment ?? DEFAULT_EINVOICING_CONFIG.environment,
    annuaire_status: previous?.einvoicing_annuaire_status ?? DEFAULT_EINVOICING_CONFIG.annuaire_status,
    oauth_status: previous?.oauth_status ?? DEFAULT_EINVOICING_CONFIG.oauth_status,
    oauth_connected_at: previous?.oauth_connected_at ?? null,
    super_pdp_connection_id: previous?.super_pdp_connection_id ?? null,
  })
  await syncClientQuotaConfig(
    sourceInstance,
    organizationId,
    settings.app_url,
    syncedTier,
    isOverflowMode(previous?.overflow_mode) ? previous.overflow_mode : 'block',
    previous?.ai_billing_mode === 'client_owned' ? 'client_owned' : 'orsayn_shared',
    einvoicingConfig,
    isSelfServiceTenant ? entitlement : undefined,
  )
  const effectiveEventType = input.eventType === 'payment_succeeded' && ['past_due', 'unpaid'].includes(previous?.access_status)
    ? 'payment_recovered'
    : input.eventType
  await recordOperatorClientEvent({
    sourceInstance,
    organizationId,
    eventCategory: 'subscription',
    eventType: effectiveEventType,
    actorEmail: 'stripe@webhook',
    metadata: { tier: syncedTier, access_status: accessStatus, stripe_status: stripeStatus, subscription_id: stripeSubscriptionId },
  })
  await notifyLifecycle(settings.contact_email, effectiveEventType, syncedTier)
}

async function subscriptionForObject(object: StripeObject): Promise<StripeObject | null> {
  if (object.object === 'subscription') return object
  const id = subscriptionIdOf(object) || (typeof object.subscription === 'string' ? object.subscription : null)
  return id ? retrieveStripeSubscription(id) : null
}

async function subscriptionForCheckout(session: StripeObject): Promise<StripeObject | null> {
  if (typeof session.subscription !== 'string') return null
  return retrieveStripeSubscription(session.subscription)
}

async function recordOrphan(object: StripeObject, reason: string) {
  const operator = createOperatorAdminClient()
  const sourceInstance = `orphan-${String(object.id || Date.now())}`
  await operator.from('operator_client_settings').upsert({
    source_instance: sourceInstance,
    organization_id: UNRESOLVED_ORGANIZATION_ID,
    label: '[PAIEMENT ORPHELIN]',
    is_active: false,
    config_sync_status: 'pending_manual',
    config_sync_error: reason,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'source_instance,organization_id' })
  await operator.from('operator_client_events').insert({
    source_instance: sourceInstance,
    organization_id: null,
    event_category: 'subscription',
    event_type: 'orphan_payment',
    actor_email: 'stripe@webhook',
    metadata: { reason, stripe_object_id: String(object.id || '') },
  })
}

async function claimWebhookEvent(eventId: string, eventType: string): Promise<'claimed' | 'duplicate'> {
  const operator = createOperatorAdminClient()
  const { data: existing } = await operator.from('webhook_events').select('status, received_at').eq('provider', 'stripe').eq('source_id', eventId).maybeSingle()
  if (existing?.status === 'success') return 'duplicate'
  const processingIsFresh = existing?.status === 'processing'
    && new Date(existing.received_at).getTime() > Date.now() - 10 * 60 * 1000
  if (processingIsFresh) return 'duplicate'
  if (existing) {
    await operator.from('webhook_events').update({
      status: 'processing',
      error_msg: null,
      processed_at: null,
      received_at: new Date().toISOString(),
    }).eq('provider', 'stripe').eq('source_id', eventId)
    return 'claimed'
  }
  const { error } = await operator.from('webhook_events').insert({ provider: 'stripe', source_id: eventId, event_type: eventType, status: 'processing' })
  return error?.code === '23505' ? 'duplicate' : 'claimed'
}

async function finishWebhookEvent(eventId: string, status: 'success' | 'failed', error?: string) {
  await createOperatorAdminClient().from('webhook_events').update({
    status,
    error_msg: error?.slice(0, 1000) ?? null,
    processed_at: status === 'success' ? new Date().toISOString() : null,
  }).eq('provider', 'stripe').eq('source_id', eventId)
}

export async function POST(req: NextRequest) {
  if (process.env.OPERATOR_MODE !== 'true') return NextResponse.json({ error: 'Not available' }, { status: 404 })
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim()
  if (!secret) return NextResponse.json({ error: 'Configuration error' }, { status: 500 })
  const rawBody = await req.text()
  if (!await verifyStripeSignature(rawBody, req.headers.get('stripe-signature'), secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  let event: { id: string; type: string; data: { object: StripeObject } }
  try { event = JSON.parse(rawBody) } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!event.id || !event.type || !event.data?.object) return NextResponse.json({ error: 'Invalid event' }, { status: 400 })
  if (await claimWebhookEvent(event.id, event.type) === 'duplicate') {
    return NextResponse.json({ received: true, duplicate: true })
  }

  try {
    const object = event.data.object
    const watched = new Set([
      'checkout.session.completed',
      'invoice.paid',
      'invoice.payment_failed',
      'customer.subscription.updated',
      'customer.subscription.deleted',
    ])
    if (watched.has(event.type)) {
      const tenant = await resolveTenant(object)
      if (!tenant) {
        await recordOrphan(object, `Tenant introuvable pour ${event.type}`)
      } else {
        const subscription = event.type === 'checkout.session.completed'
          ? await subscriptionForCheckout(object)
          : await subscriptionForObject(object)
        if (!subscription) throw new Error(`Abonnement Stripe introuvable pour ${event.type}`)

        if (event.type === 'invoice.payment_failed') {
          await applySubscriptionState({ tenant, subscription, forcedStatus: subscription.status === 'unpaid' ? 'unpaid' : 'past_due', eventType: 'payment_failed' })
        } else if (event.type === 'invoice.paid') {
          const previousStatus = String(subscription.status || '') === 'past_due'
          await applySubscriptionState({ tenant, subscription, forcedStatus: subscription.cancel_at ? 'canceling' : 'active', eventType: previousStatus ? 'payment_recovered' : 'payment_succeeded' })
        } else if (event.type === 'customer.subscription.deleted') {
          await applySubscriptionState({ tenant, subscription, forcedStatus: 'expired', eventType: 'subscription_cancelled' })
        } else if (event.type === 'checkout.session.completed') {
          await applySubscriptionState({ tenant, subscription, eventType: 'checkout_completed' })
        } else {
          await applySubscriptionState({ tenant, subscription, eventType: 'subscription_updated' })
        }
      }
    }
    await finishWebhookEvent(event.id, 'success')
    return NextResponse.json({ received: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal error'
    console.error('[stripe/webhook]', event.type, message)
    await finishWebhookEvent(event.id, 'failed', message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
