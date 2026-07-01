import { NextRequest, NextResponse } from 'next/server'
import { executeSarahActionPayload } from '@/lib/sarah/actions'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const result = await executeSarahActionPayload(
      String(body.type ?? ''),
      body.payload && typeof body.payload === 'object' ? body.payload : {},
      {
        title: typeof body.title === 'string' ? body.title : typeof body.label === 'string' ? body.label : undefined,
        deepLink: typeof body.deepLink === 'string' ? body.deepLink : typeof body.deep_link === 'string' ? body.deep_link : null,
      },
    )

    return NextResponse.json(result, { status: result.ok ? 200 : 400 })
  } catch (err) {
    console.error('[sarah/actions/execute]', err)
    return NextResponse.json({ ok: false, message: 'Erreur serveur.', error: 'server_error' }, { status: 500 })
  }
}
