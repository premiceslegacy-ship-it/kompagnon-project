import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { signOauthState, verifyOauthState } from '@/lib/super-pdp/oauth-state'
import { deriveInstanceSecret, signOperatorPayload } from '@/lib/operator'

beforeEach(() => {
  vi.stubEnv('OPERATOR_MASTER_SECRET', 'a'.repeat(64))
  vi.stubEnv('OPERATOR_CONFIG_SYNC_SECRET', '')
  vi.stubEnv('OPERATOR_INGEST_SECRET', '')
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
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString())
    payload.organization_id = 'another-org'
    const tampered = `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${signature}`

    expect(verifyOauthState(tampered)).toBeNull()
  })

  it('rejects a state signed with a different master', () => {
    const state = signOauthState('atelier-app', 'org-123')
    vi.stubEnv('OPERATOR_MASTER_SECRET', 'b'.repeat(64))

    expect(verifyOauthState(state)).toBeNull()
  })

  it('rejects null, empty, or malformed input', () => {
    expect(verifyOauthState(null)).toBeNull()
    expect(verifyOauthState('')).toBeNull()
    expect(verifyOauthState('not-a-valid-state')).toBeNull()
    expect(verifyOauthState(`${Buffer.from('null').toString('base64url')}.${'0'.repeat(64)}`)).toBeNull()
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

  it('accepts an instance-signed state in a master-only cockpit', () => {
    const master = 'a'.repeat(64)
    vi.stubEnv('OPERATOR_MASTER_SECRET', '')
    vi.stubEnv('OPERATOR_CONFIG_SYNC_SECRET', deriveInstanceSecret(master, 'atelier-app'))
    vi.stubEnv('OPERATOR_INGEST_SECRET', '')
    const state = signOauthState('atelier-app', 'org-123')

    vi.stubEnv('OPERATOR_MASTER_SECRET', master)
    vi.stubEnv('OPERATOR_CONFIG_SYNC_SECRET', '')
    expect(verifyOauthState(state)?.organization_id).toBe('org-123')
  })

  it('rejects verification without a master even when a matching legacy alias exists', () => {
    const state = signOauthState('atelier-app', 'org-123')
    vi.stubEnv('OPERATOR_MASTER_SECRET', '')
    vi.stubEnv('OPERATOR_CONFIG_SYNC_SECRET', deriveInstanceSecret('a'.repeat(64), 'atelier-app'))

    expect(verifyOauthState(state)).toBeNull()
  })

  it('rejects another instance signed with the caller instance secret', () => {
    const encoded = Buffer.from(JSON.stringify({
      source_instance: 'another-instance',
      organization_id: 'org-123',
      nonce: crypto.randomUUID(),
      issued_at: Date.now(),
    })).toString('base64url')
    const attackerSecret = deriveInstanceSecret('a'.repeat(64), 'atelier-app')
    const forged = `${encoded}.${signOperatorPayload(encoded, attackerSecret)}`

    expect(verifyOauthState(forged)).toBeNull()
  })
})
