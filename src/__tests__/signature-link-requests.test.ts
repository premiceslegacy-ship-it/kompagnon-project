import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requestNewQuoteSignatureLink } from '@/lib/data/mutations/signature-link-requests'

const adapters = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  sendEmail: vi.fn(),
  sendPushToOrgPermission: vi.fn(),
  checkRateLimit: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: adapters.createAdminClient }))
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-real-ip': '203.0.113.7' }) }))
vi.mock('@/lib/email', () => ({ sendEmail: adapters.sendEmail }))
vi.mock('@/lib/client', () => ({ getClientGreetingName: () => 'Camille Qualification' }))
vi.mock('@/lib/push', () => ({ sendPushToOrgPermission: adapters.sendPushToOrgPermission }))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: adapters.checkRateLimit,
  getClientIp: (headers: Headers) => headers.get('x-real-ip') ?? 'unknown',
}))

type Row = Record<string, any>
type TableName = 'quotes' | 'organizations' | 'clients' | 'signature_link_requests'

const db: { rows: Record<TableName, Row[]> } = {
  rows: { quotes: [], organizations: [], clients: [], signature_link_requests: [] },
}

class QueryBuilder {
  private filters: Array<(row: Row) => boolean> = []
  private inserted: Row | null = null

  constructor(private readonly table: TableName) {}

  select() { return this }
  eq(column: string, value: unknown) { this.filters.push(row => row[column] === value); return this }

  insert(row: Row) {
    this.inserted = row
    return this.runInsert()
  }

  private async runInsert() {
    const row = this.inserted!
    if (this.table === 'signature_link_requests'
      && db.rows.signature_link_requests.some(r => r.quote_id === row.quote_id && r.resolved_at == null)) {
      return { data: null, error: { code: '23505', message: 'duplicate key' } }
    }
    db.rows[this.table].push({ ...row, resolved_at: null })
    return { data: null, error: null }
  }

  private matches() { return db.rows[this.table].filter(row => this.filters.every(filter => filter(row))) }
  async maybeSingle() { return { data: this.matches()[0] ?? null, error: null } }
  async single() {
    const row = this.matches()[0]
    return row ? { data: row, error: null } : { data: null, error: { message: 'not found' } }
  }
}

const NOW = Date.parse('2026-11-05T10:00:00Z')
const expired = new Date(NOW - 60_000).toISOString()
const fresh = new Date(NOW + 86_400_000).toISOString()

function seedQuote(overrides: Row = {}) {
  db.rows.quotes.push({
    id: 'quote-1',
    number: 'D-114',
    title: 'Salle de bain',
    status: 'sent',
    is_archived: false,
    organization_id: 'org-1',
    client_id: 'client-1',
    signed_at: null,
    signature_token: 'token-expire',
    signature_token_expires_at: expired,
    ...overrides,
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  db.rows = {
    quotes: [],
    organizations: [{ id: 'org-1', name: 'Atelier Qualification', email: 'pro@atelier.test', email_from_address: null, logo_url: null }],
    clients: [{ id: 'client-1', company_name: null, contact_name: 'Camille Qualification', first_name: null, last_name: null, email: 'client@atelier.test' }],
    signature_link_requests: [],
  }
  adapters.createAdminClient.mockReturnValue({ from: (table: TableName) => new QueryBuilder(table) })
  adapters.sendEmail.mockReset().mockResolvedValue({ error: null })
  adapters.sendPushToOrgPermission.mockReset().mockResolvedValue(undefined)
  adapters.checkRateLimit.mockReset().mockResolvedValue({ allowed: true })
})

describe('requestNewQuoteSignatureLink', () => {
  it('enregistre la demande sur un lien expiré et prévient l’artisan sans émettre de lien', async () => {
    seedQuote()
    const result = await requestNewQuoteSignatureLink('token-expire')

    expect(result).toEqual({ error: null, alreadyRequested: false })
    expect(db.rows.signature_link_requests).toEqual([
      expect.objectContaining({ organization_id: 'org-1', quote_id: 'quote-1', resolved_at: null }),
    ])
    expect(adapters.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org-1', to: 'pro@atelier.test' }))
    expect(adapters.sendPushToOrgPermission).toHaveBeenCalledWith('org-1', 'quotes.send', expect.objectContaining({ url: '/finances/quote-editor?id=quote-1' }))
    // Le jeton n'est ni prolongé ni remplacé : seul un nouvel envoi par l'artisan en crée un.
    expect(db.rows.quotes[0].signature_token).toBe('token-expire')
    expect(db.rows.quotes[0].signature_token_expires_at).toBe(expired)
  })

  it('ne prévient pas l’artisan une seconde fois tant que la demande est ouverte', async () => {
    seedQuote()
    await requestNewQuoteSignatureLink('token-expire')
    const second = await requestNewQuoteSignatureLink('token-expire')

    expect(second).toEqual({ error: null, alreadyRequested: true })
    expect(db.rows.signature_link_requests).toHaveLength(1)
    expect(adapters.sendEmail).toHaveBeenCalledTimes(1)
  })

  it('refuse un lien encore valide, un devis signé, archivé ou retiré, et un jeton inconnu', async () => {
    seedQuote({ id: 'q-fresh', signature_token: 'fresh', signature_token_expires_at: fresh })
    seedQuote({ id: 'q-signed', signature_token: 'signed', signed_at: new Date(NOW - 1000).toISOString(), status: 'accepted' })
    seedQuote({ id: 'q-archived', signature_token: 'archived', is_archived: true })
    seedQuote({ id: 'q-draft', signature_token: 'draft', status: 'draft' })

    expect((await requestNewQuoteSignatureLink('fresh')).error).toMatch(/encore valide/)
    expect((await requestNewQuoteSignatureLink('signed')).error).toMatch(/plus ouvert/)
    expect((await requestNewQuoteSignatureLink('archived')).error).toMatch(/plus ouvert/)
    expect((await requestNewQuoteSignatureLink('draft')).error).toMatch(/plus ouvert/)
    expect((await requestNewQuoteSignatureLink('inconnu')).error).toBe('Lien de signature invalide.')
    expect((await requestNewQuoteSignatureLink('   ')).error).toBe('Lien de signature invalide.')
    expect(db.rows.signature_link_requests).toHaveLength(0)
    expect(adapters.sendEmail).not.toHaveBeenCalled()
  })

  it('respecte la limite de demandes par adresse IP', async () => {
    seedQuote()
    adapters.checkRateLimit.mockResolvedValue({ allowed: false })
    const result = await requestNewQuoteSignatureLink('token-expire')

    expect(result.error).toMatch(/Trop de demandes/)
    expect(adapters.checkRateLimit).toHaveBeenCalledWith(expect.objectContaining({ scope: 'public_signature_link_request', identifier: '203.0.113.7' }))
    expect(db.rows.signature_link_requests).toHaveLength(0)
  })
})
