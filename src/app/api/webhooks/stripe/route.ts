import { NextRequest, NextResponse } from 'next/server'
import { createOperatorAdminClient } from '@/lib/supabase/operator'
import { signOperatorPayload } from '@/lib/operator'
import { constantTimeEqual } from '@/lib/security'
import { isSubscriptionTier, isOverflowMode, getModulesForTier, getQuotaConfigForTier, getQuotaUnit, QUOTA_FEATURES, type SubscriptionTier } from '@/lib/quota-catalog'
import { normalizeOrganizationModules } from '@/lib/organization-modules'
import { normalizeEinvoicingConfigFromDb, DEFAULT_EINVOICING_CONFIG } from '@/lib/einvoicing-config'

export const dynamic = 'force-dynamic'

// ── Correspondance Price ID → tier ────────────────────────────────────────────
function tierFromPriceId(priceId: string): SubscriptionTier | null {
  const map: Record<string, SubscriptionTier> = {
    [process.env.STRIPE_PRICE_STARTER ?? '']: 'starter',
    [process.env.STRIPE_PRICE_PRO ?? '']:     'pro',
    [process.env.STRIPE_PRICE_EXPERT ?? '']:  'expert',
  }
  return map[priceId] ?? null
}

// ── Vérification signature Stripe (HMAC-SHA256, pas de SDK) ───────────────────
async function verifyStripeSignature(
  body: string,
  sigHeader: string | null,
  secret: string,
): Promise<boolean> {
  if (!sigHeader) return false
  const parts = Object.fromEntries(sigHeader.split(',').map(p => p.split('=')))
  const timestamp = parts['t']
  const signature = parts['v1']
  if (!timestamp || !signature) return false

  const tolerance = 300 // 5 minutes
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > tolerance) return false

  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const payload = `${timestamp}.${body}`
  const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  const computed = Array.from(new Uint8Array(signatureBytes))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

  // Comparaison constant-time (compatible Edge/Workers) — évite les timing attacks
  return constantTimeEqual(computed, signature)
}

