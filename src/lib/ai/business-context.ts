import { createClient } from '@/lib/supabase/server'
import { getBusinessActivityById } from '@/lib/catalog-context'

export type BusinessContext = {
  activityLabel: string
  activityDescription: string
  sector: string
  orgName: string
}

export async function getBusinessContext(orgId: string): Promise<BusinessContext> {
  const supabase = await createClient()
  const { data: org } = await supabase
    .from('organizations')
    .select('name, sector, business_profile, business_activity_id')
    .eq('id', orgId)
    .single()

  const activity = getBusinessActivityById(org?.business_activity_id ?? null)
  const profile = org?.business_profile ?? null

  const defaultSector =
    profile === 'industry' ? 'Industrie / Fabrication métallique'
    : profile === 'cleaning' ? 'Propreté / Nettoyage'
    : 'BTP / Travaux'

  return {
    activityLabel: activity?.label ?? defaultSector,
    activityDescription: activity?.description ?? '',
    sector: org?.sector ?? defaultSector,
    orgName: org?.name ?? 'cette entreprise',
  }
}

export function formatBusinessContextForPrompt(ctx: BusinessContext): string {
  const lines = [
    `Métier : ${ctx.activityLabel}`,
    ctx.activityDescription ? `Spécificité : ${ctx.activityDescription}` : '',
    `Secteur : ${ctx.sector}`,
    `Entreprise : ${ctx.orgName}`,
  ]
  return lines.filter(Boolean).join('\n')
}
