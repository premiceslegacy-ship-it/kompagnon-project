import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/cron/recurring-invoices/route'
import { sendInvoice } from '@/lib/data/mutations/invoices'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  getCurrentOrganizationId: vi.fn(),
  getOrganization: vi.fn(),
  hasPermission: vi.fn(),
  verifyCronSecret: vi.fn(),
  sendEmail: vi.fn(),
  renderInvoicePdfBufferById: vi.fn(),
  renderContractPdfBufferById: vi.fn(),
  syncInvoiceMemoryEntry: vi.fn(),
  transmitInvoiceViaSuperPdp: vi.fn(),
  trackServerEvent: vi.fn(),
  state: {
    invoiceStatus: 'draft' as 'draft' | 'sending' | 'sent' | 'partial' | 'paid',
    invoiceSentAt: null as string | null,
    totalHt: 100,
    totalTva: 20,
    totalTtc: 120,
    totalPaid: 0,
    resendClaim: null as null | { token: string; state: 'claimed' | 'ambiguous' },
    scheduleStatus: 'pending_confirmation' as 'pending_confirmation' | 'sent',
    closeFailures: 0,
  },
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('@/lib/data/queries/clients', () => ({ getCurrentOrganizationId: mocks.getCurrentOrganizationId }))
vi.mock('@/lib/data/queries/organization', () => ({ getOrganization: mocks.getOrganization }))
vi.mock('@/lib/data/queries/membership', () => ({ hasPermission: mocks.hasPermission }))
vi.mock('@/lib/cron-auth', () => ({ verifyCronSecret: mocks.verifyCronSecret }))
vi.mock('@/lib/email', () => ({ sendEmail: mocks.sendEmail }))
vi.mock('@/lib/email/organization', () => ({ renderOrganizationEmail: vi.fn(({ bodyHtml }: { bodyHtml: string }) => bodyHtml) }))
vi.mock('@/lib/email/templates', () => ({ buildInvoicePaidEmail: vi.fn(), buildDepositInvoiceEmail: vi.fn() }))
vi.mock('@/lib/pdf/server', () => ({
  renderInvoicePdfBufferById: mocks.renderInvoicePdfBufferById,
  renderContractPdfBufferById: mocks.renderContractPdfBufferById,
}))
vi.mock('@/lib/data/mutations/document-memory', () => ({ syncInvoiceMemoryEntry: mocks.syncInvoiceMemoryEntry }))
vi.mock('@/lib/analytics-server', () => ({ trackServerEvent: mocks.trackServerEvent }))
vi.mock('@/lib/data/mutations/einvoicing', () => ({ transmitInvoiceViaSuperPdp: mocks.transmitInvoiceViaSuperPdp }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/data/queries/emailTemplates', () => ({
  DEFAULT_EMAIL_TEMPLATES: [{ slug: 'invoice_sent', subject: 'Facture {{numero_facture}}', body_text: 'Bonjour {{client_nom}}' }],
}))

