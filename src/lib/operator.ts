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

// ─── Secret par instance ────────────────────────────────────────────────────
// Un secret unique partagé par toutes les instances laisse un Worker client
// compromis signer des requêtes au nom de n'importe quel autre client (ingest
// falsifié, portail Stripe d'un autre, e-facture émise avec ses tokens OAuth).
// Le cockpit ne détient que le master ; chaque instance ne reçoit que le secret
// dérivé de son propre source_instance, qui n'ouvre rien d'autre.
const INSTANCE_SECRET_CONTEXT = 'operator-instance:v1:'

export function deriveInstanceSecret(master: string, sourceInstance: string): string {
  return createHmac('sha256', master).update(`${INSTANCE_SECRET_CONTEXT}${sourceInstance}`).digest('hex')
}

/**
 * Secret à utiliser pour signer (instance) ou vérifier (instance, côté
 * réception cockpit→instance) une requête. Une instance ne détient que son
 * secret dérivé (OPERATOR_INGEST_SECRET / OPERATOR_CONFIG_SYNC_SECRET) ; seul
 * le cockpit détient le master et doit le vérifier avec `requireMaster`.
 */
export function hasOperatorSigningSecret(): boolean {
  return Boolean(
    process.env.OPERATOR_MASTER_SECRET?.trim()
    || process.env.OPERATOR_CONFIG_SYNC_SECRET?.trim()
    || process.env.OPERATOR_INGEST_SECRET?.trim(),
  )
}

export function hasOperatorMasterSecret(): boolean {
  return Boolean(process.env.OPERATOR_MASTER_SECRET?.trim())
}

/**
 * Clé d'empreinte des essais : dérivée du master avec un contexte propre, pas
 * du secret d'une instance nommée « probe » (qui pourrait la détenir).
 */
export function getOperatorFingerprintSecret(): string | null {
  const explicit = process.env.OPERATOR_TRIAL_FINGERPRINT_SECRET?.trim()
  if (explicit) return explicit
  const master = process.env.OPERATOR_MASTER_SECRET?.trim()
  if (!master) return null
  return createHmac('sha256', master).update('operator-trial-fingerprint:v1').digest('hex')
}

export function getOperatorSigningSecret(sourceInstance: string): string | null {
  const master = process.env.OPERATOR_MASTER_SECRET?.trim()
  if (master) return deriveInstanceSecret(master, sourceInstance)

  return process.env.OPERATOR_CONFIG_SYNC_SECRET?.trim()
    || process.env.OPERATOR_INGEST_SECRET?.trim()
    || null
}

export const OPERATOR_TIMESTAMP_HEADER = 'x-operator-timestamp'
/** Les charges utiles opérateur (XML e-facture inclus) restent sous 2 Mio. */
const OPERATOR_MAX_BODY_BYTES = 2 * 1024 * 1024
const OPERATOR_TEXT_ENCODER = new TextEncoder()
const OPERATOR_MAX_SKEW_MS = 5 * 60 * 1000

/** Le timestamp borne le rejeu aux ±5 minutes ; l'idempotence relève de chaque opération. */
export function operatorSignedString(timestamp: string, body: string): string {
  return `${timestamp}.${body}`
}

export function signOperatorRequest(body: string, secret: string, timestamp = Date.now().toString()): {
  signature: string
  timestamp: string
} {
  return { signature: signOperatorPayload(operatorSignedString(timestamp, body), secret), timestamp }
}

/**
 * Vérifie une requête serveur-à-serveur : horodatage obligatoire et frais
 * (±5 min), puis signature en temps constant. Plus de repli sans horodatage :
 * il rendait toute requête capturée rejouable indéfiniment.
 *
 * `requireMaster` (routes du cockpit) : n'accepte que le secret dérivé du
 * master. Sans lui, un cockpit privé du master vérifierait avec le secret
 * partagé historique et n'importe quelle instance pourrait signer pour une autre.
 */
export function verifyOperatorRequest(params: {
  body: string
  sourceInstance: string
  signature: string | null
  timestamp: string | null
  requireMaster?: boolean
}): boolean {
  const master = process.env.OPERATOR_MASTER_SECRET?.trim()
  const secret = params.requireMaster
    ? (master ? deriveInstanceSecret(master, params.sourceInstance) : null)
    : getOperatorSigningSecret(params.sourceInstance)
  if (!secret) return false

  if (!params.timestamp) return false

  const issuedAt = Number(params.timestamp)
  if (!Number.isFinite(issuedAt) || Math.abs(Date.now() - issuedAt) > OPERATOR_MAX_SKEW_MS) {
    return false
  }

  return verifyOperatorSignature(operatorSignedString(params.timestamp, params.body), secret, params.signature)
}

export type OperatorRequestCheck<T> =
  | { ok: true; sourceInstance: string; body: T }
  | { ok: false; status: 400 | 401 | 413; error: string }

/**
 * Lit et authentifie une requête serveur-à-serveur en une passe : le
 * `source_instance` du corps sélectionne le secret dérivé, donc un porteur du
 * secret d'une instance ne peut pas signer pour une autre. Le corps est
 * parsé une seule fois, avant toute lecture de champ.
 */
export function readOperatorRequest<T extends { source_instance?: unknown }>(
  rawBody: string,
  headers: Pick<Headers, 'get'>,
  options: { requireMaster?: boolean } = {},
): OperatorRequestCheck<T> {
  // Refus avant tout parsing : signature absente, corps démesuré, horodatage
  // invalide. Sans cela, n'importe qui fait parser du JSON arbitraire sur
  // toutes les routes opérateur (elles sont publiques dans le middleware).
  if (!headers.get('x-operator-signature')) {
    return { ok: false, status: 401, error: 'Unauthorized' }
  }
  if (OPERATOR_TEXT_ENCODER.encode(rawBody).byteLength > OPERATOR_MAX_BODY_BYTES) {
    return { ok: false, status: 413, error: 'Payload too large' }
  }
  const timestamp = headers.get(OPERATOR_TIMESTAMP_HEADER)
  // Millisecond Unix timestamps are emitted by signOperatorRequest. Reject
  // alternate numeric spellings so callers and signatures use one canonical form.
  if (timestamp === null || !/^\d{13}$/.test(timestamp)) {
    return { ok: false, status: 401, error: 'Unauthorized' }
  }

  let body: T
  try {
    body = JSON.parse(rawBody) as T
  } catch {
    return { ok: false, status: 400, error: 'Invalid JSON' }
  }

  // Pas de trim : les routes lisent `body.source_instance` tel quel, l'identité
  // authentifiée doit être exactement celle qui sera écrite en base.
  const sourceInstance = typeof body?.source_instance === 'string' ? body.source_instance : ''
  if (!sourceInstance || sourceInstance !== sourceInstance.trim()) {
    return { ok: false, status: 400, error: 'source_instance requis' }
  }

  const valid = verifyOperatorRequest({
    body: rawBody,
    sourceInstance,
    signature: headers.get('x-operator-signature'),
    timestamp,
    requireMaster: options.requireMaster,
  })

  if (!valid) return { ok: false, status: 401, error: 'Unauthorized' }

  return { ok: true, sourceInstance, body }
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
