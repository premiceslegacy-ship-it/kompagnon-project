import { NextRequest, NextResponse } from 'next/server'
import { verifyOperatorSignature } from '@/lib/operator'
import { createOperatorAdminClient, isOperatorModeEnabled } from '@/lib/supabase/operator'
import { isSellableTier } from '@/lib/subscription-access'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!isOperatorModeEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim()
  const secret = process.env.OPERATOR_CONFIG_SYNC_SECRET?.trim() || process.env.OPERATOR_INGEST_SECRET?.trim()
  if (!stripeKey || !secret) return NextResponse.json({ error: 'Configuration Stripe manquante' }, { status: 500 })

  const rawBody = await req.text()
  if (!verifyOperatorSignature(rawBody, secret, req.headers.get('x-operator-signature'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  let body: Record<string, unknown>
  try { body = JSON.parse(rawBody) } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const sourceInstance = typeof body.source_instance === 'string' ? body.source_instance : ''
  const organizationId = typeof body.organization_id === 'string' ? body.organization_id : ''
  const returnUrl = typeof body.return_url === 'string' ? body.return_url : ''
  const tier = body.tier
  if (!sourceInstance || !organizationId || !returnUrl || !isSellableTier(tier)) {
    return NextResponse.json({ error: 'Paramètres invalides' }, { status: 400 })
  }

  const allowedSource = process.env.OPERATOR_SELF_SERVICE_SOURCE_INSTANCE?.trim() || 'atelier-app'
  if (sourceInstance !== allowedSource) return NextResponse.json({ error: 'Source instance not allowed' }, { status: 403 })

  const operator = createOperatorAdminClient()
  const [{ data: settings }, { data: subscription }] = await Promise.all([
    operator.from('operator_client_settings').select('app_url, contact_email').eq('source_instance', sourceInstance).eq('organization_id', organizationId).maybeSingle(),
    operator.from('operator_client_subscriptions').select('stripe_customer_id, stripe_subscription_id, stripe_status').eq('source_instance', sourceInstance).eq('organization_id', organizationId).maybeSingle(),
  ])
  if (!settings?.app_url) return NextResponse.json({ error: 'Organisation introuvable' }, { status: 404 })
  try {
    if (new URL(returnUrl).origin !== new URL(settings.app_url).origin) {
      return NextResponse.json({ error: 'URL de retour invalide' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'URL de retour invalide' }, { status: 400 })
  }
  if (subscription?.stripe_subscription_id && !['canceled', 'incomplete_expired'].includes(subscription.stripe_status || '')) {
    return NextResponse.json({ error: 'Un abonnement existe déjà pour cette organisation' }, { status: 409 })
  }

  const priceId = tier === 'pro' ? process.env.STRIPE_PRICE_PRO?.trim() : process.env.STRIPE_PRICE_EXPERT?.trim()
  if (!priceId) return NextResponse.json({ error: `Prix ${tier} non configuré` }, { status: 500 })
  const successUrl = new URL(returnUrl)
  successUrl.searchParams.set('checkout', 'success')
  successUrl.searchParams.set('session_id', '{CHECKOUT_SESSION_ID}')
  const cancelUrl = new URL('/activation?checkout=cancelled', settings.app_url).toString()

  const params = new URLSearchParams({
    mode: 'subscription',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    success_url: successUrl.toString(),
    cancel_url: cancelUrl,
    client_reference_id: organizationId,
    'metadata[source_instance]': sourceInstance,
    'metadata[organization_id]': organizationId,
    'metadata[tier]': tier,
    'subscription_data[metadata][source_instance]': sourceInstance,
    'subscription_data[metadata][organization_id]': organizationId,
    'subscription_data[metadata][tier]': tier,
  })
  if (subscription?.stripe_customer_id) params.set('customer', subscription.stripe_customer_id)
  else if (settings.contact_email) params.set('customer_email', settings.contact_email)

  const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${stripeKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })
  const stripeData = await stripeResponse.json() as { id?: string; url?: string; error?: { message?: string } }
  if (!stripeResponse.ok || !stripeData.url) {
    console.error('[stripe/checkout-session]', stripeData.error?.message)
    return NextResponse.json({ error: 'Impossible de démarrer le paiement sécurisé' }, { status: 502 })
  }

  await operator.from('operator_client_subscriptions').update({
    preferred_tier: tier,
    updated_at: new Date().toISOString(),
  }).eq('source_instance', sourceInstance).eq('organization_id', organizationId)

  return NextResponse.json({ url: stripeData.url })
}
