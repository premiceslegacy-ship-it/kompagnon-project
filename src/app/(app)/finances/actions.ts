'use server'

import { getSituationsSummary } from '@/lib/data/queries/invoices'
import { hasPermission } from '@/lib/data/queries/membership'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { createClient } from '@/lib/supabase/server'

export async function loadSituationsSummary(quoteId: string) {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()

  const [summary, canCreateSituation, canCreateSolde] = await Promise.all([
    getSituationsSummary(quoteId),
    hasPermission('invoices.create_situation'),
    hasPermission('invoices.create_solde'),
  ])

  // Chercher le chantier lié à ce devis
  let chantierId: string | null = null
  if (orgId) {
    const { data } = await supabase
      .from('chantiers')
      .select('id')
      .eq('quote_id', quoteId)
      .eq('organization_id', orgId)
      .maybeSingle()
    chantierId = data?.id ?? null
  }

  return { summary, canCreateSituation, canCreateSolde, chantierId }
}
