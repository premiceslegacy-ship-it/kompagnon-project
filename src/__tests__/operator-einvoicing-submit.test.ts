import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { deriveInstanceSecret, OPERATOR_TIMESTAMP_HEADER, signOperatorRequest } from '@/lib/operator'
import { POST } from '@/app/api/einvoicing/invoices/submit/route'

type SubmissionRow = {
  source_instance: string
  organization_id: string
  invoice_id: string
  request_sha256: string
  status: 'processing' | 'submitted'
  provider_message_id: string | null
  provider_status: string | null
  submitted_at: string | null
  updated_at: string | null
}

type MockError = { code?: string; message: string }
type QueryResult = { data: SubmissionRow | null; error: MockError | null }
type MockQuery = {
  select(columns: string): MockQuery
  insert(values: Record<string, unknown>): MockQuery
  update(values: Record<string, unknown>): MockQuery
  delete(): MockQuery
  match(values: Record<string, unknown>): MockQuery
  eq(column: string, value: unknown): MockQuery
  maybeSingle(): Promise<QueryResult>
}

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getOperatorClientContext: vi.fn(),
  submitInvoice: vi.fn(),
}))

const MASTER = 'c'.repeat(64)
const SOURCE = 'atelier-app'
const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111'
const INVOICE_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_INVOICE_ID = '33333333-3333-4333-8333-333333333333'
const submissions: SubmissionRow[] = []

vi.mock('@/lib/supabase/operator', () => ({
  createOperatorAdminClient: () => ({ from: (table: string) => mocks.from(table) }),
  isOperatorModeEnabled: () => true,
}))
vi.mock('@/lib/operator/trial-lifecycle', () => ({
  getOperatorClientContext: mocks.getOperatorClientContext,
}))
vi.mock('@/lib/super-pdp/client', () => ({
  submitInvoice: mocks.submitInvoice,
}))

function createQuery(table: string): MockQuery {
  if (table !== 'operator_einvoicing_submissions') throw new Error(`Unexpected table ${table}`)
  let action: 'select' | 'insert' | 'update' | 'delete' = 'select'
  let values: Record<string, unknown> = {}
  const filters: Record<string, unknown> = {}
  const matching = () => submissions.find((row) =>
    Object.entries(filters).every(([key, value]) => row[key as keyof SubmissionRow] === value),
  )
  const query: MockQuery = {
    select: () => query,
    insert: (insertValues) => { action = 'insert'; values = insertValues; return query },
    update: (updateValues) => { action = 'update'; values = updateValues; return query },
    delete: () => { action = 'delete'; return query },
    match: (nextFilters) => { Object.assign(filters, nextFilters); return query },
    eq: (column, value) => { filters[column] = value; return query },
    maybeSingle: async () => {
      const existing = action === 'insert'
        ? submissions.find((row) =>
            row.source_instance === values.source_instance
            && row.organization_id === values.organization_id
            && row.invoice_id === values.invoice_id,
          )
        : matching()
      if (action === 'insert') {
        if (existing) return { data: null, error: { code: '23505', message: 'duplicate invoice claim' } }
        const row: SubmissionRow = {
          source_instance: String(values.source_instance),
          organization_id: String(values.organization_id),
          invoice_id: String(values.invoice_id),
          request_sha256: String(values.request_sha256),
          status: 'processing',
          provider_message_id: null,
          provider_status: null,
          submitted_at: null,
          updated_at: null,
        }
        submissions.push(row)
        return { data: { ...row }, error: null }
      }
      if (action === 'update') {
        if (existing) Object.assign(existing, values)
        return { data: existing ? { ...existing } : null, error: null }
      }
      if (action === 'delete') {
        if (existing) submissions.splice(submissions.indexOf(existing), 1)
        return { data: null, error: null }
      }
      return { data: existing ? { ...existing } : null, error: null }
    },
  }
  return query
}

function signedRequest(body: string, timestamp: string): NextRequest {
  const secret = deriveInstanceSecret(MASTER, SOURCE)
  const { signature } = signOperatorRequest(body, secret, timestamp)
  return new NextRequest('http://localhost/api/einvoicing/invoices/submit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-operator-signature': signature,
      [OPERATOR_TIMESTAMP_HEADER]: timestamp,
    },
    body,
  })
}

