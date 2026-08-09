import { NextRequest, NextResponse } from 'next/server'
import { createOperatorAdminClient } from '@/lib/supabase/operator'
import { verifyOperatorSignature } from '@/lib/operator'

export const dynamic = 'force-dynamic'

// Endpoint cockpit (une seule instance, OPERATOR_MODE=true) appelé par chaque
// instance cliente via createStripePortalSession (src/lib/data/mutations/stripe-portal.ts).
// Le portail est dynamique par client : on résout le stripe_customer_id à partir
// du source_instance reçu dans le body, puis on crée une session portail Stripe
// pour CE client précis. La configuration du portail (moyens de paiement,
// annulation, changement de plan autorisé ou non) est séparée : configuration
// historique pour les instances dédiées, configuration stricte pour la
// plateforme partagée qui gère sa résiliation dans Atelier.

export async function POST(req: NextRequest) {
  if (process.env.OPERATOR_MODE !== 'true') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim()
  if (!stripeKey) {
    return NextResponse.json({ error: 'STRIPE_SECRET_KEY manquant' }, { status: 500 })
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

  let body: { source_instance: string; organization_id?: string; return_url: string }
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { source_instance, organization_id, return_url } = body
  if (!source_instance || !return_url) {
    return NextResponse.json({ error: 'source_instance et return_url requis' }, { status: 400 })
  }
  const selfServiceSource = process.env.OPERATOR_SELF_SERVICE_SOURCE_INSTANCE?.trim() || 'atelier-app'
  if (source_instance === selfServiceSource && !organization_id) {
    return NextResponse.json({ error: 'organization_id requis pour la plateforme partagée' }, { status: 400 })
  }
  // Sans ID explicite, Stripe retomberait sur le portail par défaut du compte.
  // En self-service cela pourrait réexposer Starter ou la résiliation directe.
  const portalConfigId = source_instance === selfServiceSource
    ? process.env.STRIPE_SELF_SERVICE_PORTAL_CONFIGURATION_ID?.trim()
    : process.env.STRIPE_PORTAL_CONFIGURATION_ID?.trim()
  if (!portalConfigId) {
    return NextResponse.json({ error: 'Configuration du portail Stripe manquante' }, { status: 500 })
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
  // organization_id absent : compat instances anciennes non encore mises à jour,
  // retombe sur la ligne la plus récente (risqué sur une instance mutualisée).
  const subscriptionQuery = operator
    .from('operator_client_subscriptions')
    .select('stripe_customer_id')
    .eq('source_instance', source_instance)
  const [{ data, error }, { data: settings }] = await Promise.all([
    organization_id
      ? subscriptionQuery.eq('organization_id', organization_id).maybeSingle()
      : subscriptionQuery.order('updated_at', { ascending: false }).limit(1).maybeSingle(),
    organization_id
      ? operator.from('operator_client_settings').select('app_url').eq('source_instance', source_instance).eq('organization_id', organization_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  if (error) {
    console.error('[stripe/portal-session] DB error:', error)
    return NextResponse.json({ error: 'Erreur base de données' }, { status: 500 })
  }

  if (!data?.stripe_customer_id) {
    return NextResponse.json({ error: 'Aucun abonnement Stripe trouvé pour ce client' }, { status: 404 })
  }
  if (source_instance === selfServiceSource) {
    try {
      if (!settings?.app_url || new URL(return_url).origin !== new URL(settings.app_url).origin) {
        return NextResponse.json({ error: 'return_url invalide pour cette organisation' }, { status: 400 })
      }
    } catch {
      return NextResponse.json({ error: 'return_url invalide pour cette organisation' }, { status: 400 })
    }
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
