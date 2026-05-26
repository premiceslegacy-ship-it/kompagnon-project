import { NextResponse } from 'next/server'
import { EMPTY_NOTIFICATIONS, getNotificationsSummary } from '@/lib/data/queries/notifications'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return NextResponse.json(await getNotificationsSummary())
  } catch (error) {
    console.error('[api/notifications]', error)
    return NextResponse.json(EMPTY_NOTIFICATIONS)
  }
}
