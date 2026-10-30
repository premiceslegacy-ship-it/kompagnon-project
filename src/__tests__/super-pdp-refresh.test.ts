import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { decryptSecret, encryptSecret } from '@/lib/crypto/secrets'
import { submitInvoice } from '@/lib/super-pdp/client'

const state = vi.hoisted(() => ({
  credentials: null as Record<string, unknown> | null,
  invoicePosts: 0,
  oauthCalls: 0,
  rpcCalls: [] as string[],
  completeError: false,
  ambiguousRefresh: false,
  onOAuthRefresh: null as (() => Promise<void>) | null,
}))

vi.mock('@/lib/supabase/operator', () => ({
  createOperatorAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push(name)
      const row = state.credentials
      if (name === 'claim_super_pdp_oauth_refresh') {
        if (!row) return { data: [{ result_state: 'missing' }], error: null }
        if (row.environment !== args.p_environment) {
          return { data: [{ result_state: 'environment_mismatch' }], error: null }
        }
        if (row.refresh_state === 'reconnect_required') {
          return { data: [{ result_state: 'reconnect_required' }], error: null }
        }
        if (row.refresh_state === 'claimed') return { data: [{ result_state: 'busy' }], error: null }
        if (Date.parse(String(row.token_expires_at)) > Date.now() + 120_000) {
          return { data: [{ result_state: 'fresh', access_token_encrypted: row.access_token_encrypted }], error: null }
        }
        row.refresh_state = 'claimed'
        row.refresh_claim_owner = args.p_claim_owner
        row.refresh_claimed_at = new Date().toISOString()
        return {
          data: [{
            result_state: 'claimed',
            refresh_token_encrypted: row.refresh_token_encrypted,
            claim_owner: args.p_claim_owner,
            credential_revision: row.credential_revision,
          }],
          error: null,
        }
      }

      if (name === 'complete_super_pdp_oauth_refresh') {
        if (state.completeError) return { data: null, error: { message: 'credential store unavailable' } }
        if (!row || row.refresh_state !== 'claimed'
          || row.refresh_claim_owner !== args.p_claim_owner
          || row.credential_revision !== args.p_expected_revision) {
          return { data: false, error: null }
        }
        row.access_token_encrypted = args.p_access_token_encrypted
        row.refresh_token_encrypted = args.p_refresh_token_encrypted
        row.token_expires_at = args.p_token_expires_at
        row.refresh_state = 'ready'
        row.refresh_claim_owner = null
        row.refresh_claimed_at = null
        row.credential_revision = crypto.randomUUID()
        return { data: true, error: null }
      }

      if (name === 'fail_super_pdp_oauth_refresh') {
        if (row && row.refresh_state === 'claimed'
          && row.refresh_claim_owner === args.p_claim_owner
          && row.credential_revision === args.p_expected_revision) {
          row.refresh_state = 'reconnect_required'
          row.refresh_claim_owner = null
          row.refresh_claimed_at = null
        }
        return { data: true, error: null }
      }


      return { data: null, error: { message: `Unexpected RPC ${name}` } }
    },
  }),
}))

const encryptionKey = Buffer.alloc(32, 7).toString('base64')
const organizationId = '00000000-0000-4000-8000-000000000001'

