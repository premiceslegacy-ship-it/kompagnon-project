import { NextRequest, NextResponse } from 'next/server'
import { dismissSarahAction } from '@/lib/sarah/actions'

export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params
    return NextResponse.json(await dismissSarahAction(id))
  } catch (err) {
    console.error('[sarah/actions/dismiss]', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
