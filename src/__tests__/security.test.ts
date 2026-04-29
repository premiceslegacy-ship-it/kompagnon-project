import { describe, expect, it, vi, beforeEach } from 'vitest'
import { constantTimeEqual } from '@/lib/security'
import { verifyCronSecret } from '@/lib/cron-auth'
import { hashRateLimitIdentifier } from '@/lib/rate-limit'

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
})
