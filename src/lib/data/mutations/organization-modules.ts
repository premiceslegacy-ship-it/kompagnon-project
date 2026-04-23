'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import {
  normalizeOrganizationModules,
  type OrganizationModules,
} from '@/lib/organization-modules'

export async function updateOrganizationModules(input: Partial<OrganizationModules>): Promise<{ error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { error: 'Non authentifié' }

  const { data: membership } = await supabase
    .from('memberships')
    .select('organization_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single()

  if (!membership?.organization_id) return { error: 'Organisation introuvable' }

  const { data: currentRow, error: currentError } = await supabase
    .from('organization_modules')
    .select('modules')
    .eq('organization_id', membership.organization_id)
    .maybeSingle()

  if (currentError) {
    console.error('[updateOrganizationModules.current]', currentError)
    return { error: currentError.message }
  }

  const nextModules = normalizeOrganizationModules({
    ...(currentRow?.modules ?? {}),
    ...input,
  })

  const { error } = await supabase
    .from('organization_modules')
    .upsert({
      organization_id: membership.organization_id,
      modules: nextModules,
    }, { onConflict: 'organization_id' })

  if (error) {
    console.error('[updateOrganizationModules]', error)
    return { error: error.message }
  }

  revalidatePath('/', 'layout')
  revalidatePath('/settings')
  revalidatePath('/dashboard')
  revalidatePath('/atelier-ia')
  revalidatePath('/chantiers/planning')
  revalidatePath('/finances/quote-editor')
  return {}
}
