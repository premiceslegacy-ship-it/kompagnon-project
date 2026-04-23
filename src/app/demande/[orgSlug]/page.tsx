import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCatalogContext, type ResolvedCatalogContext } from '@/lib/catalog-context'
import type { MaterialDimensionSchema, MaterialPriceVariant } from '@/lib/catalog-pricing'
import PublicFormClient from './PublicFormClient'

export type PublicMaterial = {
  id: string
  name: string
  unit: string | null
  category: string | null
  item_kind: 'article' | 'service'
  dimension_pricing_mode: 'none' | 'linear' | 'area' | 'volume'
  dimension_pricing_enabled: boolean
  base_length_m: number | null
  base_width_m: number | null
  base_height_m: number | null
  dimension_schema: MaterialDimensionSchema | null
  price_variants: MaterialPriceVariant[]
}

export type PublicPrestationLine = {
  id: string
  item_type: 'material' | 'service' | 'labor' | 'transport' | 'free'
  material_id: string | null
  labor_rate_id: string | null
  designation: string
  quantity: number
  unit: string
  unit_price_ht: number
  dimension_pricing_mode: 'none' | 'linear' | 'area' | 'volume'
  dimension_pricing_enabled: boolean
  base_length_m: number | null
  base_width_m: number | null
  base_height_m: number | null
  dimension_schema: MaterialDimensionSchema | null
  price_variants: MaterialPriceVariant[]
}

export type PublicPrestationType = {
  id: string
  name: string
  description: string | null
  unit: string
  category: string | null
  lines: PublicPrestationLine[]
}

type OrgPublicData = {
  id: string
  name: string
  slug: string
  logo_url: string | null
  sector: string | null
  business_profile: string | null
  business_activity_id: string | null
  label_set: unknown
  unit_set: unknown
  default_categories: unknown
  starter_presets: unknown
  public_form_enabled: boolean
  public_form_welcome_message: string | null
  public_form_catalog_item_ids: Array<{ id: string; item_type: string }> | null
  public_form_custom_mode_enabled: boolean
}

