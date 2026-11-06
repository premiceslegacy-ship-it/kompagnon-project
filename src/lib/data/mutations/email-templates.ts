'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { hasPermission } from '@/lib/data/queries/membership'
import type { EmailTemplateSlug } from '@/lib/data/queries/emailTemplates'

export async function upsertEmailTemplate(input: {
  slug: EmailTemplateSlug
  subject: string
  body_text: string
}): Promise<{ error: string | null }> {
  if (!(await hasPermission('settings.edit_emails'))) return { error: 'Action non autorisée.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }

  // Pas d'upsert : la table n'a pas de contrainte unique (organisation, modèle). On met à jour la ligne existante, sinon on l'insère.
  const values = { subject: input.subject.trim(), body_text: input.body_text.trim(), is_active: true }
  const { data: existing, error: lookupError } = await supabase
    .from('email_templates')
    .select('id')
    .eq('organization_id', orgId)
    .eq('slug', input.slug)
    .limit(1)
  const { error } = lookupError
    ? { error: lookupError }
    : existing && existing.length > 0
      ? await supabase.from('email_templates').update(values).eq('id', existing[0].id)
      : await supabase.from('email_templates').insert({ organization_id: orgId, slug: input.slug, ...values })

  if (error) {
    console.error('[upsertEmailTemplate]', error)
    return { error: 'Impossible de sauvegarder le template.' }
  }

  revalidatePath('/settings')
  return { error: null }
}

export async function resetEmailTemplate(slug: EmailTemplateSlug): Promise<{ error: string | null }> {
  if (!(await hasPermission('settings.edit_emails'))) return { error: 'Action non autorisée.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }

  const { error } = await supabase
    .from('email_templates')
    .delete()
    .eq('organization_id', orgId)
    .eq('slug', slug)

  if (error) {
    console.error('[resetEmailTemplate]', error)
    return { error: 'Impossible de réinitialiser le template.' }
  }

  revalidatePath('/settings')
  return { error: null }
}
