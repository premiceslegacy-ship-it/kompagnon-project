/**
 * Cloudflare Worker — Recyclage des données Supabase
 *
 * Déclenché tous les jours à 4h30 UTC. Appelle l'API route Next.js sécurisée
 * par CRON_SECRET, qui purge les données techniques périmées (logs, propositions
 * Sarah expirées, briefs consommés) et sert de keep-alive pour éviter la pause
 * automatique du projet Supabase Free après 7 jours d'inactivité.
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
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // Les deux tâches sont indépendantes : l'échec de l'une ne doit pas
    // empêcher l'autre. `account-deletion` exécute l'effacement RGPD demandé
    // 30 jours plus tôt — sans ce déclencheur, la promesse de la page
    // confidentialité n'était jamais tenue.
    ctx.waitUntil(Promise.all([triggerDataRetention(env), triggerAccountDeletion(env)]))
  },

  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }
    const auth = request.headers.get('x-cron-secret')
    if (!constantTimeEqual(auth, env.CRON_SECRET)) {
      return new Response('Unauthorized', { status: 401 })
    }
    await Promise.all([triggerDataRetention(env), triggerAccountDeletion(env)])
    return new Response('OK', { status: 200 })
  },
}

async function triggerDataRetention(env: Env): Promise<void> {
  const url = `${env.APP_URL}/api/cron/data-retention`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'x-cron-secret': env.CRON_SECRET,
      'Content-Type': 'application/json',
    },
  })

  if (!res.ok) {
    const body = await res.text()
    console.error(`[data-retention worker] API returned ${res.status}: ${body}`)
    return
  }

  const data = await res.json() as { ok: boolean; results: Record<string, number | string> }
  console.log(`[data-retention worker] ${JSON.stringify(data.results)}`)
}

async function triggerAccountDeletion(env: Env): Promise<void> {
  const res = await fetch(`${env.APP_URL}/api/cron/account-deletion`, {
    method: 'POST',
    headers: {
      'x-cron-secret': env.CRON_SECRET,
      'Content-Type': 'application/json',
    },
  })

  if (!res.ok) {
    console.error(`[account-deletion worker] API returned ${res.status}: ${await res.text()}`)
    return
  }

  const data = await res.json() as { ok: boolean; processed: number }
  console.log(`[account-deletion worker] processed=${data.processed}`)
}
