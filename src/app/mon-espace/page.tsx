import { redirect } from 'next/navigation'
import { verifyMemberToken } from '@/lib/data/mutations/members'
import { setMemberSessionCookie, getMemberSession } from '@/lib/auth/member-session'

export default async function MonEspaceEntryPage({
  searchParams,
}: {
  searchParams: { token?: string }
}) {
  const rawToken = searchParams.token

  // Si déjà connecté → dashboard
  const existing = await getMemberSession()
  if (existing && !rawToken) redirect('/mon-espace/dashboard')

  // Sans token → page de demande d'accès
  if (!rawToken) redirect('/mon-espace/request-access')

  // Token fourni → vérifier
  const session = await verifyMemberToken(rawToken)
  if (!session) {
    redirect('/mon-espace/request-access?error=invalid_token')
  }

  await setMemberSessionCookie(session.memberId, session.organizationId)
  redirect('/mon-espace/dashboard')
}
