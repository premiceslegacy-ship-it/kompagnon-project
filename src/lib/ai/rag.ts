import { createAdminClient } from '@/lib/supabase/admin'
import { generateEmbedding } from './embeddings'

type MemoryRow = {
  content: string
  type: string
  metadata: Record<string, unknown> | null
  similarity: number
}

/**
 * Retourne un bloc de contexte formaté à injecter dans un system prompt.
 * Renvoie une chaîne vide si pas d'embedding dispo ou aucun résultat.
 */
export async function fetchRAGContext(
  orgId: string,
  queryText: string,
  options: { limit?: number; activityId?: string | null } = {},
): Promise<string> {
  const { limit = 5, activityId } = options
  const embedding = await generateEmbedding(queryText)
  if (!embedding) return ''

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('match_company_memory', {
    p_organization_id: orgId,
    p_embedding: embedding,
    p_limit: limit,
    p_activity_id: activityId ?? null,
  })

  if (error || !data?.length) return ''

  const rows = data as MemoryRow[]
  const lines = rows.map(r => `- [${r.type}] ${r.content}`)
  return lines.join('\n')
}
