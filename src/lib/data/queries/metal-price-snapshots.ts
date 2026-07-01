import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'

export type MetalPriceSnapshotRow = {
  id: string
  quote_item_id: string
  quote_id: string
  grid_id: string | null
  metal_code: string
  lme_price_eur_kg: number | null
  coefficient: number
  computed_price: number
  validated_price: number
  source: string
  price_date: string
  show_on_pdf: boolean
  created_at: string
  // joint
  item_description: string | null
}

export async function getMetalPriceSnapshotsForQuote(quoteId: string): Promise<MetalPriceSnapshotRow[]> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  const { data, error } = await supabase
    .from('metal_price_snapshots')
    .select(`
      id, quote_item_id, quote_id, grid_id,
      metal_code, lme_price_eur_kg, coefficient,
      computed_price, validated_price, source,
      price_date, show_on_pdf, created_at,
      quote_items!inner(description)
    `)
    .eq('quote_id', quoteId)
    .eq('organization_id', orgId)
    .order('created_at', { ascending: true })

  if (error || !data) return []

  return data.map((r) => ({
    ...r,
    item_description: ((r.quote_items as unknown) as { description: string | null } | null)?.description ?? null,
  }))
}