function makeQuery(table: string) {
  let mode = ''
  let expectedInvoiceStatus: unknown
  let updateValues: Record<string, unknown> = {}
  const filters: Record<string, unknown> = {}
  const query: Record<string, (...args: any[]) => any> = {}

  query.select = (columns: string) => {
    if (!['invoiceClaim', 'invoiceSent', 'invoiceReleased', 'scheduleClosed', 'resendClaimInsert'].includes(mode)) {
      if (table === 'recurring_invoices') mode = 'models'
      else if (table === 'invoice_schedules') mode = 'pendingSchedules'
      else if (table === 'invoices') mode = columns === 'status' ? 'invoiceStatus' : 'invoiceDetails'
      else if (table === 'organizations') mode = 'organization'
      else if (table === 'email_templates') mode = 'template'
    }
    return query
  }
  query.eq = (column: string, value: unknown) => {
    filters[column] = value
    if (table === 'invoices' && column === 'status') expectedInvoiceStatus = value
    return query
  }
  query.not = () => query
  query.is = () => query
  query.in = () => query
  query.order = () => query
  query.limit = () => query
  query.insert = (values: Record<string, unknown>) => {
    updateValues = values
    if (table === 'invoice_resend_delivery_claims') mode = 'resendClaimInsert'
    return query
  }
  query.update = (values: Record<string, unknown>) => {
    updateValues = values
    if (table === 'invoices' && values.status === 'sending') mode = 'invoiceClaim'
    else if (table === 'invoices' && values.status === 'sent') mode = 'invoiceSent'
    else if (table === 'invoices' && values.status === 'draft') mode = 'invoiceReleased'
    else if (table === 'invoice_schedules' && values.status === 'sent') mode = 'scheduleClosed'
    else if (table === 'invoice_resend_delivery_claims') mode = 'resendClaimAmbiguous'
    return query
  }
  query.delete = () => {
    if (table === 'invoice_resend_delivery_claims') mode = 'resendClaimDelete'
    return query
  }

  const result = () => {
    if (mode === 'invoiceClaim') {
      if (expectedInvoiceStatus !== mocks.state.invoiceStatus) return { data: null, error: null }
      mocks.state.invoiceStatus = 'sending'
      return { data: { id: 'invoice-1' }, error: null }
    }
    if (mode === 'invoiceSent' || mode === 'invoiceReleased') {
      if (mocks.state.invoiceStatus !== 'sending') return { data: null, error: null }
      mocks.state.invoiceStatus = String(updateValues.status) as typeof mocks.state.invoiceStatus
      if (typeof updateValues.sent_at === 'string') mocks.state.invoiceSentAt = updateValues.sent_at
      return { data: { id: 'invoice-1' }, error: null }
    }
    if (mode === 'resendClaimInsert') {
      if (mocks.state.resendClaim) {
        return { data: null, error: { code: '23505', message: 'claim already exists' } }
      }
      mocks.state.resendClaim = { token: String(updateValues.claim_token), state: 'claimed' }
      return { data: { invoice_id: 'invoice-1' }, error: null }
    }
    if (mode === 'resendClaimAmbiguous') {
      const claim = mocks.state.resendClaim
      if (claim && claim.token === filters.claim_token) {
        claim.state = 'ambiguous'
      }
      return { data: null, error: null }
    }
    if (mode === 'resendClaimDelete') {
      if (mocks.state.resendClaim?.token === filters.claim_token) mocks.state.resendClaim = null
      return { data: null, error: null }
    }
    if (mode === 'scheduleClosed') {
      if (mocks.state.closeFailures > 0) {
        mocks.state.closeFailures--
        return { data: null, error: { message: 'schedule database unavailable' } }
      }
      if (mocks.state.scheduleStatus !== 'pending_confirmation') return { data: null, error: null }
      mocks.state.scheduleStatus = 'sent'
      return { data: { id: 'schedule-1' }, error: null }
    }
    if (mode === 'invoiceStatus') return { data: { status: mocks.state.invoiceStatus }, error: null }
    if (mode === 'invoiceDetails') {
      return {
        data: {
          id: 'invoice-1', number: 'F-2026-001', title: 'Facture récurrente', status: mocks.state.invoiceStatus,
          invoice_type: 'standard', total_ht: mocks.state.totalHt, total_tva: mocks.state.totalTva,
          total_ttc: mocks.state.totalTtc, total_paid: mocks.state.totalPaid, currency: 'EUR',
          issue_date: '2026-01-01', due_date: '2026-02-01', sent_at: mocks.state.invoiceSentAt, paid_at: null, created_at: '2026-01-01',
          notes_client: null, payment_conditions: null, aid_label: null, aid_amount: null,
          quote_id: null, chantier_id: null, client_id: 'client-1', situation_number: null,
          cumulative_pct: null, period_from: null, period_to: null, retention_pct: null,
          retention_amount: null, market_reference: null, is_reverse_charge: false,
          client: { id: 'client-1', email: 'client@example.test', company_name: 'Client test', type: 'individual' },
          items: [], payment_schedule: [],
        },
        error: null,
      }
    }
    if (mode === 'organization') {
      return { data: { id: 'org-1', name: 'Atelier test', email: 'atelier@example.test', email_from_address: 'factures@example.test', email_from_name: 'Atelier test', logo_url: null }, error: null }
    }
    if (mode === 'template') return { data: null, error: null }
    if (mode === 'pendingSchedules') {
      return {
        data: mocks.state.scheduleStatus === 'pending_confirmation'
          ? [{ id: 'schedule-1', invoice_id: 'invoice-1', organization_id: 'org-1', recurring_invoice_id: 'recurring-1', notified_at: '2026-01-01T00:00:00.000Z', recurring_invoice: { auto_send_delay_days: 0 } }]
          : [],
        error: null,
      }
    }
    if (mode === 'models') return { data: [], error: null }
    return { data: null, error: null }
  }

  query.maybeSingle = async () => result()
  query.single = async () => result()
  query.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result()).then(resolve, reject)
  return query
}

