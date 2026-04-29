import 'server-only'
import { createHash } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'

export type RateLimitInput = {
  scope: string
  identifier: string
  limit: number
  windowSeconds: number
}

export type RateLimitResult = {
  allowed: boolean
  scope: string
  limit: number
  windowSeconds: number
}

function getRateLimitSalt(): string {
  return process.env.RATE_LIMIT_SECRET
    || process.env.CRON_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || 'atelier-rate-limit'
}

export function hashRateLimitIdentifier(identifier: string): string {
  return createHash('sha256')
    .update(`${getRateLimitSalt()}:${identifier}`)
    .digest('hex')
}

export function getClientIp(headers: Pick<Headers, 'get'>): string {
  return headers.get('cf-connecting-ip')
    || headers.get('x-real-ip')
    || headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown'
}

export async function checkRateLimit(input: RateLimitInput): Promise<RateLimitResult> {
  if (input.limit <= 0 || input.windowSeconds <= 0) {
    return {
      allowed: false,
      scope: input.scope,
      limit: input.limit,
      windowSeconds: input.windowSeconds,
    }
  }

  const now = Date.now()
  const windowMs = input.windowSeconds * 1000
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs).toISOString()
  const admin = createAdminClient()

  const { data, error } = await admin.rpc('check_rate_limit', {
    p_scope: input.scope,
    p_identifier_hash: hashRateLimitIdentifier(input.identifier),
    p_limit: input.limit,
    p_window_start: windowStart,
  })

  if (error) {
    console.error('[rate-limit]', error)
    return {
      allowed: true,
      scope: input.scope,
      limit: input.limit,
      windowSeconds: input.windowSeconds,
    }
  }

  return {
    allowed: data === true,
    scope: input.scope,
    limit: input.limit,
    windowSeconds: input.windowSeconds,
  }
}

export async function checkAIRateLimit(params: {
  organizationId: string
  feature: string
}): Promise<RateLimitResult> {
  return checkRateLimit({
    scope: `ai:${params.feature}`,
    identifier: params.organizationId,
    limit: Number.parseInt(process.env.AI_RATE_LIMIT_PER_HOUR ?? '120', 10),
    windowSeconds: 60 * 60,
  })
}
