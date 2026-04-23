import { createHmac, timingSafeEqual } from 'crypto'

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

export function signOperatorPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

export function verifyOperatorSignature(payload: string, secret: string, provided: string | null): boolean {
  if (!provided) return false

  const expected = signOperatorPayload(payload, secret)
  const expectedBuffer = Buffer.from(expected)
  const providedBuffer = Buffer.from(provided)

  if (expectedBuffer.length !== providedBuffer.length) return false

  return timingSafeEqual(expectedBuffer, providedBuffer)
}