// ── Mise à jour abonnement + resync config client ─────────────────────────────
async function handleSubscriptionChange(sourceInstance: string, tier: SubscriptionTier, stripeCustomerId: string, stripeSubscriptionId: string) {
  const operator = createOperatorAdminClient()

  // Mise à jour operator_client_subscriptions
  const { error: subError } = await operator
    .from('operator_client_subscriptions')
    .upsert({
      source_instance: sourceInstance,
      tier,
      is_active: true,
      stripe_customer_id: stripeCustomerId,
      stripe_subscription_id: stripeSubscriptionId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'source_instance' })

  if (subError) throw new Error(`operator_client_subscriptions: ${subError.message}`)

  // Lecture du contexte complet pour le config-sync
  const [clientResult, settingResult, subscriptionResult] = await Promise.all([
    operator.from('operator_clients').select('organization_id').eq('source_instance', sourceInstance).order('updated_at', { ascending: false }).limit(1).maybeSingle(),
    operator.from('operator_client_settings').select('app_url').eq('source_instance', sourceInstance).maybeSingle(),
    operator.from('operator_client_subscriptions').select('ai_billing_mode, overflow_mode, einvoicing_mode, einvoicing_provider, einvoicing_environment, einvoicing_onboarding_model, b2brouter_account_id, einvoicing_annuaire_status').eq('source_instance', sourceInstance).maybeSingle(),
  ])

  const organizationId = clientResult.data?.organization_id ?? null
  const appUrl = settingResult.data?.app_url ?? null
  const sub = subscriptionResult.data

  const aiBillingMode = sub?.ai_billing_mode === 'client_owned' ? 'client_owned' : 'orsayn_shared'
  const overflowMode = isOverflowMode(sub?.overflow_mode ?? '') ? sub!.overflow_mode : 'block'
  const einvoicingConfig = normalizeEinvoicingConfigFromDb({
    mode: sub?.einvoicing_mode ?? DEFAULT_EINVOICING_CONFIG.mode,
    provider: sub?.einvoicing_provider ?? null,
    environment: sub?.einvoicing_environment ?? DEFAULT_EINVOICING_CONFIG.environment,
    onboarding_model: sub?.einvoicing_onboarding_model ?? null,
    b2brouter_account_id: sub?.b2brouter_account_id ?? null,
    annuaire_status: sub?.einvoicing_annuaire_status ?? DEFAULT_EINVOICING_CONFIG.annuaire_status,
  })

  // Mise à jour quotas cockpit
  const periodStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]
  const quotas = getQuotaConfigForTier(tier)
  const rows = QUOTA_FEATURES.map(quotaFeature => ({
    source_instance: sourceInstance,
    quota_feature: quotaFeature,
    quota_unit: getQuotaUnit(quotaFeature),
    quota_monthly: quotas[quotaFeature],
    current_quantity: 0,
    current_cost_eur: 0,
    period_start: periodStart,
    updated_at: new Date().toISOString(),
  }))
  await operator.from('operator_client_quotas').upsert(rows, { onConflict: 'source_instance,quota_feature,period_start' })

  // Log événement
  await operator.from('operator_client_events').insert({
    source_instance: sourceInstance,
    event_category: 'subscription',
    event_type: 'stripe_webhook_tier_updated',
    actor_email: 'stripe@webhook',
    metadata: { tier, stripe_customer_id: stripeCustomerId, stripe_subscription_id: stripeSubscriptionId },
  })

  // Config-sync vers l'instance cliente
  if (!organizationId || !appUrl) {
    await operator.from('operator_client_settings').update({
      config_sync_status: 'pending_manual',
      config_sync_error: !organizationId ? 'organization_id manquant' : 'app_url manquant',
      updated_at: new Date().toISOString(),
    }).eq('source_instance', sourceInstance)
    return
  }

  const secret = process.env.OPERATOR_CONFIG_SYNC_SECRET?.trim() || process.env.OPERATOR_INGEST_SECRET?.trim()
  if (!secret) return

  const syncedTier = aiBillingMode === 'client_owned' ? 'expert' : tier
  const body = JSON.stringify({
    source_instance: sourceInstance,
    organization_id: organizationId,
    modules: getModulesForTier(syncedTier),
    quota_config: getQuotaConfigForTier(syncedTier),
    overflow_mode: overflowMode,
    ai_billing_mode: aiBillingMode,
    einvoicing_config: einvoicingConfig,
  })

  try {
    const response = await fetch(`${appUrl.replace(/\/$/, '')}/api/operator/config-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-operator-signature': signOperatorPayload(body, secret) },
      body,
    })
    const syncStatus = response.ok ? 'synced' : 'failed'
    const syncError = response.ok ? null : `config-sync ${response.status}`
    await operator.from('operator_client_settings').update({
      config_sync_status: syncStatus,
      config_synced_at: response.ok ? new Date().toISOString() : undefined,
      config_sync_error: syncError,
      updated_at: new Date().toISOString(),
    }).eq('source_instance', sourceInstance)
  } catch (err) {
    await operator.from('operator_client_settings').update({
      config_sync_status: 'failed',
      config_sync_error: err instanceof Error ? err.message : 'Config sync failed',
      updated_at: new Date().toISOString(),
    }).eq('source_instance', sourceInstance)
  }
}

async function handleSubscriptionCancelled(sourceInstance: string) {
  const operator = createOperatorAdminClient()
  await operator.from('operator_client_subscriptions').update({
    tier: 'setup_only',
    is_active: false,
    updated_at: new Date().toISOString(),
  }).eq('source_instance', sourceInstance)

  await operator.from('operator_client_events').insert({
    source_instance: sourceInstance,
    event_category: 'subscription',
    event_type: 'stripe_webhook_subscription_cancelled',
    actor_email: 'stripe@webhook',
    metadata: {},
  })
}

// ── Handler principal ──────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // Réservé au cockpit
  if (process.env.OPERATOR_MODE !== 'true') {
    return NextResponse.json({ error: 'Not available' }, { status: 404 })
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('[stripe/webhook] STRIPE_WEBHOOK_SECRET manquant')
    return NextResponse.json({ error: 'Configuration error' }, { status: 500 })
  }

  const rawBody = await req.text()
  const sigHeader = req.headers.get('stripe-signature')

  const valid = await verifyStripeSignature(rawBody, sigHeader, webhookSecret)
  if (!valid) {
    console.error('[stripe/webhook] Signature invalide')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  let event: { id?: string; type: string; data: { object: Record<string, unknown> } }
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Idempotence : Stripe redélivre les webhooks (at-least-once). On enregistre
  // event.id AVANT traitement ; si déjà présent, on renvoie 200 sans retraiter
  // (sinon double reset de quotas cockpit / double config-sync).
  const eventId = event.id
  if (eventId) {
    const operatorDb = createOperatorAdminClient()
    const { data: inserted, error: dedupError } = await operatorDb
      .from('webhook_events')
      .insert({ provider: 'stripe', source_id: eventId, event_type: event.type })
      .select('id')
      .maybeSingle()
    if (dedupError && dedupError.code === '23505') {
      // Conflit sur (provider, source_id) : déjà traité
      return NextResponse.json({ received: true, duplicate: true })
    }
    if (!dedupError && !inserted) {
      return NextResponse.json({ received: true, duplicate: true })
    }
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object

      // Récupérer source_instance depuis le champ personnalisé
      const customFields = (session.custom_fields as Array<{ key: string; text?: { value?: string } }> | undefined) ?? []
      const instanceField = customFields.find(f => f.key === 'identifiant_de_votre_application')
      const sourceInstance = instanceField?.text?.value?.trim().toLowerCase()

      if (!sourceInstance) {
        console.error('[stripe/webhook] checkout.session.completed : champ source_instance manquant', session.id)
        return NextResponse.json({ received: true, warning: 'source_instance manquant' })
      }

      // Récupérer le price ID depuis la session Stripe
      const lineItems = session.line_items as { data?: Array<{ price?: { id?: string } }> } | undefined
      const priceId = lineItems?.data?.[0]?.price?.id

      // Si pas dans la session, récupérer via API Stripe
      let resolvedPriceId = priceId
      if (!resolvedPriceId && session.id) {
        const stripeKey = process.env.STRIPE_SECRET_KEY
        if (stripeKey) {
          const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${session.id}/line_items`, {
            headers: { Authorization: `Bearer ${stripeKey}` },
          })
          const data = await res.json() as { data?: Array<{ price?: { id?: string } }> }
          resolvedPriceId = data.data?.[0]?.price?.id
        }
      }

      const tier = resolvedPriceId ? tierFromPriceId(resolvedPriceId) : null
      if (!tier) {
        console.error('[stripe/webhook] Price ID non reconnu :', resolvedPriceId)
        return NextResponse.json({ received: true, warning: 'price_id non reconnu' })
      }

      const stripeCustomerId = String(session.customer ?? '')
      const stripeSubscriptionId = String(session.subscription ?? '')
      await handleSubscriptionChange(sourceInstance, tier, stripeCustomerId, stripeSubscriptionId)
    }

    else if (event.type === 'customer.subscription.updated') {
      const subscription = event.data.object
      const priceId = (subscription.items as { data?: Array<{ price?: { id?: string } }> } | undefined)?.data?.[0]?.price?.id
      const tier = priceId ? tierFromPriceId(priceId) : null

      if (!tier) {
        console.error('[stripe/webhook] subscription.updated : price ID non reconnu', priceId)
        return NextResponse.json({ received: true, warning: 'price_id non reconnu' })
      }

      // Récupérer source_instance depuis stripe_subscription_id stocké en DB
      const operator = createOperatorAdminClient()
      const { data } = await operator
        .from('operator_client_subscriptions')
        .select('source_instance')
        .eq('stripe_subscription_id', String(subscription.id))
        .maybeSingle()

      if (!data?.source_instance) {
        console.error('[stripe/webhook] subscription.updated : source_instance introuvable pour', subscription.id)
        return NextResponse.json({ received: true, warning: 'source_instance introuvable' })
      }

      await handleSubscriptionChange(
        data.source_instance,
        tier,
        String(subscription.customer ?? ''),
        String(subscription.id),
      )
    }

    else if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object
      const operator = createOperatorAdminClient()
      const { data } = await operator
        .from('operator_client_subscriptions')
        .select('source_instance')
        .eq('stripe_subscription_id', String(subscription.id))
        .maybeSingle()

      if (data?.source_instance) {
        await handleSubscriptionCancelled(data.source_instance)
      }
    }

    return NextResponse.json({ received: true })
  } catch (err) {
    console.error('[stripe/webhook] Erreur traitement événement:', event.type, err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
