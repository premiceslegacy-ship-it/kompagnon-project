import { NextRequest, NextResponse } from 'next/server'
import { createOperatorAdminClient } from '@/lib/supabase/operator'
import { verifyOperatorSignature } from '@/lib/operator'

export const dynamic = 'force-dynamic'

// Endpoint cockpit (une seule instance, OPERATOR_MODE=true) appelé par chaque
// instance cliente via createStripePortalSession (src/lib/data/mutations/stripe-portal.ts).
// Le portail est dynamique par client : on résout le stripe_customer_id à partir
// du source_instance reçu dans le body, puis on crée une session portail Stripe
// pour CE client précis. La configuration du portail (moyens de paiement,
// annulation, changement de plan autorisé ou non) est mutualisée pour toutes
// les instances Atelier via STRIPE_PORTAL_CONFIGURATION_ID (Stripe Dashboard
// → Customer portal → Configurations) — elle n'est pas versionnée dans ce repo.

export async function POST(req: NextRequest) {
  if (process.env.OPERATOR_MODE !== 'true') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim()
  if (!stripeKey) {
    return NextResponse.json({ error: 'STRIPE_SECRET_KEY manquant' }, { status: 500 })
  }

  // Sans configuration dédiée, Stripe retombe sur la configuration de portail
  // par défaut du compte, qui peut exposer d'autres produits que ceux d'Atelier.
  // On préfère bloquer plutôt que de générer une session mal configurée.
  const portalConfigId = process.env.STRIPE_PORTAL_CONFIGURATION_ID?.trim()
  if (!portalConfigId) {
    return NextResponse.json({ error: 'STRIPE_PORTAL_CONFIGURATION_ID manquant' }, { status: 500 })
  }

  const secret = process.env.OPERATOR_CONFIG_SYNC_SECRET?.trim()
    || process.env.OPERATOR_INGEST_SECRET?.trim()
  if (!secret) {
    return NextResponse.json({ error: 'Operator secret manquant' }, { status: 500 })
  }

  const rawBody = await req.text()
  const signature = req.headers.get('x-operator-signature')
  if (!verifyOperatorSignature(rawBody, secret, signature)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { source_instance: string; return_url: string }
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { source_instance, return_url } = body
  if (!source_instance || !return_url) {
    return NextResponse.json({ error: 'source_instance et return_url requis' }, { status: 400 })
  }

  // Validation basique de return_url (doit être https)
  try {
    const url = new URL(return_url)
    if (url.protocol !== 'https:' && !url.hostname.startsWith('localhost')) {
      return NextResponse.json({ error: 'return_url invalide' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'return_url invalide' }, { status: 400 })
  }

  const operator = createOperatorAdminClient()
  const { data, error } = await operator
    .from('operator_client_subscriptions')
    .select('stripe_customer_id')
    .eq('source_instance', source_instance)
    .maybeSingle()

  if (error) {
    console.error('[stripe/portal-session] DB error:', error)
    return NextResponse.json({ error: 'Erreur base de données' }, { status: 500 })
  }

  if (!data?.stripe_customer_id) {
    return NextResponse.json({ error: 'Aucun abonnement Stripe trouvé pour ce client' }, { status: 404 })
  }

  const portalParams: Record<string, string> = {
    customer: data.stripe_customer_id,
    return_url,
    configuration: portalConfigId,
  }

  const stripeRes = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(portalParams).toString(),
  })

  if (!stripeRes.ok) {
    const err = await stripeRes.json().catch(() => ({}))
    console.error('[stripe/portal-session] Stripe error:', err)
    return NextResponse.json({ error: 'Impossible de créer la session portail Stripe' }, { status: 502 })
  }

  const session = await stripeRes.json() as { url: string }
  return NextResponse.json({ url: session.url })
}
