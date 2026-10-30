/**
 * Cloudflare Worker — Crons automatiques Atelier
 *
 * Déclenché chaque heure pour les rattrapages techniques et chaque matin à
 * 7h UTC (8h Paris hiver, 9h Paris été) pour les traitements métier.
 * Appelle séquentiellement les API routes Next.js sécurisées par CRON_SECRET :
 *   - /api/cron/operator-usage-sync — rattrapage des consommations cockpit
 *   - /api/cron/onboarding-reminders — relances progressives des inscrits bloqués
 *   - traitements métier quotidiens existants
 *
 * Variables d'environnement à configurer dans Cloudflare Dashboard :
 *   APP_URL      → URL de l'app (ex: https://atelier-weber.workers.dev)
 *   CRON_SECRET  → même valeur que dans les variables du Worker app
 */

export interface Env {
  APP_URL: string
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
  async scheduled(event: { scheduledTime: number; cron: string }, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(event.cron === '10 * * * *' ? runFastCrons(env) : runAllCrons(env))
  },

  async fetch(request: Request, env: Env, _ctx: unknown): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }
    const auth = request.headers.get('x-cron-secret')
    if (!constantTimeEqual(auth, env.CRON_SECRET)) {
      return new Response('Unauthorized', { status: 401 })
    }
    await runAllCrons(env)
    return new Response('OK', { status: 200 })
  },
}

async function runAllCrons(env: Env): Promise<void> {
  await runFastCrons(env)
  await callCron(env, '/api/cron/auto-reminders')
  await callCron(env, '/api/cron/recurring-invoices')
  await callCron(env, '/api/cron/chantier-period-invoices')
  await callCron(env, '/api/cron/member-token-reminders')
}

async function runFastCrons(env: Env): Promise<void> {
  await callCron(env, '/api/cron/operator-usage-sync')
  await callCron(env, '/api/cron/operator-signup-sync')
  await callCron(env, '/api/cron/onboarding-reminders')
}

async function callCron(env: Env, path: string): Promise<void> {
  const url = `${env.APP_URL}${path}`
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
      console.error(`[cron worker] ${path} returned ${res.status}:`, data)
    } else {
      console.log(`[cron worker] ${path}:`, JSON.stringify(data))
    }
  } catch (err) {
    console.error(`[cron worker] ${path} fetch error:`, err)
  }
}
