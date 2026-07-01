'use server'

import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from './clients'

export type QuoteClauseTemplate = {
  id: string
  organization_id: string
  title: string
  body: string
  category: string | null
  position: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export async function getQuoteClauseTemplates(): Promise<QuoteClauseTemplate[]> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  const { data, error } = await supabase
    .from('quote_clause_templates')
    .select('*')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .order('category', { ascending: true, nullsFirst: false })
    .order('position', { ascending: true })

  if (error) { console.error('[getQuoteClauseTemplates]', error); return [] }
  return (data ?? []) as QuoteClauseTemplate[]
}
