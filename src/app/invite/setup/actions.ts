'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

/**
 * Finalise le profil d'un utilisateur invité :
 * sauvegarde le nom complet, le poste et le mot de passe (optionnel).
 */
export async function completeInviteSetup(formData: FormData) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const fullName = (formData.get('full_name') as string)?.trim()
  const jobTitle = (formData.get('job_title') as string)?.trim() || null
  const password = (formData.get('password') as string)?.trim()

  if (!fullName) redirect('/invite/setup?error=missing_name')
  if (!password || password.length < 8) redirect('/invite/setup?error=missing_password')

  // Mettre à jour le profil
  const { error: profileError } = await supabase
    .from('profiles')
    .update({ full_name: fullName, job_title: jobTitle })
    .eq('id', user.id)

  if (profileError) {
    console.error('[completeInviteSetup] profile error:', profileError.message)
    redirect('/invite/setup?error=update_failed')
  }

  // Définir le mot de passe (obligatoire — sans ça l'utilisateur ne peut pas se reconnecter)
  const { error: pwError } = await supabase.auth.updateUser({ password })
  if (pwError) {
    console.error('[completeInviteSetup] password error:', pwError.message)
    redirect('/invite/setup?error=password_failed')
  }

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}
