'use server'

import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { hasPermission } from '@/lib/data/queries/membership'
import type { PlanMeasurementResult } from '@/lib/plan-measurement'

export async function savePlanMeasurementDraft(measurement: PlanMeasurementResult): Promise<{ error: string | null }> {
  if (!measurement.id) return { error: null }
  if (!(await hasPermission('quotes.edit'))) return { error: 'Permission refusée.' }
  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) return { error: 'Non authentifié.' }
  const supabase = await createClient()
  const { error } = await supabase.from('plan_measurements').update({
    title: measurement.title,
    selected_trades: measurement.scope.selectedTrades,
    work_scopes: measurement.scope.workScopes,
    settings: measurement.settings,
    result: measurement,
  }).eq('id', measurement.id).eq('organization_id', organizationId)
  return { error: error?.message ?? null }
}

export async function markPlanMeasurementConverted(measurementId: string, quoteId: string): Promise<{ error: string | null }> {
  if (!(await hasPermission('quotes.edit'))) return { error: 'Permission refusée.' }
  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) return { error: 'Non authentifié.' }
  const supabase = await createClient()
  const { error } = await supabase.from('plan_measurements').update({
    status: 'converted',
    quote_id: quoteId,
  }).eq('id', measurementId).eq('organization_id', organizationId)
  return { error: error?.message ?? null }
}
