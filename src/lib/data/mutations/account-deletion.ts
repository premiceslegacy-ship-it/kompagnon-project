'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'

/**
 * Étape finale du workflow de suppression RGPD.
 * Enregistre deletion_requested_at + deletion_scheduled_at (J+30) sur l'organisation.
 * Requiert que l'utilisateur soit owner (role slug = 'owner').
 */
export async function requestAccountDeletion(): Promise<{ error?: string }> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié' }

  const { data: membership } = await supabase
    .from('memberships')
    .select('organization_id, role:roles(slug)')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single()

  if (!membership?.organization_id) return { error: 'Organisation introuvable' }

  const roleSlug = (membership.role as unknown as { slug: string } | null)?.slug
  if (roleSlug !== 'owner') return { error: 'Réservé au propriétaire du compte' }

  const now = new Date()
  const scheduled = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

  const admin = createAdminClient()
  const { error } = await admin
    .from('organizations')
    .update({
      deletion_requested_at: now.toISOString(),
      deletion_scheduled_at: scheduled.toISOString(),
    })
    .eq('id', membership.organization_id)

  if (error) {
    console.error('[requestAccountDeletion]', error)
    return { error: error.message }
  }

  revalidatePath('/settings')
  return {}
}

/**
 * Annule une demande de suppression en cours (dans les 30j).
 */
export async function cancelAccountDeletion(): Promise<{ error?: string }> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié' }

  const { data: membership } = await supabase
    .from('memberships')
    .select('organization_id, role:roles(slug)')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single()

  if (!membership?.organization_id) return { error: 'Organisation introuvable' }

  const roleSlug = (membership.role as unknown as { slug: string } | null)?.slug
  if (roleSlug !== 'owner') return { error: 'Réservé au propriétaire du compte' }

  const admin = createAdminClient()
  const { error } = await admin
    .from('organizations')
    .update({
      deletion_requested_at: null,
      deletion_scheduled_at: null,
    })
    .eq('id', membership.organization_id)

  if (error) {
    console.error('[cancelAccountDeletion]', error)
    return { error: error.message }
  }

  revalidatePath('/settings')
  return {}
}
