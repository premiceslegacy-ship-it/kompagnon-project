import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  user: { id: 'owner-user' } as { id: string } | null,
  organizationId: '11111111-1111-4111-8111-111111111111',
  organizationSlug: 'acme',
  permitted: true,
  rateLimitAllowed: true,
  requestId: '11111111-1111-4111-8111-111111111111',
  requestRow: {
    id: '11111111-1111-4111-8111-111111111111',
    attachments: [{
      storage_path: 'quote-requests/11111111-1111-4111-8111-111111111111/1234-abcd.pdf',
      filename: 'plan.pdf',
      size: 8,
      content_type: 'application/pdf',
    }],
    attachment_url: null,
  } as Record<string, unknown> | null,
  registeredObjectPath: 'quote-requests/11111111-1111-4111-8111-111111111111/1234-abcd.pdf' as string | null,
  registeredObjectOrganizationId: '11111111-1111-4111-8111-111111111111',
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  getCurrentOrganizationId: vi.fn(),
  hasPermission: vi.fn(),
  checkRateLimit: vi.fn(),
  getClientIp: vi.fn(),
  upload: vi.fn(),
  download: vi.fn(),
  info: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('@/lib/data/queries/clients', () => ({ getCurrentOrganizationId: mocks.getCurrentOrganizationId }))
vi.mock('@/lib/data/queries/membership', () => ({ hasPermission: mocks.hasPermission }))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mocks.checkRateLimit,
  getClientIp: mocks.getClientIp,
}))
vi.mock('@/lib/supabase/config', () => ({
  getSupabaseRuntimeConfig: () => ({ supabaseUrl: 'https://project.supabase.co', supabaseAnonKey: 'public-test-key' }),
}))

import { POST as uploadAttachment } from '@/app/api/public/quote-attachments/route'
import { GET as downloadAttachment } from '@/app/api/requests/[id]/attachment/route'

type MockQuery = {
  select: () => MockQuery
  eq: (column: string, value: unknown) => MockQuery
  maybeSingle: () => Promise<{ data: unknown; error: null }>
}

function createAdminMock() {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {}
      const query: MockQuery = {
        select: () => query,
        eq: (column, value) => {
          filters[column] = value
          return query
        },
        maybeSingle: async () => {
          if (table === 'organizations') {
            const matches = filters.slug === mocks.organizationSlug && filters.public_form_enabled === true
              || filters.id === mocks.organizationId
            return {
              data: matches ? { id: mocks.organizationId, slug: mocks.organizationSlug, public_form_enabled: true } : null,
              error: null,
            }
          }
          if (table === 'quote_attachment_object_ownership') {
            const matches = filters.object_path === mocks.registeredObjectPath
              && filters.organization_id === mocks.registeredObjectOrganizationId
            return { data: matches ? { object_path: mocks.registeredObjectPath } : null, error: null }
          }
          if (table === 'quote_requests') {
            const matches = filters.id === mocks.requestId && filters.organization_id === mocks.organizationId
            return { data: matches ? mocks.requestRow : null, error: null }
          }
          return { data: null, error: null }
        },
      }
      return query
    },
    storage: {
      from: () => ({ upload: mocks.upload, download: mocks.download, info: mocks.info }),
    },
  }
}

