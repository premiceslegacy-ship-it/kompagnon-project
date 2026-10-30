import { beforeEach, describe, expect, it, vi } from 'vitest'
import { acceptQuoteByToken } from '@/lib/data/mutations/sign'


const adapters = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  sendEmail: vi.fn(),
  sendPushToOrg: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: adapters.createAdminClient }))
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'user-agent': 'signature-test' }) }))
vi.mock('@/lib/email', () => ({ sendEmail: adapters.sendEmail }))
vi.mock('@/lib/email/templates', () => ({
  buildQuoteAcceptedClientEmail: () => ({ subject: 'accepted', html: '<p>accepted</p>' }),
  buildQuoteAcceptedProfessionalEmail: () => ({ subject: 'accepted', html: '<p>accepted</p>' }),
}))
vi.mock('@/lib/client', () => ({ getClientGreetingName: () => null }))
vi.mock('@/lib/push', () => ({ sendPushToOrg: adapters.sendPushToOrg }))


type Row = Record<string, any>
type TableName = 'quotes' | 'contracts' | 'organizations' | 'clients' | 'chantiers'
type Filter = (row: Row) => boolean

type UpdateObservation = { table: TableName; patch: Row; matchedCount: number }

const database: {
  rows: Record<TableName, Row[]>
  updates: UpdateObservation[]
  beforeNextUpdate: ((table: TableName) => void) | null
} = {
  rows: { quotes: [], contracts: [], organizations: [], clients: [], chantiers: [] },
  updates: [],
  beforeNextUpdate: null,
}

class QueryBuilder {
  private operation: 'select' | 'update' = 'select'
  private patch: Row = {}
  private filters: Filter[] = []
  private returnsRows = false

  constructor(private readonly table: TableName) {}

  select(_columns: string) {
    if (this.operation === 'update') this.returnsRows = true
    return this
  }

  update(patch: Row) {
    this.operation = 'update'
    this.patch = patch
    return this
  }

  eq(column: string, value: unknown) {
    this.filters.push(row => row[column] === value)
    return this
  }

  neq(column: string, value: unknown) {
    this.filters.push(row => row[column] !== value)
    return this
  }

  in(column: string, values: readonly unknown[]) {
    this.filters.push(row => values.includes(row[column]))
    return this
  }

  is(column: string, value: unknown) {
    this.filters.push(row => row[column] === value)
    return this
  }

  or(expression: string) {
    const greaterThan = /^signature_token_expires_at\.gt\.(.+)$/.exec(expression)?.[1]
    if (!greaterThan) throw new Error(`Unexpected atomic token-expiry predicate: ${expression}`)
    this.filters.push(row => row.signature_token_expires_at !== null
      && row.signature_token_expires_at !== undefined
      && Date.parse(row.signature_token_expires_at) > Date.parse(greaterThan))
    return this
  }

  single() {
    const rows = this.executeRows()
    return Promise.resolve(rows.length === 1
      ? { data: rows[0], error: null }
      : { data: null, error: { message: 'expected exactly one row' } })
  }

  maybeSingle() {
    const rows = this.executeRows()
    return Promise.resolve(rows.length <= 1
      ? { data: rows[0] ?? null, error: null }
      : { data: null, error: { message: 'expected at most one row' } })
  }

  then<TResult1 = { data: Row[] | null; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[] | null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve({ data: this.executeRows(), error: null }).then(onfulfilled, onrejected)
  }

  private executeRows(): Row[] {
    const rows = database.rows[this.table]
    if (this.operation === 'select') return rows.filter(row => this.filters.every(filter => filter(row)))

    const beforeUpdate = database.beforeNextUpdate
    database.beforeNextUpdate = null
    beforeUpdate?.(this.table)

    const matches = rows.filter(row => this.filters.every(filter => filter(row)))
    database.updates.push({ table: this.table, patch: { ...this.patch }, matchedCount: matches.length })
    for (const row of matches) Object.assign(row, this.patch)
    return this.returnsRows ? matches.map(row => ({ id: row.id })) : []
  }
}

function configureAdminProvider() {
  adapters.createAdminClient.mockImplementation(() => ({
    from: (table: TableName) => new QueryBuilder(table),
  }))
}

const organization = {
  id: 'org-1', name: 'Atelier', email: null, email_from_address: null,
  email_from_name: null, logo_url: null,
}
const validSignature = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAASwAAAB4CAYAAABIFc8g'
const futureExpiry = () => new Date(Date.now() + 60_000).toISOString()
const pastExpiry = () => new Date(Date.now() - 60_000).toISOString()

function quoteRow(expiresAt: string | null): Row {
  return {
    id: 'quote-1', number: 'DEV-1', title: 'Quote', status: 'sent', total_ttc: 120,
    currency: 'EUR', organization_id: organization.id, client_id: null,
    signature_token: 'quote-token', signature_token_expires_at: expiresAt, signed_at: null,
    is_archived: false,
    issuer_name: organization.name,
  }
}


beforeEach(() => {
  database.rows = {
    quotes: [], contracts: [], organizations: [{ ...organization }], clients: [], chantiers: [],
  }
  database.updates = []
  database.beforeNextUpdate = null
  adapters.createAdminClient.mockReset()
  adapters.sendEmail.mockReset().mockResolvedValue({ error: null })
  adapters.sendPushToOrg.mockReset().mockResolvedValue(undefined)
  configureAdminProvider()
})

