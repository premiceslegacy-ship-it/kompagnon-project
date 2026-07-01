import { NextRequest, NextResponse } from 'next/server'
import { verifyCronSecret } from '@/lib/cron-auth'
import { getMetalPriceLogMessage, getMetalPricePublicMessage, refreshMetalPrices } from '@/lib/metal-prices'

export const dynamic = 'force-dynamic'

// Appelé toutes les 10 min par le scheduler Cloudflare / Vercel Cron.
export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get('x-cron-secret'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const prices = await refreshMetalPrices()
    return NextResponse.json({ ok: true, refreshed: prices.length, prices })
  } catch (err) {
    console.error('[cron/metal-prices] Erreur refresh:', getMetalPriceLogMessage(err))
    return NextResponse.json(
      { error: getMetalPricePublicMessage(err) },
      { status: 500 }
    )
  }
}
