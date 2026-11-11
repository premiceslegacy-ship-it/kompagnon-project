import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ from: vi.fn(), getUserPermissions: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from: mocks.from }) }))
vi.mock('@/lib/data/queries/membership', () => ({ getUserPermissions: mocks.getUserPermissions }))

import { canAssignRoleToCurrentUser } from '@/lib/data/queries/roles'

describe('canAssignRoleToCurrentUser', () => {
  let role: { id: string; slug: string; is_active: boolean } | null
  let allowedPermissionKeys: string[]
  let roleQuery: {
    select: ReturnType<typeof vi.fn>
    eq: ReturnType<typeof vi.fn>
    maybeSingle: ReturnType<typeof vi.fn>
  }
  let permissionQuery: {
    select: ReturnType<typeof vi.fn>
    eq: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    mocks.from.mockReset()
    mocks.getUserPermissions.mockReset().mockResolvedValue(new Set(['team.invite', 'team.edit_roles']))
    role = { id: 'role-1', slug: 'manager', is_active: true }
    allowedPermissionKeys = ['team.invite']

    roleQuery = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() }
    roleQuery.select.mockReturnValue(roleQuery)
    roleQuery.eq.mockReturnValue(roleQuery)
    roleQuery.maybeSingle.mockImplementation(async () => ({ data: role, error: null }))

    permissionQuery = { select: vi.fn(), eq: vi.fn() }
    permissionQuery.select.mockReturnValue(permissionQuery)
    permissionQuery.eq.mockReturnValue(permissionQuery)
    Object.defineProperty(permissionQuery, 'then', {
      value: (resolve: (value: { data: { permission_key: string }[]; error: null }) => unknown) =>
        Promise.resolve({ data: allowedPermissionKeys.map(permission_key => ({ permission_key })), error: null }).then(resolve),
    })

    mocks.from.mockImplementation((table: string) => table === 'roles' ? roleQuery : permissionQuery)
  })

  it('allows an active same-organization role whose permissions are a subset', async () => {
    await expect(canAssignRoleToCurrentUser('org-1', 'role-1')).resolves.toBe(true)
  })

  it('refuses a role that adds permissions the caller does not hold', async () => {
    allowedPermissionKeys = ['team.invite', 'chantiers.manage_team']
    await expect(canAssignRoleToCurrentUser('org-1', 'role-1')).resolves.toBe(false)
  })
  it('fails closed when the caller has no active role permissions', async () => {
    allowedPermissionKeys = []
    mocks.getUserPermissions.mockResolvedValue(new Set())
    await expect(canAssignRoleToCurrentUser('org-1', 'role-1')).resolves.toBe(false)
  })


  it.each([
    { slug: 'owner', is_active: true },
    { slug: 'manager', is_active: false },
  ])('refuses owner and inactive roles even for an owner caller: %j', async invalidRole => {
    role = { id: 'role-1', ...invalidRole }
    mocks.getUserPermissions.mockResolvedValue(new Set(['*']))
    await expect(canAssignRoleToCurrentUser('org-1', 'role-1')).resolves.toBe(false)
  })

  it('fails closed when the selected role is outside the organization', async () => {
    role = null
    await expect(canAssignRoleToCurrentUser('org-1', 'foreign-role')).resolves.toBe(false)
  })
})
