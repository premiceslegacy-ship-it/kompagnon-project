import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { authUserExistsByEmail, buildInvitationCallbackUrl } from '@/lib/auth/invitation-link'

const invitationId = '4a2483d1-7364-4f58-94fb-f275d64d637d'

describe('buildInvitationCallbackUrl', () => {
  it('binds the token hash to the exact invitation acceptance route without PKCE parameters', () => {
    const url = new URL(buildInvitationCallbackUrl({
      appUrl: 'https://atelier.example',
      tokenHash: 'opaque+token/value',
      verificationType: 'invite',
      invitationId,
    }))

    expect(url.origin).toBe('https://atelier.example')
    expect(url.pathname).toBe('/auth/callback')
    expect(url.searchParams.get('token_hash')).toBe('opaque+token/value')
    expect(url.searchParams.get('type')).toBe('invite')
    expect(url.searchParams.has('code')).toBe(false)
    expect(url.searchParams.has('code_verifier')).toBe(false)

    const next = new URL(url.searchParams.get('next')!, url.origin)
    expect(next.pathname).toBe('/invite/accept')
    expect(next.searchParams.get('invitation_id')).toBe(invitationId)
  })

  it('preserves the existing-user magiclink verification type', () => {
    const url = new URL(buildInvitationCallbackUrl({
      appUrl: 'https://atelier.example',
      tokenHash: 'token-hash',
      verificationType: 'magiclink',
      invitationId,
    }))
    expect(url.searchParams.get('type')).toBe('magiclink')
  })

  it('rejects an application URL with embedded credentials', () => {
    expect(() => buildInvitationCallbackUrl({
      appUrl: 'https://user:password@atelier.example',
      tokenHash: 'token-hash',
      verificationType: 'invite',
      invitationId,
    })).toThrow('URL publique de l’application invalide.')
  })
})

describe('authUserExistsByEmail', () => {
  it('normalizes email and searches beyond the first 1,000 auth users', async () => {
    const firstPage = Array.from({ length: 1000 }, (_, index) => ({ email: `user-${index}@atelier.example` }))
    const listUsers = vi.fn(async ({ page }: { page: number }) => ({
      data: { users: page === 1 ? firstPage : [{ email: 'Existing@Atelier.example' }] },
      error: null,
    }))
    const admin = { auth: { admin: { listUsers } } } as unknown as SupabaseClient

    await expect(authUserExistsByEmail(admin, ' existing@atelier.example ')).resolves.toBe(true)
    expect(listUsers).toHaveBeenCalledTimes(2)
  })

  it('fails closed when the auth-user inventory cannot be read', async () => {
    const listUsers = vi.fn(async () => ({ data: { users: [] }, error: { message: 'service unavailable' } }))
    const admin = { auth: { admin: { listUsers } } } as unknown as SupabaseClient

    await expect(authUserExistsByEmail(admin, 'member@atelier.example'))
      .rejects.toThrow('Impossible de vérifier le compte invité: service unavailable')
  })
})
