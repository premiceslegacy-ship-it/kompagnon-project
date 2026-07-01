import { NextRequest, NextResponse } from 'next/server'
import { deletePlanningSlot } from '@/lib/data/mutations/planning'
import { hasPermission } from '@/lib/data/queries/membership'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    if (!await hasPermission('ai.sarah')) {
      return NextResponse.json({ error: 'permission_denied', code: 'permission_denied' }, { status: 403 })
    }

    const { slotId } = await req.json()

    if (!slotId) {
      return NextResponse.json({ error: 'slotId requis.' }, { status: 400 })
    }

    const { error } = await deletePlanningSlot(slotId)
    if (error) return NextResponse.json({ error }, { status: 400 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[sarah/planning-delete]', err)
    return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 })
  }
}
