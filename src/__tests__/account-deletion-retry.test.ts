import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/cron/account-deletion/route'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  verifyCronSecret: vi.fn(),
  logAuditEvent: vi.fn(),
  storageList: vi.fn(),
  storageRemove: vi.fn(),
  deleteUser: vi.fn(),
  getUserById: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/cron-auth', () => ({ verifyCronSecret: mocks.verifyCronSecret }))
vi.mock('@/lib/audit-log', () => ({ logAuditEvent: mocks.logAuditEvent }))

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_USER_ID = '33333333-3333-4333-8333-333333333333'
let cleanupCompletedAt: string | null
let storageListCount: number
let activeOtherMembershipCount: number
let logoManifestUrl: string | null
let otherLiveLogoReference: boolean
let logoManifestMissing: boolean
let organizationAnonymizedAt: string | null
let targetMembershipIds: string[]
let storageBucketForCall: string
let storageFiles: Map<string, Set<string>>
let authUserIds: Set<string>

type MockQuery = {
  select: (columns: string, options?: { head?: boolean }) => MockQuery
  not: (...args: unknown[]) => MockQuery
  lte: (...args: unknown[]) => MockQuery
  is: (...args: unknown[]) => MockQuery
  neq: (...args: unknown[]) => MockQuery
  limit: (...args: unknown[]) => MockQuery
  or: (...args: unknown[]) => MockQuery
  match: (...args: unknown[]) => MockQuery
  eq: (column: string, value: string) => MockQuery
  update: (values: Record<string, unknown>) => MockQuery
  maybeSingle: () => Promise<unknown>
  then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise<unknown>
}

function installDurableStorageMocks() {
  mocks.storageList.mockReset()
  mocks.storageList.mockImplementation(async (folder: string) => {
    storageListCount++
    const files = [...(storageFiles.get(storageBucketForCall) ?? [])]
      .filter((path) => path.startsWith(`${folder}/`))
      .map((path) => path.slice(folder.length + 1))
    return { data: files.map((name) => ({ id: 'stored-object', name })), error: null }
  })
  mocks.storageRemove.mockReset()
  mocks.storageRemove.mockImplementation(async (paths: string[]) => {
    const files = storageFiles.get(storageBucketForCall)
    for (const path of paths) files?.delete(path)
    return { error: null }
  })
}

function makeQuery(table: string) {
  let kind = ''
  let updateValues: Record<string, unknown> | null = null
  const filters = new Map<string, string>()
  const result = () => {
    if (table === 'organizations' && kind === 'due') {
      return { data: cleanupCompletedAt ? [] : [{ id: ORG_ID, name: 'Atelier test' }], error: null }
    }
    if (table === 'organizations' && kind === 'slug') {
      return { data: { slug: 'atelier-test' }, error: null }
    }
    if (table === 'organizations' && kind === 'marker') {
      if (cleanupCompletedAt) return { data: null, error: null }
      cleanupCompletedAt = String(updateValues?.deletion_cleanup_completed_at)
      return { data: { id: ORG_ID }, error: null }
    }
    if (table === 'organizations' && kind === 'completion') {
      return { data: { deletion_cleanup_completed_at: cleanupCompletedAt }, error: null }
    }
    if (table === 'organizations' && kind === 'anonymized') {
      return { data: { anonymized_at: organizationAnonymizedAt }, error: null }
    }
    if (table === 'organizations' && kind === 'logoReference') {
      return { data: otherLiveLogoReference ? { id: 'other-org' } : null, error: null }
    }
    if (table === 'account_deletion_storage_manifests' && kind === 'manifest') {
      return { data: logoManifestMissing ? null : { logo_url: logoManifestUrl }, error: null }
    }
    if (table === 'memberships' && kind === 'members') {
      const userId = filters.get('user_id')
      if (userId) {
        return {
          data: targetMembershipIds.includes(userId) ? { id: `membership-${userId}`, user_id: userId } : null,
          error: null,
        }
      }
      return { data: targetMembershipIds.map((user_id) => ({ user_id })), error: null }
    }
    if (table === 'memberships' && kind === 'count') {
      return { data: null, count: activeOtherMembershipCount, error: null }
    }
    return { data: null, error: null }
  }

  const query = {} as MockQuery
  query.select = (columns: string, options?: { head?: boolean }) => {
    if (kind !== 'marker') {
      if (table === 'organizations') {
        const selectedColumns = columns.split(',').map((column) => column.trim())
        kind = columns === 'id, name'
          ? 'due'
          : columns === 'slug'
            ? 'slug'
            : columns === 'id'
              ? 'logoReference'
              : selectedColumns.includes('anonymized_at')
                ? 'anonymized'
                : 'completion'
      } else if (table === 'memberships') {
        kind = options?.head ? 'count' : 'members'
      } else if (table === 'account_deletion_storage_manifests') {
        kind = 'manifest'
      }
    }
    return query
  }
  query.not = () => query
  query.lte = () => query
  query.is = () => query
  query.neq = () => query
  query.limit = () => query
  query.or = () => query
  query.match = () => query
  query.eq = (column: string, value: string) => {
    filters.set(column, value)
    return query
  }
  query.update = (values: Record<string, unknown>) => {
    kind = 'marker'
    updateValues = values
    return query
  }
  query.maybeSingle = async () => result()
  query.then = (resolve, reject) => Promise.resolve(result()).then(resolve, reject)
  return query
}

