import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { signOauthState, verifyOauthState } from '@/lib/super-pdp/oauth-state'

beforeEach(() => {
  vi.stubEnv('OPERATOR_CONFIG_SYNC_SECRET', 'oauth-state-secret')
  vi.stubEnv('OPERATOR_INGEST_SECRET', 'fallback-secret')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('signOauthState / verifyOauthState', () => {
  it('round-trips source_instance and organization_id', () => {
    const state = signOauthState('atelier-app', 'org-123')
    const payload = verifyOauthState(state)

    expect(payload).not.toBeNull()
    expect(payload?.source_instance).toBe('atelier-app')
    expect(payload?.organization_id).toBe('org-123')
  })

  it('rejects a tampered payload', () => {
    const state = signOauthState('atelier-app', 'org-123')
    const [encoded, signature] = state.split('.')
    const tampered = `${encoded}x.${signature}`

    expect(verifyOauthState(tampered)).toBeNull()
  })

  it('rejects a state signed with a different secret', () => {
    const state = signOauthState('atelier-app', 'org-123')
    vi.stubEnv('OPERATOR_CONFIG_SYNC_SECRET', 'a-different-secret')
    vi.stubEnv('OPERATOR_INGEST_SECRET', 'a-different-secret')

    expect(verifyOauthState(state)).toBeNull()
  })

  it('rejects null, empty, or malformed input', () => {
    expect(verifyOauthState(null)).toBeNull()
    expect(verifyOauthState('')).toBeNull()
    expect(verifyOauthState('not-a-valid-state')).toBeNull()
  })

  it('rejects an expired state', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const state = signOauthState('atelier-app', 'org-123')

    vi.setSystemTime(new Date('2026-01-01T00:11:00Z')) // TTL = 10 min
    expect(verifyOauthState(state)).toBeNull()
  })

  it('accepts a state within the TTL window', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const state = signOauthState('atelier-app', 'org-123')

    vi.setSystemTime(new Date('2026-01-01T00:09:00Z'))
    expect(verifyOauthState(state)).not.toBeNull()
  })

  it('produces a different nonce on each call', () => {
    const stateA = signOauthState('atelier-app', 'org-123')
    const stateB = signOauthState('atelier-app', 'org-123')

    expect(stateA).not.toBe(stateB)
  })
})
