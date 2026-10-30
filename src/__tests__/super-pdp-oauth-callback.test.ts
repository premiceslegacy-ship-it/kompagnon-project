import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/einvoicing/oauth/callback/route'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('@/lib/supabase/operator', () => ({
  isOperatorModeEnabled: () => true,
  createOperatorAdminClient: () => ({ rpc: mocks.rpc }),
}))

vi.mock('@/lib/super-pdp/oauth-state', () => ({
  verifyOauthState: () => ({ source_instance: 'fixture-instance', organization_id: '00000000-0000-4000-8000-000000000001' }),
}))

vi.mock('@/lib/operator/trial-lifecycle', () => ({
  getOperatorClientContext: async () => ({
    appUrl: 'https://app.example.test',
    subscription: {
      tier: 'free',
      overflowMode: 'deny',
      aiBillingMode: 'orsayn_shared',
      einvoicingConfig: {},
    },
  }),
  syncClientQuotaConfig: vi.fn(),
}))

beforeEach(() => {
  mocks.rpc.mockReset()
  vi.stubEnv('SUPER_PDP_API_ENDPOINT', 'https://pdp.example.test')
  vi.stubEnv('SUPER_PDP_CLIENT_ID', 'fixture-client')
  vi.stubEnv('SUPER_PDP_CLIENT_SECRET', 'fixture-secret')
  vi.stubEnv('SUPER_PDP_REDIRECT_URL', 'https://cockpit.example.test/callback')
  vi.stubEnv('SUPER_PDP_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'))
  vi.stubEnv('SUPER_PDP_ENV', 'production')
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    if (String(input).endsWith('/oauth2/token')) {
      return Response.json({
        access_token: 'fixture-access',
        refresh_token: 'fixture-refresh',
        expires_in: 1800,
        token_type: 'Bearer',
      })
    }
    if (String(input).endsWith('/v1.beta/companies/me')) {
      return Response.json({ id: 123, formal_name: 'Fixture Co', env: 'sandbox' })
    }
    throw new Error('Unexpected provider path')
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

it('does not store or mark a sandbox company grant connected in production', async () => {
  const request = new NextRequest('https://cockpit.example.test/api/einvoicing/oauth/callback?code=fixture-code&state=fixture-state')
  const response = await GET(request)
  const redirect = new URL(response.headers.get('location')!)

  expect(redirect.searchParams.get('oauth')).toBe('error')
  expect(redirect.searchParams.get('oauth_detail')).toBe('environment_mismatch')
  expect(mocks.rpc).not.toHaveBeenCalled()
})

it('requires an explicit sandbox or production environment', async () => {
  vi.stubEnv('SUPER_PDP_ENV', '')
  const request = new NextRequest('https://cockpit.example.test/api/einvoicing/oauth/callback?code=fixture-code&state=fixture-state')
  const response = await GET(request)

  expect(response.status).toBe(500)
  expect(mocks.rpc).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
})
