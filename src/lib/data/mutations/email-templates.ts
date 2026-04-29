'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import type { EmailTemplateSlug } from '@/lib/data/queries/emailTemplates'

export async function upsertEmailTemplate(input: {
  slug: EmailTemplateSlug
  subject: string
  body_text: string
}): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }

  const { error } = await supabase
    .from('email_templates')
    .upsert({
      organization_id: orgId,
      slug: input.slug,
      subject: input.subject.trim(),
      body_text: input.body_text.trim(),
      is_active: true,
    }, { onConflict: 'organization_id,slug' })

  if (error) {
    console.error('[upsertEmailTemplate]', error)
    return { error: 'Impossible de sauvegarder le template.' }
  }

  revalidatePath('/settings')
  return { error: null }
}

export async function resetEmailTemplate(slug: EmailTemplateSlug): Promise<{ error: string | null }> {
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
