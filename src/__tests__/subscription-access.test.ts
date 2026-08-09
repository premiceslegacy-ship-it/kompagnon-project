import { describe, expect, it } from 'vitest'
import {
  entitlementFromDb,
  getDisplayAccessStatus,
  hasActiveAccess,
  isSellableTier,
  type OrganizationEntitlement,
} from '@/lib/subscription-access'

function entitlement(overrides: Partial<OrganizationEntitlement> = {}): OrganizationEntitlement {
  return {
    organizationId: '10000000-0000-4000-8000-000000000001',
    accessStatus: 'locked',
    effectiveTier: 'setup_only',
    preferredTier: 'pro',
    trialStartedAt: null,
    trialEndsAt: null,
    accessEndsAt: null,
    ...overrides,
  }
}

describe('subscription access', () => {
  it('n’expose que Pro et Expert comme offres vendables', () => {
    expect(isSellableTier('pro')).toBe(true)
    expect(isSellableTier('expert')).toBe(true)
    expect(isSellableTier('starter')).toBe(false)
    expect(isSellableTier('setup_only')).toBe(false)
  })

  it('verrouille localement un essai expiré même sans passage du cron', () => {
    const now = Date.parse('2026-08-09T12:00:00.000Z')
    const expiredTrial = entitlement({ accessStatus: 'trialing', trialEndsAt: '2026-08-09T11:59:59.000Z' })
    expect(hasActiveAccess(expiredTrial, now)).toBe(false)
    expect(getDisplayAccessStatus(expiredTrial, now)).toBe('expired')
  })

  it('maintient past_due pendant les relances et ferme unpaid', () => {
    expect(hasActiveAccess(entitlement({ accessStatus: 'past_due' }))).toBe(true)
    expect(hasActiveAccess(entitlement({ accessStatus: 'unpaid' }))).toBe(false)
  })

  it('maintient une résiliation jusqu’à sa date exacte', () => {
    const now = Date.parse('2026-08-09T12:00:00.000Z')
    expect(hasActiveAccess(entitlement({ accessStatus: 'canceling', accessEndsAt: '2026-09-08T12:00:00.000Z' }), now)).toBe(true)
    expect(hasActiveAccess(entitlement({ accessStatus: 'canceling', accessEndsAt: '2026-08-09T11:00:00.000Z' }), now)).toBe(false)
  })

  it('rejette un miroir incomplet plutôt que de laisser passer', () => {
    expect(entitlementFromDb({ organization_id: 'org', access_status: 'active', effective_tier: 'pro', preferred_tier: 'starter' })).toBeNull()
  })
})
