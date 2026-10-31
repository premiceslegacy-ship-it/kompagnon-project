import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encryptSecret } from '@/lib/crypto/secrets'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  row: null as { openrouter_key_encrypted: string } | null,
  queryError: null as { message: string } | null,
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { getOrganizationOpenRouterKey } from '@/lib/ai/openrouter-credentials'

const TEST_ENCRYPTION_KEY = Buffer.from('01234567890123456789012345678901').toString('base64')

function makeAdminClient() {
  const maybeSingle = vi.fn(async () => ({ data: mocks.row, error: mocks.queryError }))
  const eq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq }))
  return { from: vi.fn(() => ({ select })) }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.row = null
  mocks.queryError = null
  mocks.createAdminClient.mockImplementation(makeAdminClient)
  vi.stubEnv('ORGANIZATION_AI_CREDENTIALS_ENCRYPTION_KEY', TEST_ENCRYPTION_KEY)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('getOrganizationOpenRouterKey', () => {
  it('returns the decrypted key for the selected organization', async () => {
    mocks.row = { openrouter_key_encrypted: await encryptSecret('tenant-test-key', TEST_ENCRYPTION_KEY) }

    await expect(getOrganizationOpenRouterKey('org-a')).resolves.toBe('tenant-test-key')
  })

  it('returns null for a missing organization key', async () => {
    await expect(getOrganizationOpenRouterKey('org-missing')).resolves.toBeNull()
  })

  it('returns null when a stored organization key cannot be decrypted', async () => {
    mocks.row = { openrouter_key_encrypted: '!' }
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(getOrganizationOpenRouterKey('org-invalid')).resolves.toBeNull()
  })

  it('returns null when the credential read fails', async () => {
    mocks.queryError = { message: 'credential read failed' }
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(getOrganizationOpenRouterKey('org-unavailable')).resolves.toBeNull()
  })
})