function makeUploadRequest(options?: { file?: File; honeypot?: string; headerHoneypot?: string }) {
  const formData = new FormData()
  formData.set('org_slug', mocks.organizationSlug)
  formData.set('_hp_website', options?.honeypot ?? '')
  formData.set('file', options?.file ?? new File([new TextEncoder().encode('%PDF-1.7')], 'plan.pdf', { type: 'application/pdf' }))
  const headers = options?.headerHoneypot ? { 'x-public-form-honeypot': options.headerHoneypot } : undefined
  return new NextRequest(`http://localhost/api/public/quote-attachments?org_slug=${mocks.organizationSlug}`, {
    method: 'POST',
    body: formData,
    ...(headers ? { headers } : {}),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.user = { id: 'owner-user' }
  mocks.organizationId = '11111111-1111-4111-8111-111111111111'
  mocks.requestId = '11111111-1111-4111-8111-111111111111'
  mocks.organizationSlug = 'acme'
  mocks.permitted = true
  mocks.rateLimitAllowed = true
  mocks.requestRow = {
    id: mocks.requestId,
    attachments: [{
      storage_path: 'quote-requests/11111111-1111-4111-8111-111111111111/1234-abcd.pdf',
      filename: 'plan.pdf',
      size: 8,
      content_type: 'application/pdf',
    }],
    attachment_url: null,
  }
  mocks.registeredObjectPath = 'quote-requests/11111111-1111-4111-8111-111111111111/1234-abcd.pdf'
  mocks.registeredObjectOrganizationId = '11111111-1111-4111-8111-111111111111'
  mocks.createAdminClient.mockImplementation(createAdminMock)
  mocks.createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
  })
  mocks.getCurrentOrganizationId.mockResolvedValue(mocks.organizationId)
  mocks.hasPermission.mockImplementation(async () => mocks.permitted)
  mocks.checkRateLimit.mockImplementation(async () => ({ allowed: mocks.rateLimitAllowed }))
  mocks.getClientIp.mockReturnValue('198.51.100.10')
  mocks.upload.mockImplementation(async (path: string) => ({ data: { path }, error: null }))
  mocks.download.mockImplementation(async () => ({
    data: new Blob([new TextEncoder().encode('%PDF-1.7')], { type: 'application/pdf' }),
    error: null,
  }))
  mocks.info.mockResolvedValue({ data: null, error: null })
})

