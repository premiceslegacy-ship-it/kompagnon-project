'use server'

import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { hasPermission } from '@/lib/data/queries/membership'
import type { QuoteClauseTemplate } from '@/lib/data/queries/clause-templates'

export async function upsertQuoteClauseTemplate(
  data: Partial<QuoteClauseTemplate> & { title: string; body: string }
): Promise<QuoteClauseTemplate | null> {
  if (!(await hasPermission('settings.edit'))) return null

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return null

  const payload = {
    organization_id: orgId,
    title: data.title,
    body: data.body,
    category: data.category ?? null,
    position: data.position ?? 0,
    is_active: data.is_active ?? true,
    updated_at: new Date().toISOString(),
    ...(data.id ? { id: data.id } : {}),
  }

  const { data: row, error } = await supabase
    .from('quote_clause_templates')
    .upsert(payload)
    .select('*')
    .single()

  if (error) { console.error('[upsertQuoteClauseTemplate]', error); return null }
  return row as QuoteClauseTemplate
}

export async function deleteQuoteClauseTemplate(id: string): Promise<{ error: string | null }> {
  if (!(await hasPermission('settings.edit'))) return { error: 'Permission refusée.' }

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }

  const { error } = await supabase
    .from('quote_clause_templates')
    .delete()
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }
  return { error: null }
}