beforeEach(async () => {
  state.invoicePosts = 0
  state.oauthCalls = 0
  state.rpcCalls = []
  state.completeError = false
  state.ambiguousRefresh = false
  state.onOAuthRefresh = null
  vi.stubEnv('SUPER_PDP_API_ENDPOINT', 'https://pdp.example.test')
  vi.stubEnv('SUPER_PDP_ENV', 'sandbox')
  vi.stubEnv('SUPER_PDP_CLIENT_ID', 'fixture-client')
  vi.stubEnv('SUPER_PDP_CLIENT_SECRET', 'fixture-secret')
  vi.stubEnv('SUPER_PDP_ENCRYPTION_KEY', encryptionKey)
  state.credentials = {
    access_token_encrypted: await encryptSecret('expired-access', encryptionKey),
    refresh_token_encrypted: await encryptSecret('single-use-refresh', encryptionKey),
    token_expires_at: '2000-01-01T00:00:00.000Z',
    environment: 'sandbox',
    refresh_state: 'ready',
    refresh_claim_owner: null,
    refresh_claimed_at: null,
    credential_revision: crypto.randomUUID(),
  }
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith('/oauth2/token')) {
      state.oauthCalls += 1
      await state.onOAuthRefresh?.()
      if (state.ambiguousRefresh) throw new Error('provider response lost')
      return Response.json({
        access_token: 'rotated-access',
        refresh_token: 'rotated-refresh',
        expires_in: 1800,
        token_type: 'Bearer',
        scope: 'all',
      })
    }
    if (url.endsWith('/v1.beta/invoices')) {
      state.rpcCalls.push('invoice_post')
      state.invoicePosts += 1
      return Response.json({ id: 123, company_id: 456 })
    }
    throw new Error('Unexpected provider path')
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

it('does not transmit an invoice when rotated credentials cannot be retained', async () => {
  state.completeError = true
  const result = await submitInvoice('fixture-instance', organizationId, '<fixture />')

  expect(state.oauthCalls).toBe(1)
  expect(state.invoicePosts).toBe(0)
  expect(result.ok).toBe(false)
  expect(state.credentials?.refresh_state).toBe('reconnect_required')
  expect(await decryptSecret(String(state.credentials?.refresh_token_encrypted), encryptionKey)).toBe('single-use-refresh')
})

it('returns a bounded busy result without calling the provider or posting an invoice', async () => {
  state.credentials!.refresh_state = 'claimed'
  state.credentials!.refresh_claim_owner = crypto.randomUUID()
  state.credentials!.refresh_claimed_at = new Date().toISOString()
  const result = await submitInvoice('fixture-instance', organizationId, '<fixture />')

  expect(result).toMatchObject({ ok: false, status: 503 })
  expect(state.oauthCalls).toBe(0)
  expect(state.invoicePosts).toBe(0)
})

it('refuses a sandbox grant before decrypting or refreshing when the cockpit is configured for production', async () => {
  vi.stubEnv('SUPER_PDP_ENV', 'production')
  const result = await submitInvoice('fixture-instance', organizationId, '<fixture />')

  expect(result).toMatchObject({ ok: false, status: 409 })
  expect(state.rpcCalls).toEqual(['claim_super_pdp_oauth_refresh'])
  expect(state.oauthCalls).toBe(0)
  expect(state.invoicePosts).toBe(0)
})

it('marks an ambiguous provider result for reconnection and never replays the old refresh token', async () => {
  state.ambiguousRefresh = true
  const first = await submitInvoice('fixture-instance', organizationId, '<fixture />')
  const second = await submitInvoice('fixture-instance', organizationId, '<fixture />')

  expect(first.ok).toBe(false)
  expect(second).toMatchObject({ ok: false, status: 409 })
  expect(state.oauthCalls).toBe(1)
  expect(state.invoicePosts).toBe(0)
  expect(state.credentials?.refresh_state).toBe('reconnect_required')
})

it('does not return an old refresh result after a reconnect replaces its claim', async () => {
  state.onOAuthRefresh = async () => {
    state.credentials = {
      access_token_encrypted: await encryptSecret('reconnected-access', encryptionKey),
      refresh_token_encrypted: await encryptSecret('reconnected-refresh', encryptionKey),
      token_expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      refresh_state: 'ready',
      refresh_claim_owner: null,
      refresh_claimed_at: null,
      credential_revision: crypto.randomUUID(),
      environment: 'sandbox',
    }
  }

  const result = await submitInvoice('fixture-instance', organizationId, '<fixture />')

  expect(result).toMatchObject({ ok: false, status: 409 })
  expect(state.invoicePosts).toBe(0)
  expect(await decryptSecret(String(state.credentials?.access_token_encrypted), encryptionKey)).toBe('reconnected-access')
  expect(await decryptSecret(String(state.credentials?.refresh_token_encrypted), encryptionKey)).toBe('reconnected-refresh')
})

it('persists both rotated tokens before using the new access token', async () => {
  const result = await submitInvoice('fixture-instance', organizationId, '<fixture />')

  expect(result).toMatchObject({ ok: true, data: { id: 123, company_id: 456 } })
  expect(state.invoicePosts).toBe(1)
  expect(await decryptSecret(String(state.credentials?.access_token_encrypted), encryptionKey)).toBe('rotated-access')
  expect(await decryptSecret(String(state.credentials?.refresh_token_encrypted), encryptionKey)).toBe('rotated-refresh')
  expect(state.rpcCalls.indexOf('complete_super_pdp_oauth_refresh'))
    .toBeLessThan(state.rpcCalls.indexOf('invoice_post'))
  expect(vi.mocked(fetch).mock.calls.at(-1)?.[1]).toMatchObject({
    headers: { Authorization: 'Bearer rotated-access' },
  })
})
