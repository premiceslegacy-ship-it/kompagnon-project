import { createClient } from '@/lib/supabase/server'
import type { MaterialDimensionSchema, MaterialPriceVariant } from '@/lib/catalog-pricing'

// ─── Types ────────────────────────────────────────────────────────────────────

export type CatalogMaterial = {
  id: string
  organization_id: string
  name: string
  reference: string | null
  item_kind: 'article' | 'service'
  unit: string | null
  purchase_price: number | null
  margin_rate: number | null
  sale_price: number | null
  vat_rate: number | null
  category: string | null
  supplier: string | null
  description: string | null
  dimension_pricing_mode: 'none' | 'linear' | 'area' | 'volume'
  dimension_pricing_enabled: boolean
  base_length_m: number | null
  base_width_m: number | null
  base_height_m: number | null
  dimension_schema: MaterialDimensionSchema | null
  price_variants: MaterialPriceVariant[]
  is_active: boolean
  created_at: string
}

export type CatalogLaborRate = {
  id: string
  organization_id: string
  designation: string
  reference: string | null
  unit: string | null
  cost_rate: number | null
  margin_rate: number | null
  rate: number | null
  vat_rate: number | null
  category: string | null
  type: string | null
  description: string | null
  is_active: boolean
  created_at: string
}

export type DistanceRule = { from: number; to: number; multiplier: number }

export type PrestationItemType = 'material' | 'service' | 'labor' | 'transport' | 'free'

export type PrestationTypeItem = {
  id: string
  prestation_type_id: string
  organization_id: string
  position: number
  section_title: string
  item_type: PrestationItemType
  material_id: string | null
  labor_rate_id: string | null
  designation: string
  quantity: number
  unit: string
  unit_price_ht: number
  unit_cost_ht: number
  is_internal: boolean
  created_at: string
}

export type PrestationType = {
  id: string
  organization_id: string
  name: string
  description: string | null
  unit: string
  category: string | null
  profile_kind: 'article' | 'service' | 'mixed'
  base_price_ht: number
  base_cost_ht: number
  base_margin_pct: number | null
  distance_rules: DistanceRule[]
  vat_rate: number
  is_active: boolean
  created_at: string
  updated_at: string
  items: PrestationTypeItem[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getOrgId(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase
    .from('memberships')
    .select('organization_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single()
  return data?.organization_id ?? null
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getMaterials(): Promise<CatalogMaterial[]> {
  const supabase = await createClient()
  const orgId = await getOrgId()
  if (!orgId) return []

  const { data, error } = await supabase
    .from('materials')
    .select('*, price_variants:material_price_variants(*)')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[getMaterials]', error)
    return []
  }
  return (data ?? []).map((row: any) => ({
    ...row,
    dimension_schema: row.dimension_schema ?? null,
    price_variants: Array.isArray(row.price_variants) ? row.price_variants : [],
  })) as CatalogMaterial[]
}

export async function getLaborRates(): Promise<CatalogLaborRate[]> {
  const supabase = await createClient()
  const orgId = await getOrgId()
  if (!orgId) return []

  const { data, error } = await supabase
    .from('labor_rates')
    .select('*')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[getLaborRates]', error)
    return []
  }
  return (data ?? []) as CatalogLaborRate[]
}

export async function getPrestationTypes(includeInactive = false): Promise<PrestationType[]> {
  const supabase = await createClient()
  const orgId = await getOrgId()
  if (!orgId) return []

  let query = supabase
    .from('prestation_types')
    .select('*, items:prestation_type_items(*)')
    .eq('organization_id', orgId)
    .order('category', { ascending: true })
    .order('name', { ascending: true })

  if (!includeInactive) query = query.eq('is_active', true)

  const { data, error } = await query
  if (error) { console.error('[getPrestationTypes]', error); return [] }
  return (data ?? []) as PrestationType[]
}
