'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentMembershipContext } from '@/lib/data/queries/membership'

/**
 * Désactive une mémoire (soft delete, cohérent avec la purge automatique de
 * data-retention/route.ts qui filtre déjà sur is_active). Réservé aux
 * owners, même contrôle que createOrganizationExport : cette mémoire peut
 * influencer les prix proposés par Chloé (syncQuoteLearningEntry) et les
 * réponses de Sarah, ce n'est pas une donnée anodine à laisser n'importe
 * quel rôle purger.
 */
export async function deactivateCompanyMemory(memoryId: string): Promise<{ error: string | null }> {
  const membership = await getCurrentMembershipContext()
  if (!membership?.organizationId) {
    return { error: 'Organisation introuvable.' }
  }
  if (membership.roleSlug !== 'owner') {
    return { error: 'Seul le propriétaire du compte peut supprimer un élément de mémoire.' }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('company_memory')
    .update({ is_active: false })
    .eq('id', memoryId)
    .eq('organization_id', membership.organizationId)

  if (error) {
    console.error('[deactivateCompanyMemory]', error)
    return { error: 'Impossible de supprimer cet élément pour le moment.' }
  }

  revalidatePath('/settings')
  return { error: null }
}
