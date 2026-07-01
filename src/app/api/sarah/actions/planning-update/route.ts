import { NextRequest, NextResponse } from 'next/server'
import { updatePlanningSlot } from '@/lib/data/mutations/planning'
import { hasPermission } from '@/lib/data/queries/membership'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    if (!await hasPermission('ai.sarah')) {
      return NextResponse.json({ error: 'permission_denied', code: 'permission_denied' }, { status: 403 })
    }

    const body = await req.json()
    const { slotId, plannedDate, startTime, endTime, label, teamSize, notes, memberId, equipeId } = body

    if (!slotId) {
      return NextResponse.json({ error: 'slotId requis.' }, { status: 400 })
    }

    const patch: Record<string, unknown> = {}
    if (plannedDate !== undefined) patch.plannedDate = plannedDate
    if (startTime !== undefined) patch.startTime = startTime
    if (endTime !== undefined) patch.endTime = endTime
    if (label !== undefined) patch.label = label
    if (teamSize !== undefined) patch.teamSize = teamSize
    if (notes !== undefined) patch.notes = notes
    if (memberId !== undefined) patch.memberId = memberId
    if (equipeId !== undefined) patch.equipeId = equipeId

    const { error } = await updatePlanningSlot(slotId, patch as any)
    if (error) return NextResponse.json({ error }, { status: 400 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[sarah/planning-update]', err)
    return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 })
  }
}
