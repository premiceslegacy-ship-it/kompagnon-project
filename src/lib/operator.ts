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

export function getOperatorSourceInstance(): string {
  const explicit = process.env.OPERATOR_SOURCE_INSTANCE?.trim()
  if (explicit) return explicit

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (appUrl) {
    try {
      return new URL(appUrl).host
    } catch {
      return appUrl
    }
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
