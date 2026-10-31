import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as QuotaModule from '@/lib/quota'

const mocks = vi.hoisted(() => ({
  checkQuota: vi.fn(),
  checkAIRateLimit: vi.fn(),
  isModuleEnabledAdmin: vi.fn(),
  createAdminClient: vi.fn(),
  getOrganizationOpenRouterKey: vi.fn(),
  billingMode: 'orsayn_shared' as string,
  billingModeQueryError: false,
}))

vi.mock('@/lib/quota', async (importOriginal) => {
  const actual = await importOriginal<typeof QuotaModule>()
  return { ...actual, checkQuota: mocks.checkQuota }
})
vi.mock('@/lib/rate-limit', () => ({ checkAIRateLimit: mocks.checkAIRateLimit }))
vi.mock('@/lib/data/queries/organization-modules', () => ({ isModuleEnabledAdmin: mocks.isModuleEnabledAdmin }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/ai/openrouter-credentials', () => ({ getOrganizationOpenRouterKey: mocks.getOrganizationOpenRouterKey }))

import { callAI } from '@/lib/ai/callAI'
import { generateEmbedding } from '@/lib/ai/embeddings'

const tenantKeys = new Map<string, string>()
const allowedRateLimit = { allowed: true, limit: 100, windowSeconds: 60 }

function makeAdminClient() {
  return {
    from: vi.fn((table: string) => {
      if (table === 'organization_modules') {
        const maybeSingle = vi.fn(async () => ({
          data: mocks.billingModeQueryError ? null : { ai_billing_mode: mocks.billingMode },
          error: mocks.billingModeQueryError ? { message: 'billing mode unavailable' } : null,
        }))
        const eq = vi.fn(() => ({ maybeSingle }))
        return { select: vi.fn(() => ({ eq })) }
      }

      const eq = vi.fn(async () => ({ error: null }))
      return { update: vi.fn(() => ({ eq })) }
    }),
  }
}

function allowedQuota(mode: string = mocks.billingMode) {
  return {
    allowed: true,
    aiBillingMode: mode,
    quotaFeature: 'quote_analysis',
    quotaUnit: 'call',
    quotaMonthly: -1,
    usedQuantity: 0,
    requestedQuantity: 1,
    remaining: null,
    overflowMode: 'charge',
    overQuota: false,
    reservationId: 'usage-reservation',
  }
}

const callParams = (organizationId: string) => ({
  organizationId,
  provider: 'openrouter' as const,
  feature: 'quote_analysis' as const,
  model: 'test-model',
  inputKind: 'text' as const,
  request: { body: { messages: [{ role: 'user', content: 'safe test input' }] } },
})

function stubProviderFetch(...payloads: unknown[]) {
  const providerFetch = vi.fn()
  for (const payload of payloads) {
    providerFetch.mockResolvedValueOnce(new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
  }
  vi.stubGlobal('fetch', providerFetch)
  return providerFetch
}

type FetchMock = { mock: { calls: unknown[][] } }

function authorizationAt(providerFetch: FetchMock, index = 0) {
  const request = providerFetch.mock.calls[index]?.[1] as RequestInit | undefined
  return new Headers(request?.headers).get('Authorization')
}

beforeEach(() => {
  vi.clearAllMocks()
  tenantKeys.clear()
  mocks.billingMode = 'orsayn_shared'
  mocks.billingModeQueryError = false
  mocks.checkQuota.mockImplementation(async () => allowedQuota())
  mocks.checkAIRateLimit.mockResolvedValue(allowedRateLimit)
  mocks.isModuleEnabledAdmin.mockResolvedValue(true)
  mocks.createAdminClient.mockImplementation(makeAdminClient)
  mocks.getOrganizationOpenRouterKey.mockImplementation(async (organizationId: string) => tenantKeys.get(organizationId) ?? null)
  vi.stubEnv('OPENROUTER_API_KEY', 'shared-test-key')
  vi.stubEnv('OPERATOR_INGEST_URL', '')
  vi.stubEnv('OPERATOR_INGEST_SECRET', '')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('AI OpenRouter key routing', () => {
  it('refuses a client-owned call without its organization key even when the shared key exists', async () => {
    mocks.billingMode = 'client_owned'
    mocks.checkQuota.mockImplementation(async () => allowedQuota('client_owned'))
    const providerFetch = stubProviderFetch()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(callAI(callParams('org-missing'))).rejects.toMatchObject({
      name: 'AIProviderCreditError',
      aiBillingMode: 'client_owned',
      message: 'Clé OpenRouter client absente ou invalide.',
    })

    expect(mocks.getOrganizationOpenRouterKey).toHaveBeenCalledWith('org-missing')
    expect(providerFetch).not.toHaveBeenCalled()
  })

  it('uses each client-owned organization key instead of another tenant or the shared key', async () => {
    mocks.billingMode = 'client_owned'
    mocks.checkQuota.mockImplementation(async () => allowedQuota('client_owned'))
    tenantKeys.set('org-a', 'tenant-a-test-key')
    tenantKeys.set('org-b', 'tenant-b-test-key')
    const providerFetch = stubProviderFetch(
      { id: 'request-a', choices: [{ message: { content: 'a' } }], usage: {} },
      { id: 'request-b', choices: [{ message: { content: 'b' } }], usage: {} },
    )

    await callAI(callParams('org-a'))
    await callAI(callParams('org-b'))

    expect(authorizationAt(providerFetch, 0)).toBe('Bearer tenant-a-test-key')
    expect(authorizationAt(providerFetch, 1)).toBe('Bearer tenant-b-test-key')
    expect(providerFetch).toHaveBeenCalledTimes(2)
    expect(mocks.getOrganizationOpenRouterKey.mock.calls).toEqual([['org-a'], ['org-b']])
  })

  it('keeps the global provider key for explicitly shared calls without consulting tenant credentials', async () => {
    mocks.billingMode = 'orsayn_shared'
    const providerFetch = stubProviderFetch({ id: 'shared-request', choices: [{ message: { content: 'ok' } }], usage: {} })

    await callAI(callParams('org-shared'))

    expect(authorizationAt(providerFetch)).toBe('Bearer shared-test-key')
    expect(mocks.getOrganizationOpenRouterKey).not.toHaveBeenCalled()
    expect(mocks.isModuleEnabledAdmin).toHaveBeenCalledWith('org-shared', 'quote_ai')
  })

  it('refuses embedding generation when the client-owned key is missing despite a shared key', async () => {
    mocks.billingMode = 'client_owned'
    const providerFetch = stubProviderFetch()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(generateEmbedding('embedding test', 'org-missing')).resolves.toBeNull()

    expect(mocks.getOrganizationOpenRouterKey).toHaveBeenCalledWith('org-missing')
    expect(providerFetch).not.toHaveBeenCalled()
  })

  it('uses the selected organization key for embeddings', async () => {
    mocks.billingMode = 'client_owned'
    tenantKeys.set('org-b', 'tenant-b-test-key')
    const providerFetch = stubProviderFetch({ data: [{ embedding: [0.1, 0.2] }] })

    await expect(generateEmbedding('embedding test', 'org-b')).resolves.toEqual([0.1, 0.2])

    expect(authorizationAt(providerFetch)).toBe('Bearer tenant-b-test-key')
    expect(mocks.getOrganizationOpenRouterKey).toHaveBeenCalledWith('org-b')
  })

  it('uses the global key for explicitly shared embeddings', async () => {
    mocks.billingMode = 'orsayn_shared'
    const providerFetch = stubProviderFetch({ data: [{ embedding: [0.3] }] })

    await expect(generateEmbedding('embedding test', 'org-shared')).resolves.toEqual([0.3])

    expect(authorizationAt(providerFetch)).toBe('Bearer shared-test-key')
    expect(mocks.getOrganizationOpenRouterKey).not.toHaveBeenCalled()
  })

  it('does not use the global key when embedding billing-mode lookup fails', async () => {
    mocks.billingModeQueryError = true
    const providerFetch = stubProviderFetch()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(generateEmbedding('embedding test', 'org-unavailable')).resolves.toBeNull()

    expect(mocks.getOrganizationOpenRouterKey).not.toHaveBeenCalled()
    expect(providerFetch).not.toHaveBeenCalled()
  })

  it('does not make an embedding request without organization context', async () => {
    const providerFetch = stubProviderFetch()

    await expect(generateEmbedding('embedding test', '')).resolves.toBeNull()

    expect(providerFetch).not.toHaveBeenCalled()
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })
})