beforeEach(() => {
  cleanupCompletedAt = null
  storageListCount = 0
  activeOtherMembershipCount = 0
  logoManifestUrl = null
  logoManifestMissing = false
  otherLiveLogoReference = false
  organizationAnonymizedAt = null
  targetMembershipIds = [USER_ID]
  storageBucketForCall = ''
  storageFiles = new Map([
    ['logos', new Set<string>()],
    ['chantier-photos', new Set<string>()],
    ['quote-attachments', new Set<string>()],
    ['organization-exports', new Set<string>()],
  ])
  authUserIds = new Set([USER_ID, OTHER_USER_ID])
  mocks.verifyCronSecret.mockReturnValue(true)
  mocks.logAuditEvent.mockClear()
  mocks.logAuditEvent.mockResolvedValue(undefined)
  mocks.rpc.mockImplementation(async (name: string, args?: Record<string, unknown>) => {
    if (name === 'assert_quote_attachment_cutover_complete') return { data: null, error: null }
    if (name === 'anonymize_organization_for_deletion') {
      organizationAnonymizedAt = '2026-10-26T00:00:00.000Z'
      return { data: [{ memberships_deactivated: 1 }], error: null }
    }
    if (name === 'claim_account_deletion_identity') return { data: 'claimed', error: null }
    if (name === 'account_deletion_logo_object_key') {
      const url = String(args?.p_logo_url ?? '')
      const match = /\/logos\/([^?#]+)/.exec(url)
      return {
        data: match ? `${new URL(url).origin.toLowerCase()}|${decodeURIComponent(match[1])}` : null,
        error: null,
      }
    }
    if (name === 'claim_account_deletion_logo_object') {
      return { data: otherLiveLogoReference ? 'preserve' : 'claimed', error: null }
    }
    return { data: null, error: { message: `Unexpected RPC: ${name}` } }
  })
  mocks.storageList.mockReset()
  mocks.storageList.mockImplementation(async (folder: string) => {
    storageListCount++
    const files = [...(storageFiles.get(storageBucketForCall) ?? [])]
      .filter((path) => path.startsWith(`${folder}/`))
      .map((path) => path.slice(folder.length + 1))
    return { data: files.map((name) => ({ id: 'stored-object', name })), error: null }
  })
  mocks.storageList.mockImplementationOnce(async () => {
    storageListCount++
    return { data: null, error: { message: 'storage unavailable' } }
  })
  mocks.storageRemove.mockReset()
  mocks.storageRemove.mockImplementation(async (paths: string[]) => {
    const files = storageFiles.get(storageBucketForCall)
    for (const path of paths) files?.delete(path)
    return { error: null }
  })
  mocks.deleteUser.mockReset()
  mocks.deleteUser.mockImplementation(async (userId: string) => {
    authUserIds.delete(userId)
    return { error: null }
  })
  mocks.getUserById.mockReset()
  mocks.getUserById.mockImplementation(async (userId: string) => authUserIds.has(userId)
    ? { data: { user: { id: userId } }, error: null }
    : { data: { user: null }, error: { status: 404, code: 'user_not_found', message: 'User not found' } })
  mocks.createAdminClient.mockReturnValue({
    from: (table: string) => makeQuery(table),
    rpc: mocks.rpc,
    storage: {
      from: (bucket: string) => ({
        list: (folder: string, options?: unknown) => {
          storageBucketForCall = bucket
          return mocks.storageList(folder, options)
        },
        remove: (paths: string[]) => {
          storageBucketForCall = bucket
          return mocks.storageRemove(paths)
        },
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://supabase.local/storage/v1/object/public/${bucket}/${path}` },
        }),
      }),
    },
    auth: { admin: { deleteUser: mocks.deleteUser, getUserById: mocks.getUserById } },
  })
})

