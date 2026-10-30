import { beforeEach, describe, expect, it, vi } from 'vitest'
import { submitQuoteRequest } from '@/lib/data/mutations/quote-requests'

const state = vi.hoisted(() => ({
  organization: {
    id: '11111111-1111-4111-8111-111111111111', slug: 'local-form', name: 'Local organization',
    public_form_enabled: true, logo_url: null, public_form_notification_email: null,
  } as Record<string, unknown>,
  requests: [] as Record<string, unknown>[],
  registeredPath: null as string | null,
}))

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({ allowed: true }), getClientIp: () => '127.0.0.1',
}))
vi.mock('@/lib/push', () => ({ sendPushToOrgPermission: async () => undefined }))
vi.mock('@/lib/email', () => ({ sendAuthEmail: async () => ({ error: null }) }))
vi.mock('@/lib/ai/callAI', () => ({ callAI: () => { throw new Error('No AI in a public submission') } }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from(table: string) {
      const filters: [string, unknown][] = []
      if (table === 'organizations') return {
        select() { return this },
        eq(column: string, value: unknown) { filters.push([column, value]); return this },
        async single() {
          const matches = filters.every(([column, value]) => state.organization[column] === value)
          return { data: matches ? state.organization : null, error: matches ? null : { code: 'PGRST116' } }
        },
      }
      if (table === 'quote_attachment_object_ownership') return {
        select() { return this },
        eq(column: string, value: unknown) { filters.push([column, value]); return this },
        async maybeSingle() {
          const matches = filters.some(([column, value]) => column === 'object_path' && value === state.registeredPath)
            && filters.some(([column, value]) => column === 'organization_id' && value === state.organization.id)
          return { data: matches ? { object_path: state.registeredPath } : null, error: null }
        },
      }
      if (table === 'quote_requests') return {
        select() { return this },
        eq(column: string, value: unknown) { filters.push([column, value]); return this },
        async gte() {
          return { count: state.requests.filter(row => filters.every(([column, value]) => row[column] === value)).length }
        },
        async insert(row: Record<string, unknown>) { state.requests.push(row); return { error: null } },
      }
      throw new Error(`Unexpected table ${table}`)
    },
    storage: {
      from: () => ({
        async info() {
          return { data: { contentType: 'application/pdf', size: 8, bucketId: 'quote-attachments' }, error: null }
        },
      }),
    },
  }),
}))
function publicInput(attachment?: string) {
  const form = new FormData()
  form.set('org_slug', 'local-form')
  form.set('_hp_website', '')
  form.set('name', 'Local prospect')
  form.set('email', 'prospect@example.test')
  form.set('description', 'Une demande de rénovation locale.')
  if (attachment) {
    form.set('attachments', JSON.stringify([{
      storage_path: attachment,
      filename: 'plan.pdf',
      size: 8,
      content_type: 'application/pdf',
    }]))
  }
  return form
}

beforeEach(() => {
  state.organization.public_form_enabled = true
  state.requests = []
  state.registeredPath = null
})

describe('public quote request authority', () => {
  it('rejects a direct submission after the organization disables its form', async () => {
    state.organization.public_form_enabled = false
    const result = await submitQuoteRequest({ error: null, success: false }, publicInput())
    expect(result.success).toBe(false)
    expect(result.error).not.toBeNull()
    expect(state.requests).toEqual([])
  })

  it('retains a legitimate submission for the enabled organization', async () => {
    const result = await submitQuoteRequest({ error: null, success: false }, publicInput())
    expect(result).toEqual({ error: null, success: true })
    expect(state.requests).toMatchObject([{
      organization_id: '11111111-1111-4111-8111-111111111111', email: 'prospect@example.test',
      description: 'Une demande de rénovation locale.', status: 'new',
    }])
  })

  it('accepts attachment metadata only when the exact object is privately registered to the organization', async () => {
    const organizationId = String(state.organization.id)
    const path = `quote-requests/${organizationId}/1234-abcd.pdf`
    state.registeredPath = path
    const accepted = await submitQuoteRequest({ error: null, success: false }, publicInput(path))
    expect(accepted).toEqual({ error: null, success: true })
    expect(state.requests[0]?.attachments).toMatchObject([{ storage_path: path, filename: 'plan.pdf' }])

    state.requests = []
    state.registeredPath = null
    const unregistered = await submitQuoteRequest({ error: null, success: false }, publicInput(path))
    expect(unregistered.success).toBe(false)
    expect(unregistered.error).toContain('pièce jointe est invalide')
    expect(state.requests).toEqual([])
  })
})
