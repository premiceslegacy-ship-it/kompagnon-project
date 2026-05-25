import { NextRequest, NextResponse } from 'next/server'
import { verifyMemberToken } from '@/lib/data/mutations/members'
import { setMemberSessionCookie } from '@/lib/auth/member-session'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')

  if (!token) {
    return NextResponse.redirect(new URL('/mon-espace/request-access', req.url))
  }

  const session = await verifyMemberToken(token)
  if (!session) {
    return NextResponse.redirect(new URL('/mon-espace/request-access?error=invalid_token', req.url))
  }

  await setMemberSessionCookie(session.memberId, session.organizationId)
  return NextResponse.redirect(new URL('/mon-espace/dashboard', req.url))
}