function request(): NextRequest {
  return new NextRequest('http://localhost/api/cron/recurring-invoices', {
    method: 'POST',
    headers: { 'x-cron-secret': 'local-test-secret' },
  })
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  mocks.state.invoiceStatus = 'draft'
  mocks.state.invoiceSentAt = null
  mocks.state.totalHt = 100
  mocks.state.totalTva = 20
  mocks.state.totalTtc = 120
  mocks.state.totalPaid = 0
  mocks.state.resendClaim = null
  mocks.state.scheduleStatus = 'pending_confirmation'
  mocks.state.closeFailures = 0
  mocks.verifyCronSecret.mockReturnValue(true)
  mocks.getCurrentOrganizationId.mockResolvedValue('org-1')
  mocks.getOrganization.mockResolvedValue({
    id: 'org-1', name: 'Atelier test', email: 'atelier@example.test',
    email_from_address: 'factures@example.test', email_from_name: 'Atelier test',
    logo_url: null, email_signature: null,
  })
  mocks.hasPermission.mockResolvedValue(true)
  mocks.sendEmail.mockReset()
  mocks.sendEmail.mockResolvedValue({ error: null, delivery: 'accepted' })
  mocks.transmitInvoiceViaSuperPdp.mockReset()
  mocks.transmitInvoiceViaSuperPdp.mockResolvedValue({ error: 'PDP not eligible' })
  mocks.renderInvoicePdfBufferById.mockResolvedValue({
    fileName: 'facture.pdf',
    buffer: Buffer.from([1, 2, 3]),
    authority: {
      invoice: {
        number: 'F-2026-001',
        title: 'Facture récurrente',
        currency: 'EUR',
        total_ttc: mocks.state.totalTtc,
        client: {
          id: 'client-1',
          email: 'client@example.test',
          company_name: 'Client test',
          first_name: null,
          last_name: null,
        },
      },
      organization: {
        id: 'org-1',
        name: 'Atelier test',
        email: 'atelier@example.test',
        email_from_address: 'factures@example.test',
        logo_url: null,
      },
    },
  })
  mocks.renderContractPdfBufferById.mockResolvedValue(null)
  mocks.syncInvoiceMemoryEntry.mockResolvedValue(undefined)
  mocks.trackServerEvent.mockResolvedValue(undefined)
  mocks.createAdminClient.mockReturnValue({ from: (table: string) => makeQuery(table) })
  mocks.createClient.mockResolvedValue({
    from: (table: string) => makeQuery(table),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
  })
})

