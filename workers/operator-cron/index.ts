/**
 * Cloudflare Worker — Cron opérateur cockpit Orsayn
 *
 * Deux cadences, distinguées via event.cron dans scheduled() :
 *
 * "0 7 * * *" (quotidien, 7h UTC) → /api/operator/cron/quota-alerts :
 *   - expire automatiquement les essais dépassés (accès déjà bloqué en temps
 *     réel côté app via hasActiveAccess, ce cron ne fait que synchroniser le
 *     statut cockpit et envoyer l'email de fin d'essai)
 *   - envoie les rappels d'essai à J-7 et J-2
 *   - crée/envoie les alertes de dépassement de quota
 *
 * "*/15 * * * *" (toutes les 15 min) → /api/operator/cron/einvoicing-poll :
 *   - polling de réception Super PDP pour les organisations reception_enabled=true
 *     (facultatif par client, voir docs/atelier-facturation-electronique.md §7.5)
 *
 * COCKPIT est un Service Binding (voir wrangler.toml [[services]]) vers le
 * Worker orsayn-cockpit : un fetch() classique vers l'URL publique échoue
 * avec l'erreur Cloudflare 1042 (restriction Worker-vers-Worker sur le réseau
 * public) — le binding route l'appel en interne, sans passer par internet.
 *
 * Variable à configurer dans Cloudflare Dashboard :
 *   CRON_SECRET  → même valeur que CRON_SECRET sur le Worker cockpit
 */

export interface Env {
  COCKPIT: { fetch(request: Request): Promise<Response> }
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
  async scheduled(event: { cron: string; scheduledTime: number }, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    if (event.cron === '*/15 * * * *') {
      ctx.waitUntil(runEinvoicingPoll(env))
    } else {
      ctx.waitUntil(runQuotaAlerts(env))
    }
  },

  // Déclenchement manuel/test : ?job=einvoicing-poll pour cibler le polling de
  // réception, sinon quota-alerts par défaut (comportement historique inchangé).
  async fetch(request: Request, env: Env, _ctx: unknown): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }
    const auth = request.headers.get('x-cron-secret')
    if (!constantTimeEqual(auth, env.CRON_SECRET)) {
      return new Response('Unauthorized', { status: 401 })
    }
    const job = new URL(request.url).searchParams.get('job')
    if (job === 'einvoicing-poll') {
      await runEinvoicingPoll(env)
    } else {
      await runQuotaAlerts(env)
    }
    return new Response('OK', { status: 200 })
  },
}

async function runQuotaAlerts(env: Env): Promise<void> {
  try {
    const res = await env.COCKPIT.fetch(new Request('https://orsayn-cockpit.mbebourasam.workers.dev/api/operator/cron/quota-alerts', {
      method: 'POST',
      headers: {
        'x-cron-secret': env.CRON_SECRET,
        'Content-Type': 'application/json',
      },
    }))
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

async function runEinvoicingPoll(env: Env): Promise<void> {
  try {
    const res = await env.COCKPIT.fetch(new Request('https://orsayn-cockpit.mbebourasam.workers.dev/api/operator/cron/einvoicing-poll', {
      method: 'POST',
      headers: {
        'x-cron-secret': env.CRON_SECRET,
        'Content-Type': 'application/json',
      },
    }))
    const data = await res.json() as Record<string, unknown>
    if (!res.ok) {
      console.error(`[operator-cron] einvoicing-poll returned ${res.status}:`, data)
    } else {
      console.log('[operator-cron] einvoicing-poll:', JSON.stringify(data))
    }
  } catch (err) {
    console.error('[operator-cron] einvoicing-poll fetch error:', err)
  }
}
