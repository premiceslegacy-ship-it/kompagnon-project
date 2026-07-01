import { NextRequest, NextResponse } from 'next/server'
import { getCurrentMembershipContext, hasPermission } from '@/lib/data/queries/membership'
import { proposeSarahAction } from '@/lib/sarah/actions'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    if (!await hasPermission('ai.sarah')) {
      return NextResponse.json({ error: 'permission_denied', code: 'permission_denied' }, { status: 403 })
    }

    const membership = await getCurrentMembershipContext()
    if (!membership) {
      return NextResponse.json({ error: 'unauthenticated', code: 'unauthenticated' }, { status: 401 })
    }

    const body = await req.json()
    const action = await proposeSarahAction({
      organizationId: membership.organizationId,
      userId: body.userId === null ? null : membership.userId,
      type: String(body.type ?? ''),
      risk: body.risk,
      title: String(body.title ?? body.label ?? 'Action Sarah'),
      description: String(body.description ?? ''),
      payload: body.payload ?? {},
      deepLink: body.deepLink ?? body.deep_link ?? null,
      dedupeKey: body.dedupeKey ?? body.dedupe_key ?? null,
      expiresAt: body.expiresAt ?? body.expires_at ?? null,
    })

    if (!action) return NextResponse.json({ error: 'create_failed' }, { status: 500 })
    return NextResponse.json({ action })
  } catch (err) {
    console.error('[sarah/actions/propose]', err)
    return NextResponse.json({ error: 'server_error', code: 'server_error' }, { status: 500 })
  }
}
