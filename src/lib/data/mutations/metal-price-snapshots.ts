'use server'

import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { hasPermission } from '@/lib/data/queries/membership'
import type { MetalCode } from '@/lib/metal-prices'

export type SnapshotInput = {
  quote_item_id: string
  quote_id: string
  grid_id: string
}

/**
 * Enregistre les prix matières manuels pour les lignes d'un devis
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


  if (inputs.some(input => input.quote_id !== quoteId)) return { error: 'Ligne de devis invalide.' }
  const { data: existing, error: existingError } = await supabase
    .from('metal_price_snapshots')
    .select('quote_item_id')
    .eq('quote_id', quoteId)
    .eq('organization_id', organizationId)
    .in('quote_item_id', inputs.map(input => input.quote_item_id))
  if (existingError) return { error: existingError.message }
  const existingItemIds = new Set((existing ?? []).map(row => row.quote_item_id))
  const pendingInputs = inputs.filter(input => !existingItemIds.has(input.quote_item_id))
  if (pendingInputs.length === 0) return { error: null }
  const gridIds = [...new Set(pendingInputs.map(input => input.grid_id).filter(Boolean))]
  const itemIds = [...new Set(pendingInputs.map(input => input.quote_item_id).filter(Boolean))]

  const [{ data: grids }, { data: items }] = await Promise.all([
    gridIds.length > 0
      ? supabase
          .from('metal_price_grids')
          .select('id, metal_code, source_type, manual_price_eur_kg')
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

  const rows: SnapshotRow[] = []
  const priceDate = new Date().toISOString()
  for (const input of pendingInputs) {
    const grid = gridMap.get(input.grid_id)
    const item = itemMap.get(input.quote_item_id)
    if (!grid || !item) return { error: 'Grille ou ligne de devis introuvable.' }
    if (grid.source_type !== 'manual') {
      return { error: 'Les cours automatiques sont désactivés. Renseignez un prix manuel pour cette grille.' }
    }
    const manualPrice = Number(grid.manual_price_eur_kg)
    const validatedPrice = Number(item.unit_price)
    if (!Number.isFinite(manualPrice) || manualPrice <= 0 || !Number.isFinite(validatedPrice) || validatedPrice < 0) {
      return { error: 'Prix matière invalide. Vérifiez la grille et la ligne de devis.' }
    }
    rows.push({
      quote_item_id: input.quote_item_id,
      quote_id: quoteId,
      organization_id: organizationId,
      grid_id: input.grid_id,
      metal_code: grid.metal_code as MetalCode,
      lme_price_eur_kg: null,
      coefficient: 1,
      computed_price: Math.round((manualPrice + Number.EPSILON) * 100) / 100,
      validated_price: validatedPrice,
      source: 'manual',
      price_date: priceDate,
      show_on_pdf: false,
    })
  }


  const { error } = await supabase
    .from('metal_price_snapshots')
    .upsert(rows, { onConflict: 'quote_item_id', ignoreDuplicates: true })

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