describe('public quote attachment upload route', () => {
  it('accepts an anonymous, validated file and generates the org-scoped path server-side', async () => {
    mocks.user = null
    const response = await uploadAttachment(makeUploadRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.attachment.storage_path).toMatch(/^quote-requests\/11111111-1111-4111-8111-111111111111\/[0-9a-f-]{36}\.pdf$/)
  })

  it('preserves the validated JPEG extension in the generated object path', async () => {
    const jpeg = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'plan.jpeg', { type: 'image/jpeg' })
    const response = await uploadAttachment(makeUploadRequest({ file: jpeg }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.attachment.storage_path).toMatch(/^quote-requests\/11111111-1111-4111-8111-111111111111\/[0-9a-f-]{36}\.jpeg$/)
  })


  it('does not upload honeypot submissions or MIME/signature mismatches', async () => {
    const honeyResponse = await uploadAttachment(makeUploadRequest({ headerHoneypot: 'filled' }))
    expect(honeyResponse.status).toBe(200)
    expect(await honeyResponse.json()).toEqual({ ignored: true })
    const bodyHoneyResponse = await uploadAttachment(makeUploadRequest({ honeypot: 'filled' }))
    expect(bodyHoneyResponse.status).toBe(200)
    expect(await bodyHoneyResponse.json()).toEqual({ ignored: true })


    const badFile = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'plan.pdf', { type: 'application/pdf' })
    const invalidResponse = await uploadAttachment(makeUploadRequest({ file: badFile }))
    expect(invalidResponse.status).toBe(415)
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it('rejects a rate-limited upload before writing to Storage', async () => {
    mocks.rateLimitAllowed = false
    const response = await uploadAttachment(makeUploadRequest())

    expect(response.status).toBe(429)
    expect(mocks.upload).not.toHaveBeenCalled()
  })
})

describe('authenticated quote attachment download route', () => {
  it('streams the owning organization request file with private, no-store headers', async () => {
    const response = await downloadAttachment(
      new NextRequest(`http://localhost/api/requests/${mocks.requestId}/attachment`),
      { params: Promise.resolve({ id: mocks.requestId }) },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(await response.text()).toBe('%PDF-1.7')
    expect(mocks.download).toHaveBeenCalledWith('quote-requests/11111111-1111-4111-8111-111111111111/1234-abcd.pdf')
  })
  it('serves reviewed opaque migration objects only as downloaded octet streams', async () => {
    const path = `quote-requests/${mocks.organizationId}/migrated-${'b'.repeat(64)}.bin`
    mocks.requestRow = {
      id: mocks.requestId,
      attachments: [{ storage_path: path, filename: 'legacy source with unknown type', content_type: 'application/pdf' }],
      attachment_url: null,
    }
    mocks.registeredObjectPath = path
    mocks.download.mockResolvedValue({
      data: new Blob([new Uint8Array([0, 1, 2, 3])], { type: 'application/pdf' }),
      error: null,
    })

    const response = await downloadAttachment(
      new NextRequest(`http://localhost/api/requests/${mocks.requestId}/attachment`),
      { params: Promise.resolve({ id: mocks.requestId }) },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/octet-stream')
    expect(response.headers.get('content-disposition')).toContain('attachment;')
    expect(response.headers.get('content-disposition')).toContain('legacy source with unknown type')
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([0, 1, 2, 3])
  })

  it('rejects unauthenticated and cross-organization requests before Storage access', async () => {
    mocks.user = null
    const unauthenticated = await downloadAttachment(
      new NextRequest(`http://localhost/api/requests/${mocks.requestId}/attachment`),
      { params: Promise.resolve({ id: mocks.requestId }) },
    )
    expect(unauthenticated.status).toBe(401)

    mocks.user = { id: 'owner-user' }
    mocks.organizationId = 'org-b'
    const foreignRequest = await downloadAttachment(
      new NextRequest('http://localhost/api/requests/22222222-2222-4222-8222-222222222222/attachment'),
      { params: Promise.resolve({ id: '22222222-2222-4222-8222-222222222222' }) },
    )
    expect(foreignRequest.status).toBe(404)
    expect(mocks.download).not.toHaveBeenCalled()
  })
  it('rejects a UUID-looking object that has no authoritative ownership record', async () => {
    mocks.registeredObjectPath = null

    const response = await downloadAttachment(
      new NextRequest(`http://localhost/api/requests/${mocks.requestId}/attachment`),
      { params: Promise.resolve({ id: mocks.requestId }) },
    )

    expect(response.status).toBe(404)
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('does not fall back to legacy public URL metadata', async () => {
    mocks.requestRow = {
      id: mocks.requestId,
      attachments: [{ public_url: 'https://project.supabase.co/storage/v1/object/public/quote-attachments/quote-requests/acme/old.pdf' }],
      attachment_url: 'https://project.supabase.co/storage/v1/object/public/quote-attachments/quote-requests/acme/old.pdf',
    }

    const response = await downloadAttachment(
      new NextRequest(`http://localhost/api/requests/${mocks.requestId}/attachment`),
      { params: Promise.resolve({ id: mocks.requestId }) },
    )

    expect(response.status).toBe(404)
    expect(mocks.download).not.toHaveBeenCalled()
  })
  it('rejects a different tenant even when its request is changed to another tenant path', async () => {
    mocks.organizationId = '22222222-2222-4222-8222-222222222222'
    mocks.requestId = '22222222-2222-4222-8222-222222222222'
    mocks.getCurrentOrganizationId.mockResolvedValue(mocks.organizationId)
    mocks.requestRow = {
      id: mocks.requestId,
      attachments: [{
        storage_path: 'quote-requests/11111111-1111-4111-8111-111111111111/1234-abcd.pdf',
        filename: 'plan.pdf',
      }],
      attachment_url: null,
    }

    const response = await downloadAttachment(
      new NextRequest(`http://localhost/api/requests/${mocks.requestId}/attachment`),
      { params: Promise.resolve({ id: mocks.requestId }) },
    )

    expect(response.status).toBe(404)
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('requires the lead-management permission', async () => {
    mocks.permitted = false
    const response = await downloadAttachment(
      new NextRequest(`http://localhost/api/requests/${mocks.requestId}/attachment`),
      { params: Promise.resolve({ id: mocks.requestId }) },
    )

    expect(response.status).toBe(403)
    expect(mocks.download).not.toHaveBeenCalled()
  })
})
