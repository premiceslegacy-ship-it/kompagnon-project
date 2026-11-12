import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  getCurrentOrganizationId: vi.fn(),
  hasPermission: vi.fn(),
  sendEmail: vi.fn(),
  renderOrganizationEmail: vi.fn(),
  syncInvoiceMemoryEntry: vi.fn(),
  logAuditEvent: vi.fn(),
  trackServerEvent: vi.fn(),
  sendPushToOrg: vi.fn(),
  paymentResult: null as unknown,
  customTemplate: null as null | { subject: string | null; body_text: string },
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('@/lib/data/queries/clients', () => ({ getCurrentOrganizationId: mocks.getCurrentOrganizationId }))
vi.mock('@/lib/data/queries/membership', () => ({ hasPermission: mocks.hasPermission }))
vi.mock('@/lib/email', () => ({ sendEmail: mocks.sendEmail }))
vi.mock('@/lib/email/organization', () => ({ renderOrganizationEmail: mocks.renderOrganizationEmail }))
vi.mock('@/lib/data/mutations/document-memory', () => ({ syncInvoiceMemoryEntry: mocks.syncInvoiceMemoryEntry }))
vi.mock('@/lib/audit-log', () => ({ logAuditEvent: mocks.logAuditEvent }))
vi.mock('@/lib/analytics-server', () => ({ trackServerEvent: mocks.trackServerEvent }))
vi.mock('@/lib/push', () => ({ sendPushToOrg: mocks.sendPushToOrg }))
vi.mock('@/lib/data/queries/organization', () => ({ getOrganization: vi.fn() }))
vi.mock('@/lib/pdf/server', () => ({ renderInvoicePdfBufferById: vi.fn(), renderContractPdfBufferById: vi.fn() }))
vi.mock('@/lib/data/mutations/einvoicing', () => ({ transmitInvoiceViaSuperPdp: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { markInvoicePaid } from '@/lib/data/mutations/invoices'

const INVOICE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

function makePaymentResult({
  amountRecorded,
  totalPaid,
  paidAt = '2026-11-11T04:30:00.000Z',
}: {
  amountRecorded: number
  totalPaid: number
  paidAt?: string
}) {
  return {
    changed: true,
    amount_recorded: amountRecorded,
    total_paid: totalPaid,
    paid_at: paidAt,
    invoice: {
      id: INVOICE_ID,
      number: 'FAC-2026-011',
      title: 'Travaux de menuiserie',
      currency: 'EUR',
      client_id: 'client-1',
      total_ttc: 1200,
    },
  }
}

function makeSupabase() {
  const recipient = {
    type: 'individual',
    company_name: null,
    contact_name: null,
    first_name: 'Camille',
    last_name: 'Martin',
    email: 'camille@example.test',
  }
  type MockQuery = {
    select: (columns: string) => MockQuery
    eq: (column: string, value: unknown) => MockQuery
    single: () => Promise<{ data: unknown; error: null }>
    maybeSingle: () => Promise<{ data: unknown; error: null }>
  }
  const queryFor = (table: string): MockQuery => {
    const query = {} as MockQuery
    query.select = () => query
    query.eq = () => query
    query.single = async () => ({
      data: table === 'clients'
        ? recipient
        : { name: 'Atelier Exemple', email: 'atelier@example.test', email_signature: null, logo_url: null },
      error: null,
    })
    query.maybeSingle = async () => ({
      data: table === 'email_templates'
        ? mocks.customTemplate
        : table === 'clients'
          ? { company_name: null, contact_name: null }
          : null,
      error: null,
    })
    return query
  }

  return {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    rpc: async () => ({ data: mocks.paymentResult, error: null }),
    from: queryFor,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.paymentResult = makePaymentResult({ amountRecorded: 1000, totalPaid: 1000 })
  mocks.customTemplate = null
  mocks.createClient.mockResolvedValue(makeSupabase())
  mocks.getCurrentOrganizationId.mockResolvedValue('org-1')
  mocks.hasPermission.mockResolvedValue(true)
  mocks.sendEmail.mockResolvedValue({ error: null })
  mocks.renderOrganizationEmail.mockImplementation(({ bodyHtml }: { bodyHtml: string }) => bodyHtml)
  mocks.syncInvoiceMemoryEntry.mockResolvedValue(undefined)
  mocks.logAuditEvent.mockResolvedValue(undefined)
  mocks.trackServerEvent.mockResolvedValue(undefined)
  mocks.sendPushToOrg.mockResolvedValue(undefined)
})

describe('reçu de paiement de facture', () => {
  it('adresse le reçu au versement enregistré et à la date de règlement saisie', async () => {
    const result = await markInvoicePaid(INVOICE_ID, { payment_date: '2026-11-09' })
    expect(result.error).toBeNull()

    const email = mocks.sendEmail.mock.calls[0]?.[0] as { html: string }
    expect(email.html).toContain(new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(1000))
    expect(email.html).not.toContain(new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(1200))
    expect(email.html).toContain('09 novembre 2026')
    expect(email.html).not.toContain('11 novembre 2026')
  })

  it('n’envoie aucun reçu quand l’autorité ne constate aucun nouveau versement', async () => {
    mocks.paymentResult = makePaymentResult({ amountRecorded: 0, totalPaid: 0 })

    const result = await markInvoicePaid(INVOICE_ID, { payment_date: '2026-11-09' })
    expect(result).toMatchObject({ error: null, total_paid: 0 })

    expect(mocks.sendEmail).not.toHaveBeenCalled()
  })

  it('le modèle personnalisé reçoit le dernier versement, pas le cumul déjà réglé', async () => {
    mocks.paymentResult = makePaymentResult({ amountRecorded: 800, totalPaid: 1100 })
    mocks.customTemplate = {
      subject: 'Reçu {{numero_facture}}',
      body_text: 'Montant {{montant_ttc}} reçu le {{date_reglement}}.',
    }

    const result = await markInvoicePaid(INVOICE_ID, { payment_date: '2026-11-09' })
    expect(result.error).toBeNull()

    const email = mocks.sendEmail.mock.calls[0]?.[0] as { html: string }
    expect(email.html).toContain(new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(800))
    expect(email.html).not.toContain(new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(1100))
    expect(email.html).not.toContain(new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(1200))
    expect(email.html).toContain('09 novembre 2026')
  })

  it('utilise la date civile de Paris au changement d’année pour le reçu standard et personnalisé', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-12-31T23:30:00.000Z'))
      mocks.paymentResult = makePaymentResult({
        amountRecorded: 1000,
        totalPaid: 1000,
        paidAt: '2026-12-31T23:30:00.000Z',
      })

      const result = await markInvoicePaid(INVOICE_ID)
      expect(result.error).toBeNull()

      const standardEmail = mocks.sendEmail.mock.calls[0]?.[0] as { html: string }
      expect(standardEmail.html).toContain('01 janvier 2027')
      expect(standardEmail.html).not.toContain('31 décembre 2026')

      mocks.customTemplate = {
        subject: 'Reçu {{numero_facture}}',
        body_text: 'Montant {{montant_ttc}} reçu le {{date_reglement}}.',
      }
      const customResult = await markInvoicePaid(INVOICE_ID)
      expect(customResult.error).toBeNull()

      const customEmail = mocks.sendEmail.mock.calls[1]?.[0] as { html: string }
      expect(customEmail.html).toContain('01 janvier 2027')
      expect(customEmail.html).not.toContain('31 décembre 2026')
    } finally {
      vi.useRealTimers()
    }
  })
})
