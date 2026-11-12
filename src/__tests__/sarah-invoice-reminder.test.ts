import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  getCurrentOrganizationId: vi.fn(),
  getCurrentMembershipContext: vi.fn(),
  hasPermission: vi.fn(),
  sendInvoiceReminder: vi.fn(),
  sendQuoteFollowup: vi.fn(),
  markQuoteRefused: vi.fn(),
  resendSend: vi.fn(),
  state: { proposalStatus: 'pending' as 'pending' | 'executed' | 'failed' },
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('@/lib/data/queries/clients', () => ({
  getCurrentOrganizationId: mocks.getCurrentOrganizationId,
  getClientById: vi.fn(),
}))
vi.mock('@/lib/data/queries/membership', () => ({
  getCurrentMembershipContext: mocks.getCurrentMembershipContext,
  hasPermission: mocks.hasPermission,
}))
vi.mock('@/lib/data/mutations/reminders', () => ({
  sendInvoiceReminder: mocks.sendInvoiceReminder,
  sendQuoteFollowup: mocks.sendQuoteFollowup,
  markQuoteRefused: mocks.markQuoteRefused,
}))
vi.mock('@/lib/email/organization', () => ({ renderOrganizationEmail: vi.fn(({ bodyHtml }: { bodyHtml: string }) => bodyHtml) }))
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: mocks.resendSend }
    constructor(_apiKey: string) {}
  },
}))

import { confirmSarahAction, executeSarahActionPayload } from '@/lib/sarah/actions'

function makeAdminQuery(table: string) {
  let updateStatus: string | null = null
  const result = () => {
    if (table === 'sarah_action_proposals') {
      if (updateStatus === 'executed') return { data: { id: 'proposal-1' }, error: null }
      if (updateStatus === 'failed') return { data: null, error: null }
      return {
        data: {
          id: 'proposal-1',
          organization_id: 'org-1',
          user_id: null,
          type: 'invoice_reminder',
          risk: 'medium',
          title: 'Relancer la facture F-1',
          description: 'Relance à confirmer',
          payload: { invoice_id: 'invoice-1', subject: 'Relance facture F-1', draft_text: 'Bonjour, votre facture reste à régler.' },
          deep_link: '/finances/invoice-editor?id=invoice-1',
          status: 'pending',
          dedupe_key: null,
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          created_at: new Date().toISOString(),
          error: null,
        },
        error: null,
      }
    }
    if (table === 'invoices') {
      return { data: { id: 'invoice-1', client_id: 'client-1', number: 'F-1', title: null }, error: null }
    }
    if (table === 'organizations') {
      return {
        data: {
          name: 'Atelier', slug: 'atelier', email: 'contact@atelier.test', email_from_name: 'Atelier',
          email_from_address: 'relances@example.test', email_signature: null, logo_url: null,
        },
        error: null,
      }
    }
    if (table === 'clients') {
      return {
        data: [{
          id: 'client-1', email: 'client@example.test', first_name: 'Camille', last_name: 'Martin',
          company_name: null, contact_name: null, type: 'individual', status: 'active',
        }],
        error: null,
      }
    }
    if (table === 'email_broadcasts') return { data: { id: 'broadcast-1' }, error: null }
    return { data: null, error: null }
  }
  const query: Record<string, any> = {}
  for (const method of ['select', 'eq', 'not', 'neq', 'limit', 'in', 'or', 'insert']) {
    query[method] = () => query
  }
  query.update = (values: { status?: string }) => {
    updateStatus = values.status ?? null
    if (table === 'sarah_action_proposals' && updateStatus) {
      mocks.state.proposalStatus = updateStatus as typeof mocks.state.proposalStatus
    }
    return query
  }
  query.maybeSingle = async () => result()
  query.single = async () => result()
  query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject)
  return query
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.state.proposalStatus = 'pending'
  vi.stubEnv('RESEND_API_KEY', 'test-resend-key')
  vi.stubEnv('SHARED_EMAIL_DOMAIN', 'example.test')
  mocks.getCurrentOrganizationId.mockResolvedValue('org-1')
  mocks.getCurrentMembershipContext.mockResolvedValue({ userId: 'user-1' })
  mocks.hasPermission.mockImplementation(async (permission: string) => permission === 'ai.sarah' || permission === 'clients.edit')
  mocks.sendInvoiceReminder.mockImplementation(async (_invoiceId: string, _draft: { subject: string; body: string }) => (
    await mocks.hasPermission('reminders.send_manual')
      ? { error: null }
      : { error: 'Action non autorisée.' }
  ))
  mocks.resendSend.mockResolvedValue({ error: null })
  mocks.createClient.mockImplementation(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from: (table: string) => makeAdminQuery(table),
  }))
  mocks.createAdminClient.mockImplementation(() => ({ from: (table: string) => makeAdminQuery(table) }))
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('Sarah invoice reminder', () => {
  it('surfaces the manual-reminder refusal during Sarah confirmation, even with client-edit permission', async () => {
    const result = await confirmSarahAction('proposal-1')

    expect(result).toMatchObject({ ok: false, error: 'execution_failed' })
    expect(mocks.state.proposalStatus).toBe('failed')
    expect(mocks.resendSend).not.toHaveBeenCalled()
  })

  it('keeps an untargeted invoice draft as a preview without sending it', async () => {
    const result = await executeSarahActionPayload('invoice_reminder', {
      subject: 'Relance facture',
      draft_text: 'Bonjour, votre facture reste à régler.',
    })

    expect(result).toMatchObject({ ok: true })
    expect(mocks.resendSend).not.toHaveBeenCalled()
  })
})
