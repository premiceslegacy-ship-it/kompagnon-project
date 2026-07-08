import { NextRequest, NextResponse } from 'next/server'
import { verifyMemberToken, sendMemberSpaceInviteUnchecked } from '@/lib/data/mutations/members'
import { setMemberSessionCookie } from '@/lib/auth/member-session'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')

  if (!token) {
    return NextResponse.redirect(new URL('/mon-espace/request-access', req.url))
  }

  const result = await verifyMemberToken(token)

  if (result.status === 'not_found') {
    return NextResponse.redirect(new URL('/mon-espace/request-access?error=invalid_token', req.url))
  }

  if (result.status === 'expired') {
    // Auto-renvoi transparent : on connaît déjà le memberId, pas besoin de refaire saisir l'email.
    await sendMemberSpaceInviteUnchecked(result.memberId).catch(() => {})
    return NextResponse.redirect(new URL('/mon-espace/request-access?error=expired_renewed', req.url))
  }

  await setMemberSessionCookie(result.memberId, result.organizationId)
  return NextResponse.redirect(new URL('/mon-espace/dashboard', req.url))
}