function invoiceBody(invoiceId: string, xml: string): string {
  return JSON.stringify({
    source_instance: SOURCE,
    organization_id: ORGANIZATION_ID,
    invoice_id: invoiceId,
    xml,
  })
}

const providerResult = {
  ok: true as const,
  data: { id: 374903, events: [{ status_code: 'api:uploaded' }] },
}

afterEach(() => {
  vi.unstubAllEnvs()
})

beforeEach(() => {
  vi.stubEnv('OPERATOR_MODE', 'true')
  vi.stubEnv('OPERATOR_MASTER_SECRET', MASTER)
  submissions.length = 0
  mocks.from.mockImplementation((table: string) => createQuery(table))
  mocks.getOperatorClientContext.mockResolvedValue({
    subscription: { einvoicingConfig: { mode: 'super_pdp', oauth_status: 'connected', emission_enabled: true } },
  })
  mocks.submitInvoice.mockReset()
  mocks.submitInvoice.mockResolvedValue(providerResult)
})

describe('cockpit Super PDP submission idempotency', () => {
  it('returns the persisted provider result for a same-window HMAC replay without resubmitting', async () => {
    const body = invoiceBody(INVOICE_ID, '<Invoice>same</Invoice>')
    const timestamp = Date.now().toString()
    const first = await POST(signedRequest(body, timestamp))
    const replay = await POST(signedRequest(body, timestamp))

    expect(first.status).toBe(200)
    expect(replay.status).toBe(200)
    expect(await replay.json()).toEqual({ message_id: '374903', status: 'api:uploaded' })
    expect(mocks.submitInvoice).toHaveBeenCalledTimes(1)
    expect(submissions).toHaveLength(1)
    expect(submissions[0].status).toBe('submitted')
  })

  it('rejects changed XML for an already claimed invoice and accepts a separate invoice', async () => {
    const first = await POST(signedRequest(invoiceBody(INVOICE_ID, '<Invoice>one</Invoice>'), Date.now().toString()))
    const changed = await POST(signedRequest(invoiceBody(INVOICE_ID, '<Invoice>two</Invoice>'), Date.now().toString()))
    const separate = await POST(signedRequest(invoiceBody(OTHER_INVOICE_ID, '<Invoice>one</Invoice>'), Date.now().toString()))

    expect(first.status).toBe(200)
    expect(changed.status).toBe(409)
    expect(separate.status).toBe(200)
    expect(mocks.submitInvoice).toHaveBeenCalledTimes(2)
    expect(submissions).toHaveLength(2)
  })

  it('keeps a transport-uncertain claim non-retryable until reconciliation', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      mocks.submitInvoice.mockRejectedValueOnce(new Error('connection lost after request'))
      const body = invoiceBody(INVOICE_ID, '<Invoice>uncertain</Invoice>')
      const timestamp = Date.now().toString()
      const failed = await POST(signedRequest(body, timestamp))
      const replay = await POST(signedRequest(body, timestamp))

      expect(failed.status).toBe(502)
      expect(replay.status).toBe(409)
      expect(mocks.submitInvoice).toHaveBeenCalledTimes(1)
      expect(submissions[0].status).toBe('processing')
    } finally {
      log.mockRestore()
    }
  })

  it('releases a definite provider rejection so a legitimate retry can proceed', async () => {
    mocks.submitInvoice
      .mockResolvedValueOnce({ ok: false, status: 400, message: 'invalid XML' })
      .mockResolvedValueOnce(providerResult)
    const body = invoiceBody(INVOICE_ID, '<Invoice>corrected</Invoice>')
    const timestamp = Date.now().toString()
    const rejected = await POST(signedRequest(body, timestamp))
    const retry = await POST(signedRequest(body, timestamp))

    expect(rejected.status).toBe(400)
    expect(retry.status).toBe(200)
    expect(mocks.submitInvoice).toHaveBeenCalledTimes(2)
    expect(submissions).toHaveLength(1)
    expect(submissions[0].status).toBe('submitted')
  })
})
