import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertSafeExternalFetchUrl, constantTimeEqual, createSignatureTokenGrant,
  isPrivateHostname, isSignatureTokenFresh, redactForLog, SIGNATURE_TOKEN_TTL_MS,
} from '@/lib/security'
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


describe('signature token grants', () => {
  it('creates distinct tokens with finite expiry', () => {
    const now = Date.now()
    const first = createSignatureTokenGrant()
    const second = createSignatureTokenGrant()

    expect(first.token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    expect(second.token).not.toBe(first.token)
    expect(Date.parse(first.expiresAt)).toBeGreaterThan(now + SIGNATURE_TOKEN_TTL_MS - 1000)
    expect(Date.parse(first.expiresAt)).toBeLessThanOrEqual(now + SIGNATURE_TOKEN_TTL_MS + 1000)
  })

  it.each([null, undefined, ''])('fails closed when expiry is absent (%s)', expiresAt => {
    expect(isSignatureTokenFresh(expiresAt)).toBe(false)
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

describe('assertSafeExternalFetchUrl — hôtes internes', () => {
  const unsafe = [
    'https://localhost/logo.png',
    'https://127.0.0.1/x.png',
    'https://169.254.169.254/latest/meta-data/',
    'https://10.1.2.3/x.png',
    'https://192.168.0.10/x.png',
    'https://172.16.5.4/x.png',
    'https://[::1]/x.png',
    'https://service.internal/x.png',
  ]

  for (const url of unsafe) {
    it(`refuse ${url}`, () => {
      expect(assertSafeExternalFetchUrl(url)).toBeNull()
    })
  }

  const safe = [
    'https://example.com/logo.png',
    'https://abc.supabase.co/storage/v1/object/sign/x',
    'https://172.32.0.1/x.png',
  ]

  for (const url of safe) {
    it(`accepte ${url}`, () => {
      expect(assertSafeExternalFetchUrl(url)).not.toBeNull()
    })
  }

  it('refuse un schéma non https et des credentials embarqués', () => {
    expect(assertSafeExternalFetchUrl('http://example.com/x')).toBeNull()
    expect(assertSafeExternalFetchUrl('https://user:pass@example.com/x')).toBeNull()
  })
})

describe('isPrivateHostname — IPv6 literals only', () => {
  it.each(['fc.example.com', 'fd.example.com', 'fe80.example.com', 'fcdomain.example'])(
    'does not classify public hostname %s as an IPv6 private range',
    (hostname) => expect(isPrivateHostname(hostname)).toBe(false),
  )

  it.each(['fc00::1', 'fd12::1', 'fe80::1', '::1', '::', '::ffff:127.0.0.1', '::ffff:192.168.1.20'])(
    'rejects private IPv6 literal %s',
    (hostname) => expect(isPrivateHostname(hostname)).toBe(true),
  )

  it.each(['2001:db8::1', '::ffff:8.8.8.8'])(
    'allows public IPv6 literal %s',
    (hostname) => expect(isPrivateHostname(hostname)).toBe(false),
  )
})
