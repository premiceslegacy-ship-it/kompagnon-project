/**
 * Cloudflare Worker — Relances automatiques Kompagnon
 *
 * Déclenché chaque matin à 8h (cron schedule dans wrangler.toml).
 * Appelle simplement l'API route Next.js sécurisée par CRON_SECRET.
 *
 * Variables d'environnement à configurer dans Cloudflare Dashboard :
 *   APP_URL      → URL de l'app (ex: https://kompagnon-weber.vercel.app)
 *   CRON_SECRET  → même valeur que dans .env.local de l'app
 */

export interface Env {
  APP_URL: string
  CRON_SECRET: string
}

export default {
  // Déclenché par le cron schedule
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(triggerReminders(env))
  },

  // Déclenché manuellement via HTTP (pour tester)
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }
    const auth = request.headers.get('x-cron-secret')
    if (!auth || auth !== env.CRON_SECRET) {
      return new Response('Unauthorized', { status: 401 })
    }
    await triggerReminders(env)
    return new Response('OK', { status: 200 })
  },
}

async function triggerReminders(env: Env): Promise<void> {
  const url = `${env.APP_URL}/api/cron/auto-reminders`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'x-cron-secret': env.CRON_SECRET,
      'Content-Type': 'application/json',
    },
  })

  if (!res.ok) {
    const body = await res.text()
    console.error(`[auto-reminder worker] API returned ${res.status}: ${body}`)
    return
  }

  const data = await res.json() as { processed: number; sent: number; errors: number }
  console.log(`[auto-reminder worker] processed=${data.processed} sent=${data.sent} errors=${data.errors}`)
}
