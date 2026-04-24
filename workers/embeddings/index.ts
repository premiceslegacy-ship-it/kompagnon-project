/**
 * Cloudflare Worker — Génération embeddings company_memory
 *
 * Déclenché toutes les heures. Appelle l'API route Next.js sécurisée par CRON_SECRET.
 * Traite 50 entrées max par run (embedding IS NULL AND is_active = true).
 *
 * Variables d'environnement à configurer dans Cloudflare Dashboard :
 *   APP_URL      → URL de l'app (ex: https://atelier-weber.vercel.app)
 *   CRON_SECRET  → même valeur que dans .env.local de l'app
 */

export interface Env {
  APP_URL: string
  CRON_SECRET: string
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(triggerEmbeddings(env))
  },

  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }
    const auth = request.headers.get('x-cron-secret')
    if (!auth || auth !== env.CRON_SECRET) {
      return new Response('Unauthorized', { status: 401 })
    }
    await triggerEmbeddings(env)
    return new Response('OK', { status: 200 })
  },
}

async function triggerEmbeddings(env: Env): Promise<void> {
  const url = `${env.APP_URL}/api/cron/embeddings`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'x-cron-secret': env.CRON_SECRET,
      'Content-Type': 'application/json',
    },
  })

  if (!res.ok) {
    const body = await res.text()
    console.error(`[embeddings worker] API returned ${res.status}: ${body}`)
    return
  }

  const data = await res.json() as { processed: number; updated: number; errors: number }
  console.log(`[embeddings worker] processed=${data.processed} updated=${data.updated} errors=${data.errors}`)
}
