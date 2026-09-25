import { createHmac } from 'crypto'

export type OperatorUsageEventPayload = {
  source_instance: string
  organization_id: string
  occurred_at: string
  provider: string
  feature: string
  model: string
  provider_cost: number | null
  currency: string
  total_tokens: number | null
  status: string
  local_usage_log_id: string
  quota_feature?: string | null
  quota_unit?: string | null
  quota_quantity?: number | null
  overflow_mode?: string | null
  over_quota?: boolean | null
  metadata?: Record<string, unknown> | null
}

export function getOperatorAllowedEmails(): string[] {
  return (process.env.OPERATOR_ALLOWED_EMAILS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
}

export function isOperatorEmailAllowed(email: string | null | undefined): boolean {
  if (!email) return false
  const allowed = getOperatorAllowedEmails()
  if (allowed.length === 0) return false
  return allowed.includes(email.trim().toLowerCase())
}

// Domaines qui ne désignent jamais un client (le cockpit lui-même, ou un
// worker brut sans nom de client attribué). Si OPERATOR_SOURCE_INSTANCE
// n'est pas défini et que le fallback sur NEXT_PUBLIC_APP_URL retombe sur
// un de ces hosts, on refuse de fabriquer un identifiant de client : le
// cockpit auto-crée une fiche "client" au premier événement reçu pour tout
// source_instance inconnu (src/app/api/operator/ingest/route.ts), donc un
// fallback silencieux ici a déjà créé par erreur une fiche client nommée
// d'après le domaine de l'app elle-même (ex: app.atelier-btp.fr, 9 sept.
// 2026) au lieu du nom du client attendu.
const OPERATOR_NON_CLIENT_HOSTS = new Set(['orsayn-cockpit.mbebourasam.workers.dev', 'localhost'])

export function getOperatorSourceInstance(): string {
  const explicit = process.env.OPERATOR_SOURCE_INSTANCE?.trim()
  if (explicit) return explicit

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (appUrl) {
    let host: string
    try {
      host = new URL(appUrl).host
    } catch {
      host = appUrl
    }

    if (OPERATOR_NON_CLIENT_HOSTS.has(host)) {
      console.warn(
        `[operator] OPERATOR_SOURCE_INSTANCE absent et host "${host}" identifié comme non-client — ` +
          'utilisation de "unknown-instance" pour éviter de créer une fiche client erronée dans le cockpit.',
      )
      return 'unknown-instance'
    }

    // host non reconnu comme non-client (probable domaine client réel, ex:
    // app.atelier-btp.fr) : on le garde pour ne pas perdre l'événement, mais
    // on log pour repérer les instances où OPERATOR_SOURCE_INSTANCE n'a pas
    // été injecté côté Cloudflare — c'est ce défaut d'injection qui a créé
    // la fiche client erronée à l'origine de ce garde-fou.
    console.warn(
      `[operator] OPERATOR_SOURCE_INSTANCE absent, fallback sur le domaine "${host}" — ` +
        'vérifier l\'injection des variables Cloudflare pour cette instance.',
    )
    return host
  }

  return 'unknown-instance'
}

export function getOperatorUsdToEurRate(): number {
  const raw = process.env.OPERATOR_USD_TO_EUR_RATE?.trim()
  const parsed = raw ? Number.parseFloat(raw) : Number.NaN

  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed
  }

  return 0.92
}

export function signOperatorPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

export function verifyOperatorSignature(payload: string, secret: string, provided: string | null): boolean {
  if (!provided) return false

  const expected = signOperatorPayload(payload, secret)

  // Comparaison constant-time sans `Buffer`/`crypto.timingSafeEqual` (Node) :
  // ces primitives ne sont pas fiables sur le runtime Cloudflare Workers.
  if (expected.length !== provided.length) return false

  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i)
  }

  return diff === 0
}