describe('public signature token expiry at mutation authority', () => {
  it('keeps an already signed fully invoiced quote receipt available', async () => {
    const quote = quoteRow(futureExpiry())
    quote.status = 'fully_invoiced'
    quote.signed_at = '2026-01-01T12:00:00.000Z'
    database.rows.quotes.push(quote)
    database.rows.organizations[0].name = 'Renamed current company'

    const result = await acceptQuoteByToken({
      token: quote.signature_token, signatoryName: 'Another name', signatureImage: validSignature,
    })

    expect(result.error).toBeNull()
    expect(result.signedAt).toBe('2026-01-01T12:00:00.000Z')
    expect(result.orgName).toBe('Atelier')
    expect(quote.status).toBe('fully_invoiced')
    expect(database.updates).toHaveLength(0)
  })

  it('does not disclose an already signed quote through an expired capability', async () => {
    const quote = quoteRow(pastExpiry())
    quote.status = 'accepted'
    quote.signed_at = new Date(Date.now() - 120_000).toISOString()
    database.rows.quotes.push(quote)

    const result = await acceptQuoteByToken({
      token: quote.signature_token, signatoryName: 'Client', signatureImage: validSignature,
    })

    expect(result.error).not.toBeNull()
    expect(result.quoteNumber).toBeNull()
    expect(result.orgName).toBeNull()
    expect(adapters.sendEmail).not.toHaveBeenCalled()
  })

  it('does not accept a cancelled quote through its still-fresh capability', async () => {
    const quote = quoteRow(futureExpiry())
    quote.status = 'cancelled'
    database.rows.quotes.push(quote)

    const result = await acceptQuoteByToken({
      token: quote.signature_token, signatoryName: 'Client', signatureImage: validSignature,
    })

    expect(result.error).not.toBeNull()
    expect(quote.status).toBe('cancelled')
    expect(quote.signed_at).toBeNull()
    expect(adapters.sendEmail).not.toHaveBeenCalled()
  })

  it('does not sign when the quote is archived between lookup and persistence', async () => {
    const quote = quoteRow(futureExpiry())
    database.rows.quotes.push(quote)
    database.beforeNextUpdate = () => { quote.is_archived = true }

    const result = await acceptQuoteByToken({
      token: quote.signature_token, signatoryName: 'Client', signatureImage: validSignature,
    })

    expect(result.error).not.toBeNull()
    expect(quote.status).toBe('sent')
    expect(quote.signed_at).toBeNull()
    expect(adapters.sendEmail).not.toHaveBeenCalled()
  })


  it.each(['sent', 'viewed'])('rejects an expired %s offer without writing, then signs once while fresh', async status => {
    const quote = quoteRow(pastExpiry())
    quote.status = status
    database.rows.quotes.push(quote)

    const expired = await acceptQuoteByToken({ token: quote.signature_token, signatoryName: 'Client', signatureImage: validSignature })

    expect(expired.error).not.toBeNull()
    expect(database.updates).toHaveLength(0)
    expect(quote.signed_at).toBeNull()

    quote.signature_token_expires_at = futureExpiry()
    const fresh = await acceptQuoteByToken({ token: quote.signature_token, signatoryName: 'Client', signatureImage: validSignature })
    const replay = await acceptQuoteByToken({ token: quote.signature_token, signatoryName: 'Client', signatureImage: validSignature })

    expect(fresh.error).toBeNull()
    expect(replay.error).toBeNull()
    expect(quote.status).toBe('accepted')
    expect(database.updates.filter(update => update.table === 'quotes' && 'signed_at' in update.patch)).toHaveLength(1)
    expect(adapters.sendPushToOrg).toHaveBeenCalledTimes(1)
  })

  it('rejects a legacy quote token with no known expiry', async () => {
    const quote = quoteRow(null)
    database.rows.quotes = [quote]

    const result = await acceptQuoteByToken({
      token: quote.signature_token, signatoryName: 'Client', signatureImage: validSignature,
    })

    expect(result.error).not.toBeNull()
    expect(quote.signed_at).toBeNull()
    expect(database.updates).toHaveLength(0)
  })

  it('keeps quote expiry and blocked-status checks atomic with the write', async () => {
    const mutateBeforeWrite = [
      (quote: Row) => { quote.signature_token_expires_at = pastExpiry() },
      ...(['refused', 'expired', 'archived'] as const).map(status => (quote: Row) => { quote.status = status }),
    ]
    for (const mutate of mutateBeforeWrite) {
      const quote = quoteRow(futureExpiry())
      database.rows.quotes = [quote]
      database.updates = []
      database.beforeNextUpdate = table => {
        if (table === 'quotes') mutate(quote)
      }

      const result = await acceptQuoteByToken({ token: quote.signature_token, signatoryName: 'Client', signatureImage: validSignature })

      expect(result.error).not.toBeNull()
      expect(database.updates).toHaveLength(1)
      expect(database.updates[0].matchedCount).toBe(0)
      expect(quote.signed_at).toBeNull()
      expect(adapters.sendPushToOrg).not.toHaveBeenCalled()
    }
  })

})
