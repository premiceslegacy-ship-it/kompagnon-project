'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { hasPermission } from '@/lib/data/queries/membership'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  setOrganizationOpenRouterKey,
  deleteOrganizationOpenRouterKey,
} from '@/lib/ai/openrouter-credentials'

export type AICredentialsState = {
  aiBillingMode: 'orsayn_shared' | 'client_owned'
  hasOwnKey: boolean
}

export async function getAICredentialsState(): Promise<AICredentialsState> {
  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) return { aiBillingMode: 'orsayn_shared', hasOwnKey: false }

  const admin = createAdminClient()
  const [{ data: modules }, { data: credentials }] = await Promise.all([
    admin.from('organization_modules').select('ai_billing_mode').eq('organization_id', organizationId).maybeSingle(),
    admin.from('organization_ai_credentials').select('organization_id').eq('organization_id', organizationId).maybeSingle(),
  ])

  return {
    aiBillingMode: modules?.ai_billing_mode === 'client_owned' ? 'client_owned' : 'orsayn_shared',
    hasOwnKey: !!credentials,
  }
}

// La clé n'est jamais renvoyée au client une fois enregistrée (write-only côté
// UI) : seule sa présence (hasOwnKey) est exposée. Évite qu'un secret déchiffré
// transite vers le navigateur pour un simple affichage d'état.
export async function saveOpenRouterKey(formData: FormData): Promise<{ error: string | null }> {
  if (!(await hasPermission('settings.edit_org'))) {
    return { error: 'Action non autorisée.' }
  }

  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) return { error: 'Organisation introuvable.' }

  const key = String(formData.get('openrouterKey') ?? '').trim()
  if (!key.startsWith('sk-or-')) {
    return { error: 'Clé OpenRouter invalide (doit commencer par sk-or-).' }
  }

  try {
    await setOrganizationOpenRouterKey(organizationId, key)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Échec de l\'enregistrement.' }
  }

  revalidatePath('/settings')
  return { error: null }
}

export async function removeOpenRouterKey(): Promise<{ error: string | null }> {
  if (!(await hasPermission('settings.edit_org'))) {
    return { error: 'Action non autorisée.' }
  }

  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) return { error: 'Organisation introuvable.' }

  try {
    await deleteOrganizationOpenRouterKey(organizationId)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Échec de la suppression.' }
  }

  revalidatePath('/settings')
  return { error: null }
}
