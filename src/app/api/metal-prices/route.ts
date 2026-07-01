import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMetalPriceLogMessage, getMetalPricePublicMessage, getMetalPrices } from '@/lib/metal-prices'

export const dynamic = 'force-dynamic'

// GET /api/metal-prices
// Retourne les cours en cache pour l'organisation courante.
// Requiert has_metal_pricing = true sur l'organisation.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const { data: membership } = await supabase
    .from('memberships')
    .select('organization_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single()

  if (!membership) return NextResponse.json({ error: 'Organisation introuvable' }, { status: 403 })

  const { data: org } = await supabase
    .from('organizations')
    .select('has_metal_pricing')
    .eq('id', membership.organization_id)
    .single()

  if (!org?.has_metal_pricing) {
    return NextResponse.json({ error: 'Module prix matières non activé' }, { status: 403 })
  }

  try {
    const prices = await getMetalPrices()
    return NextResponse.json({ prices })
  } catch (err) {
    console.error('[api/metal-prices] Erreur:', getMetalPriceLogMessage(err))
    return NextResponse.json(
      { error: getMetalPricePublicMessage(err) },
      { status: 503 }
    )
  }
}
