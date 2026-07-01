import { createClient } from '@/lib/supabase/server'
import { getBusinessActivityById, normalizeSecondaryActivityIds, type BusinessActivityId, type BusinessProfile } from '@/lib/catalog-context'
import { METAL_LABELS, type MetalCode } from '@/lib/metal-prices'

export type MetalPriceGridContext = {
  label: string
  metalLabel: string
  coefficient: number
  unit: string
}

export type BusinessContext = {
  businessActivityId: BusinessActivityId | null
  businessProfile: BusinessProfile
  activityLabel: string
  activityDescription: string
  secondaryActivityLabels: string[]
  sector: string
  orgName: string
  hasMetalPricing: boolean
  metalPriceGrids: MetalPriceGridContext[]
}

export async function getBusinessContext(orgId: string): Promise<BusinessContext> {
  const supabase = await createClient()

  const [{ data: org }, { data: grids }] = await Promise.all([
    supabase
      .from('organizations')
      .select('name, sector, business_profile, business_activity_id, secondary_activity_ids, has_metal_pricing')
      .eq('id', orgId)
      .single(),
    supabase
      .from('metal_price_grids')
      .select('label, metal_code, coefficient, unit')
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
  const metalPriceGrids: MetalPriceGridContext[] = (grids ?? []).map((g) => ({
    label: g.label,
    metalLabel: METAL_LABELS[g.metal_code as MetalCode] ?? g.metal_code,
    coefficient: g.coefficient,
    unit: g.unit,
  }))

  return {
    businessActivityId: activity?.id ?? null,
    businessProfile: activity?.businessProfile ?? profile ?? 'btp',
    activityLabel: activity?.label ?? defaultSector,
    activityDescription: activity?.description ?? '',
    secondaryActivityLabels,
    sector: org?.sector ?? defaultSector,
    orgName: org?.name ?? 'cette entreprise',
    hasMetalPricing,
    metalPriceGrids,
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
    lines.push('MODULE PRIX MATIÈRES MÉTAUX ACTIVÉ')
    lines.push('Règles obligatoires pour la génération de devis :')
    lines.push('- Utiliser les grilles matière comme source de prix indicative, pas comme prix fournisseur réel.')
    lines.push('- Ne jamais présenter le cours LME comme le prix d\'achat réel.')
    lines.push('- Toujours préciser que le prix reste à valider par l\'artisan selon fournisseur, format, épaisseur, coupe et livraison.')
    lines.push('- Demander validation avant d\'insérer définitivement le prix dans le devis.')
    lines.push('- Ordre de priorité des prix matière : 1. Catalogue client 2. Grille matière client 3. Ancien devis similaire 4. Cours indicatif + coefficient 5. Estimation IA.')

    if (ctx.metalPriceGrids.length > 0) {
      lines.push('')
      lines.push('Grilles matière configurées par ce client :')
      for (const g of ctx.metalPriceGrids) {
        lines.push(`  - ${g.label} : ${g.metalLabel} × ${g.coefficient.toFixed(2)} → prix en ${g.unit}`)
      }
      lines.push('Exemple de warning obligatoire : "Prix matière proposé depuis cours de référence et coefficient client. À valider selon fournisseur, format, épaisseur, coupe et livraison."')
    } else {
      lines.push('Aucune grille matière configurée. Avertir l\'artisan qu\'aucun coefficient n\'est disponible et lui demander de les configurer dans ses paramètres avant de valider le prix.')
    }
  }

  return lines.filter((l) => l !== undefined).join('\n')
}
