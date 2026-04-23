'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export type ProfileState = { error: string | null }
export type PasswordState = { error: string | null; success?: boolean }

/**
 * Met à jour le nom complet (et optionnellement l'email) de l'utilisateur.
 */
export async function updateProfile(formData: FormData): Promise<ProfileState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  const firstName = (formData.get('first_name') as string)?.trim()
  const lastName  = (formData.get('last_name') as string)?.trim()
  const email     = (formData.get('email') as string)?.trim().toLowerCase()

  const fullName = [firstName, lastName].filter(Boolean).join(' ')

  // Mettre à jour le profil
  const { error: profileError } = await supabase
    .from('profiles')
    .update({ full_name: fullName || null })
    .eq('id', user.id)

  if (profileError) {
    console.error('[updateProfile] profile:', profileError.message)
    return { error: 'Impossible de mettre à jour le profil.' }
  }

  // Mettre à jour l'email si modifié
  if (email && email !== user.email) {
    const { error: emailError } = await supabase.auth.updateUser({ email })
    if (emailError) {
      console.error('[updateProfile] email:', emailError.message)
      return { error: 'Impossible de mettre à jour l\'email. Vérifiez le format.' }
    }
  }

  revalidatePath('/', 'layout')
  return { error: null }
}

/**
 * Met à jour l'avatar de l'utilisateur connecté.
 */
export async function updateAvatar(avatarUrl: string): Promise<ProfileState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  const { error } = await supabase
    .from('profiles')
    .update({ avatar_url: avatarUrl })
    .eq('id', user.id)

  if (error) {
    console.error('[updateAvatar]', error.message)
    return { error: 'Impossible de mettre à jour l\'avatar.' }
  }

  revalidatePath('/', 'layout')
  return { error: null }
}

/**
 * Change le mot de passe de l'utilisateur connecté.
 */
export async function updatePassword(formData: FormData): Promise<PasswordState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  const password = (formData.get('password') as string)?.trim()
  const confirm  = (formData.get('confirm') as string)?.trim()

  if (!password || password.length < 8) {
    return { error: 'Le mot de passe doit contenir au moins 8 caractères.' }
  }
  if (password !== confirm) {
    return { error: 'Les mots de passe ne correspondent pas.' }
  }

  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    console.error('[updatePassword]', error.message)
    return { error: 'Impossible de changer le mot de passe.' }
  }

  return { error: null, success: true }
}
