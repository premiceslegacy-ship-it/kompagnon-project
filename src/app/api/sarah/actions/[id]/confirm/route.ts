import { NextRequest, NextResponse } from 'next/server'
import { confirmSarahAction } from '@/lib/sarah/actions'

export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params
    const result = await confirmSarahAction(id)
    return NextResponse.json(result, { status: result.ok ? 200 : 400 })
  } catch (err) {
    console.error('[sarah/actions/confirm]', err)
    return NextResponse.json({ ok: false, message: 'Erreur serveur.', error: 'server_error' }, { status: 500 })
  }
}