function request(): NextRequest {
  return new NextRequest('http://localhost/api/cron/account-deletion', {
    method: 'POST',
    headers: { 'x-cron-secret': 'local-test-secret' },
  })
}

describe('account deletion cleanup retry', () => {
  it('does not mark or count a failed Storage cleanup and retries it on the next run', async () => {
    const failed = await POST(request())
    expect(failed.status).toBe(200)
    expect(await failed.json()).toMatchObject({ processed: 0, errors: [{ orgId: ORG_ID }] })
    expect(cleanupCompletedAt).toBeNull()
    expect(mocks.deleteUser).not.toHaveBeenCalled()

    const retried = await POST(request())
    expect(retried.status).toBe(200)
    expect(await retried.json()).toEqual({ processed: 1, errors: [] })
    expect(cleanupCompletedAt).not.toBeNull()
    expect(storageListCount).toBe(5)
    expect(mocks.logAuditEvent).toHaveBeenCalledTimes(1)
  })
  it('purges its immutable UUID namespace without removing another organization’s file', async () => {
    const canonicalPath = `quote-requests/${ORG_ID}/proof.pdf`
    const foreignPath = 'quote-requests/22222222-2222-4222-8222-222222222222/proof.pdf'
    storageFiles.get('quote-attachments')?.add(canonicalPath)
    storageFiles.get('quote-attachments')?.add(foreignPath)
    installDurableStorageMocks()

    const response = await POST(request())

    expect(await response.json()).toEqual({ processed: 1, errors: [] })
    expect(storageFiles.get('quote-attachments')?.has(canonicalPath)).toBe(false)
    expect(storageFiles.get('quote-attachments')?.has(foreignPath)).toBe(true)
  })

  it('refuses to erase an organization while historical attachment ownership is unresolved', async () => {
    const privatePath = `quote-requests/${ORG_ID}/retained.pdf`
    storageFiles.get('quote-attachments')?.add(privatePath)
    installDurableStorageMocks()
    mocks.rpc.mockImplementation(async (name: string) => name === 'assert_quote_attachment_cutover_complete'
      ? { data: null, error: { message: 'unregistered quote attachment object' } }
      : { data: null, error: { message: `Unexpected RPC: ${name}` } })

    const response = await POST(request())

    expect(await response.json()).toMatchObject({
      processed: 0,
      errors: [{ orgId: ORG_ID, error: expect.any(String) }],
    })
    expect(organizationAnonymizedAt).toBeNull()
    expect(storageFiles.get('quote-attachments')?.has(privatePath)).toBe(true)
    expect(mocks.deleteUser).not.toHaveBeenCalled()
  })

  it('fails closed for a legacy anonymized organization without its original-logo manifest', async () => {
    logoManifestMissing = true
    mocks.storageList.mockReset()
    mocks.storageList.mockResolvedValue({ data: [], error: null })

    const response = await POST(request())

    expect(await response.json()).toMatchObject({
      processed: 0,
      errors: [{ orgId: ORG_ID, error: expect.stringContaining('Missing original logo cleanup manifest') }],
    })
    expect(cleanupCompletedAt).toBeNull()
    expect(mocks.deleteUser).not.toHaveBeenCalled()
  })

  it('keeps the completion marker unset when Auth cleanup fails, then retries safely', async () => {
    storageListCount = 0
    mocks.storageList.mockReset()
    mocks.storageList.mockImplementation(async () => {
      storageListCount++
      return { data: [], error: null }
    })
    mocks.deleteUser
      .mockResolvedValueOnce({ error: { message: 'auth unavailable', status: 503 } })
      .mockResolvedValue({ error: null })

    const failed = await POST(request())
    expect(await failed.json()).toMatchObject({ processed: 0, errors: [{ orgId: ORG_ID }] })
    expect(cleanupCompletedAt).toBeNull()

    const retried = await POST(request())
    expect(await retried.json()).toEqual({ processed: 1, errors: [] })
    expect(cleanupCompletedAt).not.toBeNull()
    expect(mocks.deleteUser).toHaveBeenCalledTimes(2)
    expect(storageListCount).toBe(8)
  })

  it('keeps a shared identity and its logo folder when another organization membership is active', async () => {
    activeOtherMembershipCount = 1
    mocks.storageList.mockReset()
    mocks.storageList.mockImplementation(async (folder: string) => {
      storageListCount++
      return { data: [], error: null }
    })

    const response = await POST(request())

    expect(await response.json()).toEqual({ processed: 1, errors: [] })
    expect(mocks.deleteUser).not.toHaveBeenCalled()
    expect(mocks.storageList).not.toHaveBeenCalledWith(USER_ID, expect.anything())
  })

  it('preserves a logo folder owned by an identity active in another organization', async () => {
    logoManifestUrl = `https://supabase.local/storage/v1/object/public/logos/${USER_ID}/logo.png`
    activeOtherMembershipCount = 1
    mocks.storageList.mockReset()
    mocks.storageList.mockImplementation(async () => {
      storageListCount++
      return { data: [], error: null }
    })

    const response = await POST(request())

    expect(await response.json()).toEqual({ processed: 1, errors: [] })
    expect(mocks.storageRemove).not.toHaveBeenCalled()
    expect(mocks.deleteUser).not.toHaveBeenCalled()
  })
  it('preserves a private uploader logo still referenced by another live organization', async () => {
    logoManifestUrl = `https://supabase.local/storage/v1/object/public/logos/${USER_ID}/logo.png`
    otherLiveLogoReference = true
    mocks.storageList.mockReset()
    mocks.storageList.mockImplementation(async (folder: string) => {
      storageListCount++
      return folder === USER_ID
        ? { data: [{ id: 'logo-object', name: 'logo.png' }], error: null }
        : { data: [], error: null }
    })

    const response = await POST(request())

    expect(await response.json()).toEqual({ processed: 1, errors: [] })
    expect(mocks.storageRemove).not.toHaveBeenCalled()
    expect(mocks.deleteUser).toHaveBeenCalledWith(USER_ID)
  })
  it('claims an original logo identity and object before purging the manifest object', async () => {
    const logoPath = `${USER_ID}/logo.png`
    logoManifestUrl = `https://supabase.local/storage/v1/object/public/logos/${logoPath}`
    storageFiles.get('logos')?.add(logoPath)
    installDurableStorageMocks()

    const response = await POST(request())

    expect(await response.json()).toEqual({ processed: 1, errors: [] })
    expect(storageFiles.get('logos')?.has(logoPath)).toBe(false)
    const identityClaimCall = mocks.rpc.mock.calls.findIndex(([name]) => name === 'claim_account_deletion_identity')
    const objectClaimCall = mocks.rpc.mock.calls.findIndex(([name]) => name === 'claim_account_deletion_logo_object')
    expect(identityClaimCall).toBeGreaterThanOrEqual(0)
    expect(objectClaimCall).toBeGreaterThan(identityClaimCall)
    expect(mocks.rpc.mock.invocationCallOrder[identityClaimCall]).toBeLessThan(
      mocks.storageRemove.mock.invocationCallOrder[0],
    )
    expect(mocks.rpc.mock.invocationCallOrder[objectClaimCall]).toBeLessThan(
      mocks.storageRemove.mock.invocationCallOrder[0],
    )
  })

  it('preserves an original logo owned by a surviving Auth identity outside the target organization', async () => {
    const logoPath = `${OTHER_USER_ID}/logo.png`
    logoManifestUrl = `https://supabase.local/storage/v1/object/public/logos/${logoPath}`
    storageFiles.get('logos')?.add(logoPath)
    installDurableStorageMocks()

    const response = await POST(request())

    expect(await response.json()).toEqual({ processed: 1, errors: [] })
    expect(storageFiles.get('logos')?.has(logoPath)).toBe(true)
    expect(authUserIds.has(OTHER_USER_ID)).toBe(true)
    expect(authUserIds.has(USER_ID)).toBe(false)
  })

  it('does not purge Storage or Auth when deletion was canceled after due-org selection', async () => {
    const photoPath = `${ORG_ID}/retention-proof.png`
    storageFiles.get('chantier-photos')?.add(photoPath)
    installDurableStorageMocks()
    mocks.rpc.mockResolvedValue({
      data: [{ memberships_deactivated: 0, profiles_anonymized: 0, clients_anonymized: 0, members_anonymized: 0 }],
      error: null,
    })

    await POST(request())

    expect(organizationAnonymizedAt).toBeNull()
    expect(cleanupCompletedAt).toBeNull()
    expect(storageFiles.get('chantier-photos')?.has(photoPath)).toBe(true)
    expect(authUserIds.has(USER_ID)).toBe(true)
  })

  it('retries a private user-folder purge before deleting that Auth identity', async () => {
    mocks.storageList.mockReset()
    mocks.storageList.mockImplementation(async (folder: string) => {
      storageListCount++
      return folder === USER_ID
        ? { data: [{ id: 'logo-object', name: 'logo.png' }], error: null }
        : { data: [], error: null }
    })
    mocks.storageRemove
      .mockReset()
      .mockResolvedValueOnce({ error: { message: 'logo removal unavailable' } })
      .mockResolvedValue({ error: null })
    mocks.deleteUser.mockImplementation(async () => {
      expect(mocks.storageRemove).toHaveBeenLastCalledWith([`${USER_ID}/logo.png`])
      return { error: null }
    })

    const failed = await POST(request())
    expect(await failed.json()).toMatchObject({ processed: 0, errors: [{ orgId: ORG_ID }] })
    expect(cleanupCompletedAt).toBeNull()
    expect(mocks.deleteUser).not.toHaveBeenCalled()

    const retried = await POST(request())
    expect(await retried.json()).toEqual({ processed: 1, errors: [] })
    expect(cleanupCompletedAt).not.toBeNull()
    expect(mocks.storageRemove).toHaveBeenCalledWith([`${USER_ID}/logo.png`])
    const identityClaimCall = mocks.rpc.mock.calls.findIndex(([name]) => name === 'claim_account_deletion_identity')
    const objectClaimCall = mocks.rpc.mock.calls.findIndex(([name]) => name === 'claim_account_deletion_logo_object')
    expect(identityClaimCall).toBeGreaterThanOrEqual(0)
    expect(objectClaimCall).toBeGreaterThan(identityClaimCall)
    expect(mocks.rpc.mock.invocationCallOrder[identityClaimCall]).toBeLessThan(
      mocks.storageRemove.mock.invocationCallOrder[0],
    )
    expect(mocks.rpc.mock.invocationCallOrder[objectClaimCall]).toBeLessThan(
      mocks.storageRemove.mock.invocationCallOrder[0],
    )
    expect(mocks.deleteUser).toHaveBeenCalledWith(USER_ID)
  })
  it('does not complete cleanup when the identity claim is unavailable', async () => {
    installDurableStorageMocks()
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'assert_quote_attachment_cutover_complete') return { data: null, error: null }
      if (name === 'anonymize_organization_for_deletion') {
        organizationAnonymizedAt = '2026-10-26T00:00:00.000Z'
        return { data: [{ memberships_deactivated: 1 }], error: null }
      }
      return { data: null, error: { message: 'claim unavailable' } }
    })

    const response = await POST(request())

    expect(await response.json()).toMatchObject({
      processed: 0,
      errors: [{ orgId: ORG_ID, error: expect.stringContaining('claim unavailable') }],
    })
    expect(cleanupCompletedAt).toBeNull()
    expect(mocks.deleteUser).not.toHaveBeenCalled()
    expect(mocks.storageList).not.toHaveBeenCalledWith(USER_ID, expect.anything())
  })

  it('claims an identity before listing or removing its private Storage prefix', async () => {
    mocks.storageList.mockReset()
    mocks.storageList.mockImplementation(async (folder: string) => {
      storageListCount++
      return folder === USER_ID
        ? { data: [{ id: 'logo-object', name: 'logo.png' }], error: null }
        : { data: [], error: null }
    })

    const response = await POST(request())

    expect(await response.json()).toEqual({ processed: 1, errors: [] })
    const claimCall = mocks.rpc.mock.calls.findIndex(([name]) => name === 'claim_account_deletion_identity')
    const firstPrivatePrefixList = mocks.storageList.mock.calls.findIndex(([folder]) => folder === USER_ID)
    expect(claimCall).toBeGreaterThanOrEqual(0)
    expect(firstPrivatePrefixList).toBeGreaterThanOrEqual(0)
    expect(mocks.rpc.mock.invocationCallOrder[claimCall]).toBeLessThan(
      mocks.storageList.mock.invocationCallOrder[firstPrivatePrefixList],
    )
    expect(mocks.deleteUser).toHaveBeenCalledWith(USER_ID)
  })


})
