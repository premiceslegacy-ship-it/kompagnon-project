import type { SupabaseClient } from '@supabase/supabase-js'

export type InvitationVerificationType = 'invite' | 'magiclink'

/** Find an auth account by normalized email across the paginated admin user list. */
export async function authUserExistsByEmail(admin: SupabaseClient, email: string): Promise<boolean> {
  const normalizedEmail = email.trim().toLowerCase()
  const perPage = 1000

  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) throw new Error(`Impossible de vérifier le compte invité: ${error.message}`)

    const users = data.users ?? []
    if (users.some(user => user.email?.trim().toLowerCase() === normalizedEmail)) return true
    if (users.length < perPage) return false
  }
}

/** Build a Supabase verifyOtp callback that does not depend on a browser PKCE verifier. */
export function buildInvitationCallbackUrl(input: {
  appUrl?: string
  tokenHash: string
  verificationType: InvitationVerificationType
  invitationId: string
}): string {
  const appUrl = input.appUrl ?? process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl || !input.tokenHash || !input.invitationId) {
    throw new Error('Lien d’invitation incomplet.')
  }

  const base = new URL(appUrl)
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) {
    throw new Error('URL publique de l’application invalide.')
  }

  const callback = new URL('/auth/callback', base.origin)
  const accept = new URL('/invite/accept', base.origin)
  accept.searchParams.set('invitation_id', input.invitationId)

  callback.searchParams.set('token_hash', input.tokenHash)
  callback.searchParams.set('type', input.verificationType)
  callback.searchParams.set('next', `${accept.pathname}${accept.search}`)
  return callback.toString()
}
