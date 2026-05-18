import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertSafeExternalFetchUrl, constantTimeEqual, redactForLog } from '@/lib/security'
import { verifyCronSecret } from '@/lib/cron-auth'
import { hashRateLimitIdentifier } from '@/lib/rate-limit'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('constantTimeEqual', () => {
  it('accepts equal strings', () => {
    expect(constantTimeEqual('secret', 'secret')).toBe(true)
  })

  it('rejects different same-length strings', () => {
    expect(constantTimeEqual('secret', 'secres')).toBe(false)
  })

  it('rejects missing or different-length values', () => {
    expect(constantTimeEqual(null, 'secret')).toBe(false)
    expect(constantTimeEqual('secret', 'secret-longer')).toBe(false)
  })
})

describe('verifyCronSecret', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'cron-secret')
  })

  it('validates the configured cron secret', () => {
    expect(verifyCronSecret('cron-secret')).toBe(true)
    expect(verifyCronSecret('wrong-value')).toBe(false)
  })
})

describe('hashRateLimitIdentifier', () => {
  beforeEach(() => {
    vi.stubEnv('RATE_LIMIT_SECRET', 'rate-limit-salt-a')
  })

  it('hashes identifiers deterministically without exposing raw input', () => {
    const hash = hashRateLimitIdentifier('org@example.com')

    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(hash).toBe(hashRateLimitIdentifier('org@example.com'))
    expect(hash).not.toContain('org@example.com')
  })

  it('changes when the salt changes', () => {
    const first = hashRateLimitIdentifier('same-id')
    vi.stubEnv('RATE_LIMIT_SECRET', 'rate-limit-salt-b')

    expect(hashRateLimitIdentifier('same-id')).not.toBe(first)
  })

  it('requires a dedicated salt in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('RATE_LIMIT_SECRET', '')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role')

    expect(() => hashRateLimitIdentifier('same-id')).toThrow('RATE_LIMIT_SECRET is required')

    vi.stubEnv('RATE_LIMIT_SECRET', 'service-role')
    expect(() => hashRateLimitIdentifier('same-id')).toThrow('must be distinct')
  })
})

describe('redactForLog', () => {
  it('redacts common PII and secret keys while preserving log shape', () => {
    expect(redactForLog({
      email: 'client@example.com',
      token: 'secret-token',
      status: 'failed',
      nested: { userAgent: 'Mozilla/5.0', count: 2 },
    })).toEqual({
      email: '[redacted]',
      token: '[redacted]',
      status: 'failed',
      nested: { userAgent: '[redacted]', count: 2 },
    })
  })

  it('does not dump long strings verbatim', () => {
    const redacted = redactForLog('a'.repeat(180))

    expect(redacted).toContain('[redacted:180]')
    expect(String(redacted).length).toBeLessThan(160)
  })
})

describe('assertSafeExternalFetchUrl', () => {
  it('allows only plain https URLs', () => {
    expect(assertSafeExternalFetchUrl('https://example.com/logo.png')?.href).toBe('https://example.com/logo.png')
    expect(assertSafeExternalFetchUrl('http://example.com/logo.png')).toBeNull()
    expect(assertSafeExternalFetchUrl('https://user:pass@example.com/logo.png')).toBeNull()
    expect(assertSafeExternalFetchUrl('not-a-url')).toBeNull()
  })
})
