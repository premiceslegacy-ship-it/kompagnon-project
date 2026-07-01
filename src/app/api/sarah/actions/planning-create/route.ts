import { NextRequest, NextResponse } from 'next/server'
import { createPlanningSlot } from '@/lib/data/mutations/planning'
import { hasPermission } from '@/lib/data/queries/membership'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    if (!await hasPermission('ai.sarah')) {
      return NextResponse.json({ error: 'permission_denied', code: 'permission_denied' }, { status: 403 })
    }

    const body = await req.json()
    const { chantierId, plannedDate, startTime, endTime, label, teamSize, notes, memberId, equipeId } = body

    if (!chantierId || !plannedDate || !label) {
      return NextResponse.json({ error: 'chantierId, plannedDate et label sont requis.' }, { status: 400 })
    }

    const { error } = await createPlanningSlot({
      chantierId,
      plannedDate,
      startTime: startTime ?? null,
      endTime: endTime ?? null,
      label,
      teamSize: teamSize ?? 1,
      notes: notes ?? null,
      memberId: memberId ?? null,
      equipeId: equipeId ?? null,
    })

    if (error) return NextResponse.json({ error }, { status: 400 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[sarah/planning-create]', err)
    return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 })
  }
}
