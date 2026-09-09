import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'

export type CompanyMemoryRow = {
  id: string
  type: string
  content: string
  source: string | null
  confidence: number | null
  created_at: string
}

/**
 * Liste les mémoires actives de l'organisation pour l'onglet Confidentialité
 * des réglages : donner à l'utilisateur une visibilité sur ce que Sarah et
 * Chloé ont retenu, condition de confiance pour une mémoire qui influence
 * les prix (voir syncQuoteLearningEntry) et les réponses de Sarah.
 * Plafonné à 100 lignes les plus récentes : suffisant pour une revue
 * manuelle, évite de charger un historique de plusieurs mois d'un coup.
 */
export async function getCompanyMemories(): Promise<CompanyMemoryRow[]> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  const { data, error } = await supabase
    .from('company_memory')
    .select('id, type, content, source, confidence, created_at')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) {
    console.error('[getCompanyMemories]', error)
    return []
  }

  return data ?? []
}
