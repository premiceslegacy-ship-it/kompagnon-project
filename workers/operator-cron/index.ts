/**
 * Cloudflare Worker — Cron opérateur cockpit Orsayn
 *
 * Déclenché chaque matin à 7h UTC (8h Paris hiver, 9h Paris été).
 * Appelle /api/operator/cron/quota-alerts sur le cockpit, qui :
 *   - expire automatiquement les essais dépassés (accès déjà bloqué en temps
 *     réel côté app via hasActiveAccess, ce cron ne fait que synchroniser le
 *     statut cockpit et envoyer l'email de fin d'essai)
 *   - envoie les rappels d'essai à J-7 et J-2
 *   - crée/envoie les alertes de dépassement de quota
 *
 * Variables d'environnement à configurer dans Cloudflare Dashboard :
 *   COCKPIT_URL  → URL du cockpit (ex: https://orsayn-cockpit.mbebourasam.workers.dev)
 *   CRON_SECRET  → même valeur que CRON_SECRET sur le Worker cockpit
 */

export interface Env {
  COCKPIT_URL: string
  CRON_SECRET: string
}

function constantTimeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  if (a.length !== b.length) return false

  let diff = 0
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }

  return diff === 0
}

export default {
  async scheduled(_event: { scheduledTime: number }, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(runQuotaAlerts(env))
  },

  async fetch(request: Request, env: Env, _ctx: unknown): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }
    const auth = request.headers.get('x-cron-secret')
    if (!constantTimeEqual(auth, env.CRON_SECRET)) {
      return new Response('Unauthorized', { status: 401 })
    }
    await runQuotaAlerts(env)
    return new Response('OK', { status: 200 })
  },
}

async function runQuotaAlerts(env: Env): Promise<void> {
  const url = `${env.COCKPIT_URL}/api/operator/cron/quota-alerts`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'x-cron-secret': env.CRON_SECRET,
        'Content-Type': 'application/json',
      },
    })
    const data = await res.json() as Record<string, unknown>
    if (!res.ok) {
      console.error(`[operator-cron] quota-alerts returned ${res.status}:`, data)
    } else {
      console.log('[operator-cron] quota-alerts:', JSON.stringify(data))
    }
  } catch (err) {
    console.error('[operator-cron] quota-alerts fetch error:', err)
  }
}