describe('recurring invoice delivery idempotency', () => {
  it('repairs schedule closure after a sent email without sending it twice', async () => {
    mocks.state.closeFailures = 1
    const first = await POST(request())
    expect(await first.json()).toMatchObject({ autoSent: 0, errors: 1 })
    expect(mocks.state.invoiceStatus).toBe('sent')
    expect(mocks.state.scheduleStatus).toBe('pending_confirmation')

    const retry = await POST(request())
    expect(await retry.json()).toMatchObject({ autoSent: 1, errors: 0 })
    expect(mocks.state.scheduleStatus).toBe('sent')
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1)
  })

  it('keeps an ambiguous provider result claimed and never automatically resends', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      mocks.sendEmail.mockRejectedValueOnce(new Error('connection lost after provider acceptance'))
      const first = await POST(request())
      const retry = await POST(request())

      expect(await first.json()).toMatchObject({ autoSent: 0, errors: 1 })
      expect(await retry.json()).toMatchObject({ autoSent: 0, errors: 1 })
      expect(mocks.state.invoiceStatus).toBe('sending')
      expect(mocks.state.scheduleStatus).toBe('pending_confirmation')
      expect(mocks.sendEmail).toHaveBeenCalledTimes(1)
    } finally {
      log.mockRestore()
    }
  })

  it('leaves a Resend SDK transport-error result claimed and never automatically resends', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      mocks.sendEmail
        .mockResolvedValueOnce({ error: 'Unable to fetch data', delivery: 'unknown' })
        .mockResolvedValueOnce({ error: null, delivery: 'accepted' })
      const first = await POST(request())
      const retry = await POST(request())

      expect(await first.json()).toMatchObject({ autoSent: 0, errors: 1 })
      expect(await retry.json()).toMatchObject({ autoSent: 0, errors: 1 })
      expect(mocks.state.invoiceStatus).toBe('sending')
      expect(mocks.state.scheduleStatus).toBe('pending_confirmation')
      expect(mocks.sendEmail).toHaveBeenCalledTimes(1)
    } finally {
      log.mockRestore()
    }
  })

  it('releases a definitive provider rejection so a retry can deliver the invoice', async () => {
    mocks.sendEmail
      .mockResolvedValueOnce({ error: 'provider rejected message', delivery: 'rejected' })
      .mockResolvedValueOnce({ error: null, delivery: 'accepted' })
    const rejected = await POST(request())
    const retry = await POST(request())

    expect(await rejected.json()).toMatchObject({ autoSent: 0, errors: 1 })
    expect(await retry.json()).toMatchObject({ autoSent: 1, errors: 0 })
    expect(mocks.state.invoiceStatus).toBe('sent')
    expect(mocks.state.scheduleStatus).toBe('sent')
    expect(mocks.sendEmail).toHaveBeenCalledTimes(2)
  })
  describe('manual invoice delivery claims', () => {
    it('does not contact the provider when a cron/manual claim is already sending', async () => {
      mocks.state.invoiceStatus = 'sending'

      const result = await sendInvoice('invoice-1')

      expect(result.error).not.toBeNull()
      expect(mocks.sendEmail).not.toHaveBeenCalled()
      expect(mocks.state.invoiceStatus).toBe('sending')
    })

    it('claims and delivers a legitimate manual draft send', async () => {
      const result = await sendInvoice('invoice-1')

      expect(result.error).toBeNull()
      expect(mocks.sendEmail).toHaveBeenCalledTimes(1)
      expect(mocks.state.invoiceStatus).toBe('sent')
    })

    it('releases a rejected issued resend and retry preserves fiscal lifecycle facts', async () => {
      mocks.state.invoiceStatus = 'sent'
      mocks.state.invoiceSentAt = '2026-01-02T03:04:05.000Z'
      mocks.state.totalPaid = 45
      mocks.sendEmail.mockResolvedValueOnce({ error: 'validation rejection', delivery: 'rejected' })

      const rejected = await sendInvoice('invoice-1')
      const retry = await sendInvoice('invoice-1')

      expect(rejected.error).not.toBeNull()
      expect(retry.error).toBeNull()
      expect(mocks.sendEmail).toHaveBeenCalledTimes(2)
      expect(mocks.state.invoiceStatus).toBe('sent')
      expect(mocks.state.invoiceSentAt).toBe('2026-01-02T03:04:05.000Z')
      expect(mocks.state.totalHt).toBe(100)
      expect(mocks.state.totalTva).toBe(20)
      expect(mocks.state.totalTtc).toBe(120)
      expect(mocks.state.totalPaid).toBe(45)
      expect(mocks.state.resendClaim).toBeNull()
    })

    it('releases a successful issued resend claim without rewriting paid facts', async () => {
      mocks.state.invoiceStatus = 'paid'
      mocks.state.invoiceSentAt = '2026-02-03T04:05:06.000Z'
      mocks.state.totalPaid = 120

      const first = await sendInvoice('invoice-1')
      const second = await sendInvoice('invoice-1')

      expect(first.error).toBeNull()
      expect(second.error).toBeNull()
      expect(mocks.sendEmail).toHaveBeenCalledTimes(2)
      expect(mocks.state.invoiceStatus).toBe('paid')
      expect(mocks.state.invoiceSentAt).toBe('2026-02-03T04:05:06.000Z')
      expect(mocks.state.totalHt).toBe(100)
      expect(mocks.state.totalTva).toBe(20)
      expect(mocks.state.totalTtc).toBe(120)
      expect(mocks.state.totalPaid).toBe(120)
      expect(mocks.state.resendClaim).toBeNull()
    })

    it.each(['paid', 'partial'] as const)(
      'retains %s lifecycle and blocks duplicates after ambiguous delivery',
      async (status) => {
        mocks.state.invoiceStatus = status
        mocks.state.invoiceSentAt = '2026-03-04T05:06:07.000Z'
        mocks.state.totalPaid = status === 'paid' ? 120 : 45
        mocks.sendEmail.mockResolvedValueOnce({ error: 'Unable to fetch data', delivery: 'unknown' })

        const first = await sendInvoice('invoice-1')
        const retry = await sendInvoice('invoice-1')

        expect(first.error).not.toBeNull()
        expect(retry.error).not.toBeNull()
        expect(mocks.sendEmail).toHaveBeenCalledTimes(1)
        expect(mocks.state.invoiceStatus).toBe(status)
        expect(mocks.state.invoiceSentAt).toBe('2026-03-04T05:06:07.000Z')
        expect(mocks.state.totalHt).toBe(100)
        expect(mocks.state.totalTva).toBe(20)
        expect(mocks.state.totalTtc).toBe(120)
        expect(mocks.state.totalPaid).toBe(status === 'paid' ? 120 : 45)
        expect(mocks.state.resendClaim?.state).toBe('ambiguous')
      },
    )

    it.each(['missing', 'throws'] as const)(
      'does not dispatch or strand a first send when its invoice PDF %s',
      async (failure) => {
        if (failure === 'missing') mocks.renderInvoicePdfBufferById.mockResolvedValueOnce(null)
        else mocks.renderInvoicePdfBufferById.mockRejectedValueOnce(new Error('issued document authority unavailable'))

        const failed = await sendInvoice('invoice-1')

        expect(failed.error).not.toBeNull()
        expect(mocks.sendEmail).not.toHaveBeenCalled()
        expect(mocks.state.invoiceStatus).toBe('draft')
        expect(mocks.state.resendClaim).toBeNull()

        const retry = await sendInvoice('invoice-1')
        expect(retry.error).toBeNull()
        expect(mocks.sendEmail).toHaveBeenCalledTimes(1)
        expect(mocks.state.invoiceStatus).toBe('sent')
      },
    )

    it('serializes concurrent issued resends and releases the accepted claim', async () => {
      mocks.state.invoiceStatus = 'partial'
      mocks.state.invoiceSentAt = '2026-04-05T06:07:08.000Z'
      mocks.state.totalPaid = 45

      const results = await Promise.all([
        sendInvoice('invoice-1'),
        sendInvoice('invoice-1'),
      ])

      expect(results.filter((result) => result.error === null)).toHaveLength(1)
      expect(mocks.sendEmail).toHaveBeenCalledTimes(1)
      expect(mocks.state.invoiceStatus).toBe('partial')
      expect(mocks.state.invoiceSentAt).toBe('2026-04-05T06:07:08.000Z')
      expect(mocks.state.totalPaid).toBe(45)
      expect(mocks.state.resendClaim).toBeNull()
    })

    it('leaves an issued invoice unchanged and releases the resend claim when historical PDF authority is missing', async () => {
      mocks.state.invoiceStatus = 'paid'
      mocks.state.invoiceSentAt = '2026-05-06T07:08:09.000Z'
      mocks.state.totalPaid = 120
      mocks.renderInvoicePdfBufferById.mockRejectedValueOnce(new Error('Historical invoice authority is unavailable'))

      const result = await sendInvoice('invoice-1')

      expect(result.error).toContain('Historical invoice authority is unavailable')
      expect(mocks.sendEmail).not.toHaveBeenCalled()
      expect(mocks.state.invoiceStatus).toBe('paid')
      expect(mocks.state.invoiceSentAt).toBe('2026-05-06T07:08:09.000Z')
      expect(mocks.state.totalHt).toBe(100)
      expect(mocks.state.totalTva).toBe(20)
      expect(mocks.state.totalTtc).toBe(120)
      expect(mocks.state.totalPaid).toBe(120)
      expect(mocks.state.resendClaim).toBeNull()
    })

    it('keeps a manual claim after an ambiguous provider result', async () => {
      mocks.sendEmail.mockResolvedValueOnce({ error: 'Unable to fetch data', delivery: 'unknown' })

      const result = await sendInvoice('invoice-1')

      expect(result.error).not.toBeNull()
      expect(mocks.sendEmail).toHaveBeenCalledTimes(1)
      expect(mocks.state.invoiceStatus).toBe('sending')
    })

    it('serializes a manual send against the recurring-invoice cron', async () => {
      const [cronResponse, manualResult] = await Promise.all([
        POST(request()),
        sendInvoice('invoice-1'),
      ])
      const cronResult = await cronResponse.json()

      expect(mocks.sendEmail).toHaveBeenCalledTimes(1)
      expect(mocks.state.invoiceStatus).toBe('sent')
      expect(manualResult.error === null || cronResult.autoSent === 1).toBe(true)
    })
  })
})
