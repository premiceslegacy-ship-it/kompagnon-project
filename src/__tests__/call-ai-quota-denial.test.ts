import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as QuotaModule from '@/lib/quota'

const mocks = vi.hoisted(() => ({
  checkQuota: vi.fn(),
  checkAIRateLimit: vi.fn(),
  isModuleEnabledAdmin: vi.fn(),
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/quota', async (importOriginal) => {
  const actual = await importOriginal<typeof QuotaModule>()
  return { ...actual, checkQuota: mocks.checkQuota }
})
vi.mock('@/lib/rate-limit', () => ({ checkAIRateLimit: mocks.checkAIRateLimit }))
vi.mock('@/lib/data/queries/organization-modules', () => ({ isModuleEnabledAdmin: mocks.isModuleEnabledAdmin }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { AIQuotaExceededError } from '@/lib/quota'
import { AIQuotaUnavailableError, callAI } from '@/lib/ai/callAI'

const params = {
  organizationId: 'org-1',
  provider: 'openrouter' as const,
  feature: 'quote_analysis' as const,
  model: 'provider-model',
  inputKind: 'text' as const,
  request: { body: { messages: [{ role: 'user', content: 'hello' }] } },
}

const allowedRateLimit = { allowed: true, limit: 100, windowSeconds: 60 }

function deniedQuota(overrides: Record<string, unknown> = {}) {
  return {
    allowed: false,
    aiBillingMode: 'orsayn_shared',
    quotaFeature: 'quote_analysis',
    quotaUnit: 'call',
    quotaMonthly: null,
    usedQuantity: 0,
    requestedQuantity: 1,
    remaining: null,
    overflowMode: 'block',
    overQuota: false,
    ...overrides,
  }
}

function setupReservationRelease() {
  const eq = vi.fn(() => ({ eq }))
  const remove = vi.fn(() => ({ eq }))
  mocks.createAdminClient.mockReturnValue({
    from: vi.fn(() => ({ delete: remove })),
  })
  return { remove, eq }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('callAI quota denial', () => {
  it('fails closed on an unavailable quota read before any provider request', async () => {
    const { remove, eq } = setupReservationRelease()
    const fetch = vi.spyOn(globalThis, 'fetch')
    mocks.checkQuota.mockResolvedValueOnce(deniedQuota({ reservationId: 'reservation-1' }))
    mocks.checkAIRateLimit.mockResolvedValueOnce(allowedRateLimit)
    mocks.isModuleEnabledAdmin.mockResolvedValueOnce(true)

    await expect(callAI(params)).rejects.toBeInstanceOf(AIQuotaUnavailableError)

    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.isModuleEnabledAdmin).toHaveBeenCalledWith('org-1', 'quote_ai')
    expect(mocks.createAdminClient).toHaveBeenCalledTimes(2)
    expect(remove).toHaveBeenCalledTimes(1)
    expect(eq).toHaveBeenCalledTimes(2)
  })

  it('keeps numeric quota denials distinguishable from unavailable quota state', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    mocks.createAdminClient.mockReturnValue({ from: vi.fn() })
    mocks.checkQuota.mockResolvedValueOnce(deniedQuota({ quotaMonthly: 25, usedQuantity: 25 }))
    mocks.checkAIRateLimit.mockResolvedValueOnce(allowedRateLimit)
    mocks.isModuleEnabledAdmin.mockResolvedValueOnce(true)

    await expect(callAI(params)).rejects.toBeInstanceOf(AIQuotaExceededError)

    expect(fetch).not.toHaveBeenCalled()
  })
})
