import { createClient } from '@/lib/supabase/server'
import { getBusinessActivityById, normalizeSecondaryActivityIds, type BusinessActivityId, type BusinessProfile } from '@/lib/catalog-context'
import { formatManualPriceGridContext, selectManualPriceGridsForAI, type ManualPriceGridContext, type ManualPriceGridRow } from '@/lib/ai/manual-pricing'
import { getVerticalPackDefinition, type VerticalPackId } from '@/lib/vertical-packs'

export type BusinessContext = {
  businessActivityId: BusinessActivityId | null
  businessProfile: BusinessProfile
  activityLabel: string
  activityDescription: string
  secondaryActivityLabels: string[]
  sector: string
  orgName: string
  hasMetalPricing: boolean
  manualPriceGrids: ManualPriceGridContext[]
  verticalPackId: VerticalPackId | null
  verticalPackLabel: string | null
}

export async function getBusinessContext(orgId: string): Promise<BusinessContext> {
  const supabase = await createClient()

  const [{ data: org }, { data: grids }] = await Promise.all([
    supabase
      .from('organizations')
      .select('name, sector, business_profile, business_activity_id, secondary_activity_ids, has_metal_pricing, business_vertical_pack')
      .eq('id', orgId)
      .single(),
    supabase
      .from('metal_price_grids')
      .select('id, organization_id, label, metal_code, source_type, manual_price_eur_kg, unit, catalog_item_id, supplier_id, grade, thickness_mm, format_label, is_active')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .order('position', { ascending: true }),
  ])

  const activity = getBusinessActivityById(org?.business_activity_id ?? null)
  const profile = org?.business_profile ?? null

  const defaultSector =
    profile === 'industry' ? 'Industrie / Fabrication métallique'
    : profile === 'cleaning' ? 'Propreté / Nettoyage'
    : 'BTP / Travaux'

  const secondaryIds = normalizeSecondaryActivityIds(org?.secondary_activity_ids, org?.business_activity_id)
  const secondaryActivityLabels = secondaryIds
    .map((id) => getBusinessActivityById(id)?.label)
    .filter((label): label is string => Boolean(label))

  const hasMetalPricing = org?.has_metal_pricing ?? false
  const manualGridRows = ((grids ?? []) as ManualPriceGridRow[]).filter(row =>
    row.organization_id === orgId && row.source_type === 'manual',
  )
  const materialIds = [...new Set(manualGridRows.map(grid => grid.catalog_item_id).filter((id): id is string => Boolean(id)))]
  const supplierIds = [...new Set(manualGridRows.map(grid => grid.supplier_id).filter((id): id is string => Boolean(id)))]
  const [{ data: linkedMaterials }, { data: linkedSuppliers }] = hasMetalPricing
    ? await Promise.all([
        materialIds.length > 0
          ? supabase.from('materials').select('id, name').eq('organization_id', orgId).in('id', materialIds)
          : Promise.resolve({ data: [] }),
        supplierIds.length > 0
          ? supabase.from('suppliers').select('id, name').eq('organization_id', orgId).in('id', supplierIds)
          : Promise.resolve({ data: [] }),
      ])
    : [{ data: [] }, { data: [] }]
  const manualPriceGrids = selectManualPriceGridsForAI(
    manualGridRows,
    orgId,
    hasMetalPricing,
    linkedMaterials ?? [],
    linkedSuppliers ?? [],
  )

  const verticalPack = getVerticalPackDefinition(org?.business_vertical_pack ?? null)

  return {
    businessActivityId: activity?.id ?? null,
    businessProfile: activity?.businessProfile ?? profile ?? 'btp',
    activityLabel: activity?.label ?? defaultSector,
    activityDescription: activity?.description ?? '',
    secondaryActivityLabels,
    sector: org?.sector ?? defaultSector,
    orgName: org?.name ?? 'cette entreprise',
    hasMetalPricing,
    manualPriceGrids,
    verticalPackId: verticalPack?.id ?? null,
    verticalPackLabel: verticalPack?.label ?? null,
  }
}

export function formatBusinessContextForPrompt(ctx: BusinessContext): string {
  const lines = [
    `Métier principal : ${ctx.activityLabel}`,
    ctx.activityDescription ? `Spécificité : ${ctx.activityDescription}` : '',
    ctx.secondaryActivityLabels.length > 0
      ? `Activités secondaires : ${ctx.secondaryActivityLabels.join(', ')}`
      : '',
    `Secteur : ${ctx.sector}`,
    `Entreprise : ${ctx.orgName}`,
  ]

  if (ctx.hasMetalPricing) {
    lines.push('')
    lines.push('MODULE PRIX MATIÈRES MANUELS ACTIVÉ')
    lines.push('Règles obligatoires pour la génération de devis :')
    lines.push('- Les grilles contiennent des prix saisis par l’entreprise, en euros par unité exacte indiquée ; ce ne sont pas des cours de marché ni des coefficients.')
    lines.push('- Utiliser les prix et variantes catalogue exacts en premier choix ; ne jamais les remplacer par un montant estimé.')
    lines.push('- N’utiliser une grille manuelle que si la matière, le fournisseur, la nuance, le format, l’épaisseur et l’unité correspondent sans ambiguïté.')
    lines.push('- Ne jamais convertir l’unité ou substituer un fournisseur, une nuance, une épaisseur ou un format.')
    lines.push('- Si le prix d’un métal n’est pas connu exactement, demander une précision au lieu d’inventer un prix ou d’insérer zéro.')
    lines.push(...formatManualPriceGridContext(ctx.manualPriceGrids))
  }

  if (ctx.verticalPackId) {
    const pack = getVerticalPackDefinition(ctx.verticalPackId)
    if (pack) {
      lines.push('')
      lines.push(pack.aiPromptGuidance)
    }
  }

  return lines.filter((l) => l !== undefined).join('\n')
}
