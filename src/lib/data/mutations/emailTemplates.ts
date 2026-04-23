'use server'

import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'

export async function upsertEmailTemplate(
  slug: string,
  subject: string,
  body_text: string,
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  // Check if a custom template already exists for this slug
  const { data: existing } = await supabase
    .from('email_templates')
    .select('id')
    .eq('organization_id', orgId)
    .eq('slug', slug)
    .single()

  if (existing) {
    const { error } = await supabase
      .from('email_templates')
      .update({ subject, body_text })
      .eq('id', existing.id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase
      .from('email_templates')
      .insert({ organization_id: orgId, slug, subject, body_text })
    if (error) return { error: error.message }
  }

  return { error: null }
}

export async function resetEmailTemplate(slug: string): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  const { error } = await supabase
    .from('email_templates')
    .delete()
    .eq('organization_id', orgId)
    .eq('slug', slug)

  if (error) return { error: error.message }
  return { error: null }
}
