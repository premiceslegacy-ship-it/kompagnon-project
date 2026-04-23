'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'

/**
 * Sauvegarde les paramètres email de l'organisation.
 * Le client configure ici le nom et l'adresse expéditeur (vérifiée sur Resend).
 */
export async function updateEmailSettings(formData: FormData): Promise<{ error: string | null }> {
  const supabase = await createClient()

  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) return { error: 'Organisation introuvable.' }

  const fromName = (formData.get('email_from_name') as string)?.trim() || null
  const fromAddress = (formData.get('email_from_address') as string)?.trim().toLowerCase() || null

  const { error } = await supabase
    .from('organizations')
    .update({ email_from_name: fromName, email_from_address: fromAddress })
    .eq('id', organizationId)

  if (error) {
    console.error('[updateEmailSettings]', error.message)
    return { error: 'Impossible de sauvegarder les paramètres email.' }
  }

  revalidatePath('/settings')
  return { error: null }
}
