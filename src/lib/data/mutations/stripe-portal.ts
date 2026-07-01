'use server'

import { signOperatorPayload } from '@/lib/operator'

export async function createStripePortalSession(returnUrl: string): Promise<{ url: string } | { error: string }> {
  const ingestUrl = process.env.OPERATOR_INGEST_URL?.trim()
  const secret = process.env.OPERATOR_CONFIG_SYNC_SECRET?.trim()
    || process.env.OPERATOR_INGEST_SECRET?.trim()
  const sourceInstance = process.env.OPERATOR_SOURCE_INSTANCE?.trim()

  if (!ingestUrl || !secret || !sourceInstance) {
    return { error: 'Configuration opérateur manquante' }
  }

  // Dérive l'URL du portail depuis l'URL d'ingest (même worker cockpit)
  const cockpitBase = new URL(ingestUrl).origin

  const body = JSON.stringify({ source_instance: sourceInstance, return_url: returnUrl })
  const signature = signOperatorPayload(body, secret)

  try {
    const res = await fetch(`${cockpitBase}/api/stripe/portal-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-operator-signature': signature,
      },
      body,
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: string }
      return { error: data.error ?? `Erreur ${res.status}` }
    }

    const data = await res.json() as { url: string }
    return { url: data.url }
  } catch (err) {
    console.error('[createStripePortalSession]', err)
    return { error: 'Impossible de contacter le cockpit Orsayn' }
  }
}
