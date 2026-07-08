import 'server-only'
import { PostHog } from 'posthog-node'
import { getOperatorSourceInstance } from '@/lib/operator'

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com'

let client: PostHog | null = null
function getClient(): PostHog | null {
  if (!POSTHOG_KEY) return null
  if (!client) {
    client = new PostHog(POSTHOG_KEY, { host: POSTHOG_HOST, flushAt: 1, flushInterval: 0 })
  }
  return client
}

/**
 * Événement métier explicite depuis une Server Action / route API. Suivi de
 * base uniquement (pas d'autocapture) : quelques événements produit utiles
 * (devis créé, facture envoyée...), pas un tracking exhaustif.
 * No-op silencieux si PostHog n'est pas configuré.
 */
export function trackServerEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>,
): void {
  const ph = getClient()
  if (!ph) return
  // Compte PostHog Orsayn partagé entre tous les clients per-client :
  // client_instance permet de filtrer par instance déployée dans les dashboards.
  ph.capture({ distinctId, event, properties: { ...properties, client_instance: getOperatorSourceInstance() } })
}
