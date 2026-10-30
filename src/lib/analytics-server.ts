import 'server-only'
import { PostHog } from 'posthog-node'
import { getOperatorSourceInstance } from '@/lib/operator'

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com'

/**
 * Événement métier explicite depuis une Server Action / route API. Suivi de
 * base uniquement (pas d'autocapture) : quelques événements produit utiles
 * (devis créé, facture envoyée...), pas un tracking exhaustif.
 * No-op silencieux si PostHog n'est pas configuré.
 */
export async function trackServerEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>,
): Promise<void> {
  if (!POSTHOG_KEY) return
  try {
    // Un client court par appel évite de conserver un objet réseau mutable dans
    // le scope global d'un Worker Cloudflare.
    const ph = new PostHog(POSTHOG_KEY, { host: POSTHOG_HOST, flushAt: 1, flushInterval: 0 })
    // Compte PostHog Orsayn partagé entre tous les clients per-client :
    // client_instance permet de filtrer par instance déployée dans les dashboards.
    ph.capture({ distinctId, event, properties: { ...properties, client_instance: getOperatorSourceInstance() } })
    await ph.flush()
  } catch (error) {
    // L'analytics ne doit jamais casser l'action métier.
    console.error('[trackServerEvent]', error)
  }
}
