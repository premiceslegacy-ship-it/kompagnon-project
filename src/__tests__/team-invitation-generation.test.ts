import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  authUsers: [] as { email?: string }[],
  invitationValues: null as Record<string, unknown> | null,
  listUsers: vi.fn(),
  generateLink: vi.fn(),
  sendEmail: vi.fn(),
  buildInviteEmail: vi.fn(),
  supabaseFrom: vi.fn(),
  adminFrom: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'inviter-1', email: 'owner@atelier.example' } } }) },
    from: state.supabaseFrom,
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    auth: { admin: { listUsers: state.listUsers, generateLink: state.generateLink } },
    from: state.adminFrom,
  }),
}))
vi.mock('@/lib/data/queries/clients', () => ({ getCurrentOrganizationId: async () => 'org-1' }))
vi.mock('@/lib/data/queries/membership', () => ({ hasPermission: async () => true, canManageLaborRates: async () => true }))
vi.mock('@/lib/data/queries/roles', () => ({ canAssignRoleToCurrentUser: async () => true }))
vi.mock('@/lib/email', () => ({ sendEmail: state.sendEmail }))
vi.mock('@/lib/email/templates', () => ({ buildInviteEmail: state.buildInviteEmail }))
vi.mock('@/lib/audit-log', () => ({ logAuditEvent: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { sendTeamInvite } from '@/lib/data/mutations/team'

function query(result: unknown, onInsert?: (values: Record<string, unknown>) => void) {
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.single = vi.fn(async () => result)
  chain.insert = vi.fn((values: Record<string, unknown>) => {
    onInsert?.(values)
    return chain
  })
  return chain
}

beforeEach(() => {
  state.authUsers = []
  state.invitationValues = null
  state.listUsers.mockReset().mockImplementation(async () => ({ data: { users: state.authUsers }, error: null }))
  state.generateLink.mockReset().mockResolvedValue({ data: { properties: { hashed_token: 'captured-token-hash' } }, error: null })
  state.sendEmail.mockReset().mockResolvedValue({ error: null })
  state.buildInviteEmail.mockReset().mockImplementation(({ inviteUrl }: { inviteUrl: string }) => ({ subject: 'Invitation', html: inviteUrl }))

  const profileQuery = query({ data: { full_name: 'Alex Martin' }, error: null })
  const invitationQuery = query({ data: { id: '4a2483d1-7364-4f58-94fb-f275d64d637d' }, error: null }, values => { state.invitationValues = values })
  const orgQuery = query({ data: { name: 'Atelier test', logo_url: null }, error: null })
  state.supabaseFrom.mockReset().mockImplementation((table: string) => table === 'profiles' ? profileQuery : invitationQuery)
  state.adminFrom.mockReset().mockImplementation(() => orgQuery)
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://atelier.example')
})

afterEach(() => vi.unstubAllEnvs())

describe('sendTeamInvite', () => {
  it('génère un lien invite pour un nouveau compte et le lie à la ligne exacte', async () => {
    const result = await sendTeamInvite('New.Member@Atelier.example', 'role-1')

    expect(result).toEqual({ error: null })
    expect(state.generateLink).toHaveBeenCalledWith({ type: 'invite', email: 'new.member@atelier.example' })
    expect(state.invitationValues).toMatchObject({
      email: 'new.member@atelier.example',
      role_id: 'role-1',
      organization_id: 'org-1',
      password_setup_required: true,
    })
    expect(state.buildInviteEmail).toHaveBeenCalledWith(expect.objectContaining({
      inviteUrl: expect.stringContaining('token_hash=captured-token-hash'),
    }))
    const inviteUrl = state.buildInviteEmail.mock.calls[0][0].inviteUrl as string
    const callback = new URL(inviteUrl)
    expect(callback.searchParams.get('type')).toBe('invite')
    const next = new URL(callback.searchParams.get('next')!, callback.origin)
    expect(next.pathname).toBe('/invite/accept')
    expect(next.searchParams.get('invitation_id')).toBe('4a2483d1-7364-4f58-94fb-f275d64d637d')
    expect(state.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'new.member@atelier.example' }))
  })

  it('génère un magiclink pour un compte existant sans demander de nouveau mot de passe', async () => {
    state.authUsers = [{ email: 'Existing.Member@Atelier.example' }]

    const result = await sendTeamInvite('existing.member@atelier.example', 'role-1')

    expect(result).toEqual({ error: null })
    expect(state.generateLink).toHaveBeenCalledWith({ type: 'magiclink', email: 'existing.member@atelier.example' })
    expect(state.invitationValues).toMatchObject({ password_setup_required: false })
    const inviteUrl = state.buildInviteEmail.mock.calls[0][0].inviteUrl as string
    expect(new URL(inviteUrl).searchParams.get('type')).toBe('magiclink')
  })
})
