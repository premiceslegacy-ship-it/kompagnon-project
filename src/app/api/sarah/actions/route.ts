import { NextResponse } from 'next/server'
import { listPendingSarahActions } from '@/lib/sarah/actions'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return NextResponse.json({ actions: await listPendingSarahActions() })
  } catch (err) {
    console.error('[sarah/actions]', err)
    return NextResponse.json({ actions: [] })
  }
}
