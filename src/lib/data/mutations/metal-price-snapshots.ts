'use server'

import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { hasPermission } from '@/lib/data/queries/membership'
import { getMetalPrices } from '@/lib/metal-prices'
import type { MetalCode } from '@/lib/metal-prices'

export type SnapshotInput = {
  quote_item_id: string
  quote_id: string
  grid_id: string
  metal_code: MetalCode
  coefficient: number
  validated_price: number
  show_on_pdf: boolean
}

/**
 * Enregistre les snapshots LME pour les lignes matière d'un devis
 * au moment de l'envoi (validation) du devis.
 * Idempotent : si un snapshot existe déjà pour une quote_item_id, on l'ignore.
 */
export async function saveMetalPriceSnapshots(
  quoteId: string,
  inputs: SnapshotInput[],
): Promise<{ error: string | null }> {
  if (inputs.length === 0) return { error: null }
  if (!(await hasPermission('quotes.send'))) return { error: 'Permission refusée.' }

  const supabase = await createClient()
  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) return { error: 'Organisation introuvable.' }

  const { data: org } = await supabase
    .from('organizations')
    .select('has_metal_pricing')
    .eq('id', organizationId)
    .single()
  if (!org?.has_metal_pricing) return { error: 'Module prix matières non activé.' }

  const { data: quote } = await supabase
    .from('quotes')
    .select('id')
    .eq('id', quoteId)
    .eq('organization_id', organizationId)
    .single()
  if (!quote) return { error: 'Devis introuvable.' }

  const gridIds = [...new Set(inputs.map(input => input.grid_id).filter(Boolean))]
  const itemIds = [...new Set(inputs.map(input => input.quote_item_id).filter(Boolean))]

  const [{ data: grids }, { data: items }] = await Promise.all([
    gridIds.length > 0
      ? supabase
          .from('metal_price_grids')
          .select('id, metal_code, source_type, coefficient, manual_price_eur_kg')
          .eq('organization_id', organizationId)
          .eq('is_active', true)
          .in('id', gridIds)
      : Promise.resolve({ data: [] }),
    itemIds.length > 0
      ? supabase
          .from('quote_items')
          .select('id, quote_id, unit_price')
          .eq('quote_id', quoteId)
          .in('id', itemIds)
      : Promise.resolve({ data: [] }),
  ])

  const gridMap = new Map((grids ?? []).map(grid => [grid.id, grid]))
  const itemMap = new Map((items ?? []).map(item => [item.id, item]))

  // Charger les cours LME uniquement si au moins une grille LME est concernée
  const hasLmeGrids = (grids ?? []).some(g => g.source_type !== 'manual')
  let priceMap: Record<string, { price_eur_kg: number; fetched_at: string }> = {}
  if (hasLmeGrids) {
    try {
      const prices = await getMetalPrices()
      priceMap = Object.fromEntries(prices.map(p => [p.metal_code, p]))
    } catch {
      // Si les cours LME sont indisponibles mais qu'il y a des grilles LME, on bloque
      return { error: 'Cours LME indisponibles — snapshot non enregistré.' }
    }
  }

  type SnapshotRow = {
    quote_item_id: string
    quote_id: string
    organization_id: string
    grid_id: string
    metal_code: MetalCode
    lme_price_eur_kg: number | null
    coefficient: number
    computed_price: number
    validated_price: number
    source: string
    price_date: string
    show_on_pdf: boolean
  }

  const rows = inputs.flatMap((input): SnapshotRow[] => {
    if (input.quote_id !== quoteId) return []
    const grid = gridMap.get(input.grid_id)
    const item = itemMap.get(input.quote_item_id)
    if (!grid || !item) return []

    const metalCode = grid.metal_code as MetalCode
    const validatedPrice = Number(item.unit_price)
    const coefficient = Number(grid.coefficient)

    if (grid.source_type === 'manual') {
      const manualPrice = Number(grid.manual_price_eur_kg)
      if (!Number.isFinite(manualPrice) || manualPrice <= 0) return []
      const computedPrice = Math.round(manualPrice * coefficient * 100) / 100
      return [{
        quote_item_id: input.quote_item_id,
        quote_id: quoteId,
        organization_id: organizationId,
        grid_id: input.grid_id,
        metal_code: metalCode,
        lme_price_eur_kg: null,
        coefficient,
        computed_price: computedPrice,
        validated_price: Number.isFinite(validatedPrice) ? validatedPrice : input.validated_price,
        source: 'manual',
        price_date: new Date().toISOString(),
        show_on_pdf: false,
      }]
    }

    // Grille LME
    const course = priceMap[metalCode]
    if (!course) return []

    const lmePriceEurKg = course.price_eur_kg
    const computedPrice = Math.round(lmePriceEurKg * coefficient * 100) / 100

    return [{
      quote_item_id: input.quote_item_id,
      quote_id: quoteId,
      organization_id: organizationId,
      grid_id: input.grid_id,
      metal_code: metalCode,
      lme_price_eur_kg: lmePriceEurKg,
      coefficient,
      computed_price: computedPrice,
      validated_price: Number.isFinite(validatedPrice) ? validatedPrice : input.validated_price,
      source: 'atelier_market_data',
      price_date: course.fetched_at,
      show_on_pdf: false,
    }]
  })

  if (rows.length === 0) return { error: null }

  const { error } = await supabase
    .from('metal_price_snapshots')
    .upsert(rows, { onConflict: 'quote_item_id' })

  if (error) return { error: error.message }
  return { error: null }
}

export async function updateSnapshotShowOnPdf(
  snapshotId: string,
  showOnPdf: boolean,
): Promise<{ error: string | null }> {
  if (showOnPdf) return { error: 'La mention cours matière sur PDF client est désactivée.' }
  if (!(await hasPermission('quotes.edit'))) return { error: 'Permission refusée.' }

  const supabase = await createClient()
  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) return { error: 'Organisation introuvable.' }

  const { error } = await supabase
    .from('metal_price_snapshots')
    .update({ show_on_pdf: showOnPdf })
    .eq('id', snapshotId)
    .eq('organization_id', organizationId)

  if (error) return { error: error.message }
  return { error: null }
}
