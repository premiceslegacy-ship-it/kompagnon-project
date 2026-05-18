/**
 * Compare two strings without early-exit on matching-length inputs.
 * Length mismatch still fails fast because the secret length is not treated as
 * sensitive in Atelier tokens, but matching-length values are compared in full.
 */
export function constantTimeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false

  const encoder = new TextEncoder()
  const left = encoder.encode(a)
  const right = encoder.encode(b)

  if (left.length !== right.length) return false

  let diff = 0
  for (let i = 0; i < left.length; i += 1) {
    diff |= left[i] ^ right[i]
  }

  return diff === 0
}

const SENSITIVE_LOG_KEY = /token|secret|password|authorization|signature|cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|email|phone|address|ip|user[_-]?agent/i

/**
 * Redacts common secrets and PII before values are sent to logs.
 * Keep this deliberately conservative: logs should preserve shape, not payloads.
 */
export function redactForLog(value: unknown, depth = 0): unknown {
  if (value == null) return value
  if (depth > 3) return '[redacted:depth]'

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
    }
  }

  if (typeof value === 'string') {
    if (value.length > 120) return `${value.slice(0, 120)}...[redacted:${value.length}]`
    return value
  }

  if (typeof value !== 'object') return value

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redactForLog(item, depth + 1))
  }

  const redacted: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    redacted[key] = SENSITIVE_LOG_KEY.test(key) ? '[redacted]' : redactForLog(item, depth + 1)
  }
  return redacted
}

export function assertSafeExternalFetchUrl(rawUrl: string | null | undefined): URL | null {
  if (!rawUrl) return null

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }

  if (url.protocol !== 'https:') return null
  if (!url.hostname || url.username || url.password) return null

  return url
}
