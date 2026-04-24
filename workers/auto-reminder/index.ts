/**
 * Cloudflare Worker — Crons automatiques Atelier
 *
 * Déclenché chaque matin à 8h (cron schedule dans wrangler.toml).
 * Appelle séquentiellement les API routes Next.js sécurisées par CRON_SECRET :
 *   1. /api/cron/auto-reminders    — relances devis/factures en retard (IA)
 *   2. /api/cron/recurring-invoices — brouillons récurrents + auto-envoi PDF si délai expiré
 *
 * Variables d'environnement à configurer dans Cloudflare Dashboard :
 *   APP_URL      → URL de l'app (ex: https://atelier-weber.workers.dev)
 *   CRON_SECRET  → même valeur que dans les variables du Worker app
 */

export interface Env {
  APP_URL: string
  CRON_SECRET: string
}

export default {
  async scheduled(_event: { scheduledTime: number }, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(runAllCrons(env))
  },

  async fetch(request: Request, env: Env, _ctx: unknown): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }
    const auth = request.headers.get('x-cron-secret')
    if (!auth || auth !== env.CRON_SECRET) {
      return new Response('Unauthorized', { status: 401 })
    }
    await runAllCrons(env)
    return new Response('OK', { status: 200 })
  },
}

async function runAllCrons(env: Env): Promise<void> {
  await callCron(env, '/api/cron/auto-reminders')
  await callCron(env, '/api/cron/recurring-invoices')
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