async function getOrgPublicData(slug: string): Promise<{
  org: OrgPublicData
  catalogContext: ResolvedCatalogContext
  materials: PublicMaterial[]
  prestationTypes: PublicPrestationType[]
} | null> {
  const admin = createAdminClient()

  const { data: org, error } = await admin
    .from('organizations')
    .select('id, name, slug, logo_url, sector, business_profile, business_activity_id, label_set, unit_set, default_categories, starter_presets, public_form_enabled, public_form_welcome_message, public_form_catalog_item_ids, public_form_custom_mode_enabled')
    .eq('slug', slug)
    .single()

  if (error || !org) return null

  const publicIds: Array<{ id: string; item_type: string }> = org.public_form_catalog_item_ids ?? []

  const materialIds = publicIds.filter(x => x.item_type === 'material').map(x => x.id)
  const prestationIds = publicIds.filter(x => x.item_type === 'prestation').map(x => x.id)

  // Matériaux avec catégorie
  const materialsRes = materialIds.length > 0
    ? await admin
        .from('materials')
        .select('id, name, unit, category, item_kind, dimension_pricing_mode, dimension_pricing_enabled, base_length_m, base_width_m, base_height_m, dimension_schema, price_variants:material_price_variants(*)')
        .in('id', materialIds)
        .eq('is_active', true)
    : { data: [] as Array<PublicMaterial> }

  const materialsRaw = (materialsRes.data ?? []) as PublicMaterial[]
  // Maintenir l'ordre défini par l'artisan
  const materials: PublicMaterial[] = materialIds
    .map(id => {
      const material = materialsRaw.find(m => m.id === id)
      return material ? { ...material, dimension_schema: material.dimension_schema ?? null, price_variants: material.price_variants ?? [] } : null
    })
    .filter((m): m is PublicMaterial => m != null)

  // Prestations types avec leurs lignes non-internes
  let prestationTypes: PublicPrestationType[] = []
  if (prestationIds.length > 0) {
    const { data: ptData } = await admin
      .from('prestation_types')
      .select(`
        id, name, description, unit, category,
        items:prestation_type_items(
          id, item_type, material_id, labor_rate_id, designation, quantity, unit, unit_price_ht, is_internal, position,
          material:materials(dimension_pricing_mode, dimension_pricing_enabled, base_length_m, base_width_m, base_height_m, dimension_schema, price_variants:material_price_variants(*))
        )
      `)
      .in('id', prestationIds)
      .eq('is_active', true)

    if (ptData) {
      type RawPT = {
        id: string; name: string; description: string | null; unit: string; category: string | null
        items: Array<{
          id: string
          item_type: 'material' | 'service' | 'labor' | 'transport' | 'free'
          material_id: string | null
          labor_rate_id: string | null
          designation: string
          quantity: number
          unit: string
          unit_price_ht: number
          is_internal: boolean
          position: number
          material?: {
            dimension_pricing_mode: 'none' | 'linear' | 'area' | 'volume'
            dimension_pricing_enabled: boolean
            base_length_m: number | null
            base_width_m: number | null
            base_height_m: number | null
            dimension_schema: MaterialDimensionSchema | null
            price_variants: MaterialPriceVariant[] | null
          }[] | null
        }>
      }
      prestationTypes = prestationIds
        .map((id): PublicPrestationType | null => {
          const pt = (ptData as RawPT[]).find(p => p.id === id)
          if (!pt) return null
          return {
            id: pt.id,
            name: pt.name,
            description: pt.description,
            unit: pt.unit,
            category: pt.category,
            lines: pt.items
              .filter(i => !i.is_internal)
              .sort((a, b) => a.position - b.position)
              .map(i => ({
                id: i.id,
                item_type: i.item_type,
                material_id: i.material_id,
                labor_rate_id: i.labor_rate_id,
                designation: i.designation,
                quantity: i.quantity,
                unit: i.unit,
                unit_price_ht: i.unit_price_ht,
                dimension_pricing_mode: (Array.isArray(i.material) ? i.material[0] : i.material)?.dimension_pricing_mode ?? 'none',
                dimension_pricing_enabled: Boolean((Array.isArray(i.material) ? i.material[0] : i.material)?.dimension_pricing_enabled),
                base_length_m: (Array.isArray(i.material) ? i.material[0] : i.material)?.base_length_m ?? null,
                base_width_m: (Array.isArray(i.material) ? i.material[0] : i.material)?.base_width_m ?? null,
                base_height_m: (Array.isArray(i.material) ? i.material[0] : i.material)?.base_height_m ?? null,
                dimension_schema: (Array.isArray(i.material) ? i.material[0] : i.material)?.dimension_schema ?? null,
                price_variants: (Array.isArray(i.material) ? i.material[0] : i.material)?.price_variants ?? [],
              })),
          }
        })
        .filter((p): p is PublicPrestationType => p !== null)
    }
  }

  if (publicIds.length > 0 && materials.length === 0 && prestationTypes.length === 0) {
    console.warn('[DemandePage] IDs configurés mais aucun item retourné. Vérifier is_active dans le catalogue.', { publicIds })
  }

  return {
    org: org as OrgPublicData,
    catalogContext: resolveCatalogContext(org),
    materials,
    prestationTypes,
  }
}

export default async function DemandePage({ params }: { params: { orgSlug: string } }) {
  const result = await getOrgPublicData(params.orgSlug)
  if (!result) notFound()

  const { org, catalogContext, materials, prestationTypes } = result

  if (!org.public_form_enabled) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-8">
        <div className="max-w-md text-center space-y-4">
          {org.logo_url && (
            <img src={org.logo_url} alt={org.name} className="h-16 mx-auto object-contain" />
          )}
          <h1 className="text-2xl font-bold text-gray-900">{org.name}</h1>
          <p className="text-gray-500">Le formulaire de demande de devis est temporairement désactivé.</p>
        </div>
      </div>
    )
  }

  return (
    <PublicFormClient
      orgSlug={org.slug}
      orgName={org.name}
      logoUrl={org.logo_url}
      welcomeMessage={org.public_form_welcome_message}
      materials={materials}
      prestationTypes={prestationTypes}
      customModeEnabled={org.public_form_custom_mode_enabled}
      catalogContext={catalogContext}
    />
  )
}
