import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { deriveInstanceSecret, OPERATOR_TIMESTAMP_HEADER, signOperatorRequest } from '@/lib/operator'
import { POST } from '@/app/api/stripe/checkout-session/route'

type QueryResult = { data: unknown; error: null }
type Query = {
  select(columns: string): Query
  eq(column: string, value: unknown): Query
  maybeSingle(): Promise<QueryResult>
  update(values: Record<string, unknown>): Query
  then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown): Promise<unknown>
}

const mocks = vi.hoisted(() => ({ from: vi.fn(), fetch: vi.fn() }))
const MASTER = 'd'.repeat(64)
const SOURCE = 'atelier-app'
const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111'
const RETURN_URL = 'https://atelier-test.example/activation?checkout=success'

vi.mock('@/lib/supabase/operator', () => ({
  createOperatorAdminClient: () => ({ from: (table: string) => mocks.from(table) }),
  isOperatorModeEnabled: () => true,
}))

function makeQuery(table: string): Query {
  const query: Query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({
      data: table === 'operator_client_settings'
        ? { app_url: 'https://atelier-test.example', contact_email: 'owner@example.test' }
        : null,
      error: null,
    }),
    update: () => query,
    then: (resolve, reject) => Promise.resolve({ data: null, error: null }).then(resolve, reject),
  }
  return query
}

function signedRequest(timestamp: string): NextRequest {
  const body = JSON.stringify({
    source_instance: SOURCE,
    organization_id: ORGANIZATION_ID,
    tier: 'pro',
    return_url: RETURN_URL,
  })
  const { signature } = signOperatorRequest(body, deriveInstanceSecret(MASTER, SOURCE), timestamp)
  return new NextRequest('http://localhost/api/stripe/checkout-session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-operator-signature': signature,
      [OPERATOR_TIMESTAMP_HEADER]: timestamp,
    },
    body,
  })
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  vi.stubEnv('OPERATOR_MODE', 'true')
  vi.stubEnv('OPERATOR_MASTER_SECRET', MASTER)
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_local_only')
  vi.stubEnv('STRIPE_PRICE_PRO', 'price_pro_test')
  vi.stubEnv('OPERATOR_SELF_SERVICE_SOURCE_INSTANCE', SOURCE)
  mocks.from.mockImplementation((table: string) => makeQuery(table))
  mocks.fetch.mockReset()
  const sessions = new Map<string, { id: string; url: string }>()
  mocks.fetch.mockImplementation(async (_url: string, init: RequestInit) => {
    const headers = new Headers(init.headers)
    const key = headers.get('Idempotency-Key')
    const body = String(init.body)
    if (!key) throw new Error('Stripe request missing idempotency key')
    if (!sessions.has(key)) {
      sessions.set(key, { id: 'cs_local_replay', url: 'https://checkout.example/session' })
    }
    return {
      ok: true,
      json: async () => sessions.get(key),
      requestBody: body,
    }
  })
  vi.stubGlobal('fetch', mocks.fetch)
})

describe('cockpit checkout replay protection', () => {
  it('uses a stable business idempotency key and sends the provider parameters despite refreshed HMAC timestamps', async () => {
    const now = Date.now()
    const first = await POST(signedRequest(String(now)))
    const replay = await POST(signedRequest(String(now + 1000)))

    expect(first.status).toBe(200)
    expect(replay.status).toBe(200)
    expect(await first.json()).toEqual({ url: 'https://checkout.example/session' })
    expect(await replay.json()).toEqual({ url: 'https://checkout.example/session' })
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    const firstInit = mocks.fetch.mock.calls[0][1] as RequestInit
    const replayInit = mocks.fetch.mock.calls[1][1] as RequestInit
    expect(new Headers(firstInit.headers).get('Idempotency-Key'))
      .toBe(new Headers(replayInit.headers).get('Idempotency-Key'))
    expect(String(firstInit.body)).toContain('line_items%5B0%5D%5Bprice%5D=price_pro_test')
    expect(replayInit.body).toBe(firstInit.body)
  })
})
