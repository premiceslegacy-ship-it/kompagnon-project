import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ membership: null as { organizationId: string; roleSlug: string } | null }))
vi.mock('@/lib/data/queries/membership', () => ({ getCurrentMembershipContext: async () => h.membership }))
import { createStripePortalSession } from '@/lib/data/mutations/stripe-portal'

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('billing portal authorization', () => {
  it.each([null, 'viewer', 'admin'])('refuses a portal capability without an authenticated owner (%s)', async role => {
    h.membership = role ? { organizationId: '11111111-1111-4111-8111-111111111111', roleSlug: role } : null
    vi.stubEnv('OPERATOR_SOURCE_INSTANCE', 'atelier-app')
    vi.stubEnv('OPERATOR_INGEST_URL', 'http://localhost:3411/api/operator/ingest')
    vi.stubEnv('OPERATOR_INGEST_SECRET', 'local-test-signing-secret')
    const transport = vi.fn()
    vi.stubGlobal('fetch', transport)
    const result = await createStripePortalSession('https://app.atelier-btp.fr/settings')
    expect(result).toHaveProperty('error')
    expect(transport).not.toHaveBeenCalled()
  })
})
