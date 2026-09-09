import type { DimensionPricingMode } from '@/lib/catalog-pricing'
import type { PublicLaborRate, PublicMaterial, PublicPrestationLine, PublicPrestationType } from '../page'

export type SelectedMaterial = {
  id: string
  name: string
  item_kind: 'article' | 'service'
  unit: string | null
  quantity: number
  base_length_m: number | null
  base_width_m: number | null
  base_height_m: number | null
  length_m?: number | null
  width_m?: number | null
  height_m?: number | null
  dimension_count?: number
  dimension_pricing_mode: DimensionPricingMode
  dimension_pricing_enabled?: boolean
  dimension_schema?: PublicMaterial['dimension_schema']
  price_variants?: PublicMaterial['price_variants']
  details?: string
}

export type PrestationLine = {
  id: string
  item_type: 'material' | 'service' | 'labor' | 'transport' | 'free'
  material_id: string | null
  labor_rate_id: string | null
  designation: string
  quantity: number
  unit: string
  unit_price_ht: number
  dimension_pricing_mode: DimensionPricingMode
  dimension_pricing_enabled: boolean
  base_length_m: number | null
  base_width_m: number | null
  base_height_m: number | null
  length_m?: number | null
  width_m?: number | null
  height_m?: number | null
  dimension_count?: number
  isCustom: boolean
  dimension_schema?: PublicPrestationLine['dimension_schema']
  price_variants?: PublicPrestationLine['price_variants']
  details?: string
}

export type SelectedPrestation = {
  id: string
  name: string
  category: string | null
  lines: PrestationLine[]
}

export type SelectedLaborRate = {
  id: string
  designation: string
  unit: string | null
  quantity: number
  details?: string
}

export type AttachmentMeta = {
  storage_path: string
  filename: string
  size: number
  content_type: string | null
  public_url: string
}

export type { PublicLaborRate, PublicMaterial, PublicPrestationLine, PublicPrestationType }
