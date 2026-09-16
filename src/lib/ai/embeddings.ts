import { createAdminClient } from '@/lib/supabase/admin'
import { getOrganizationOpenRouterKey } from '@/lib/ai/openrouter-credentials'

const EMBEDDING_MODEL = 'qwen/qwen3-embedding-8b'
const OPENROUTER_EMBEDDINGS_URL = 'https://openrouter.ai/api/v1/embeddings'

async function resolveApiKey(organizationId: string | null): Promise<string | null> {
  if (!organizationId) return process.env.OPENROUTER_API_KEY ?? null

  const admin = createAdminClient()
  const { data } = await admin
    .from('organization_modules')
    .select('ai_billing_mode')
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (data?.ai_billing_mode === 'client_owned') {
    // Table (mutualisé) sinon OPENROUTER_API_KEY du Worker (modèle dédié
    // historique, 1 org par instance) — voir le commentaire équivalent
    // dans callAI.ts.
    return (await getOrganizationOpenRouterKey(organizationId)) ?? process.env.OPENROUTER_API_KEY ?? null
  }
  return process.env.OPENROUTER_API_KEY ?? null
}

// organizationId optionnel : absent pour les appels sans contexte org connu
// (garde la compatibilité), mais requis pour router vers la clé client en
// ai_billing_mode = 'client_owned' plutôt que la clé Atelier partagée.
export async function generateEmbedding(text: string, organizationId: string | null = null): Promise<number[] | null> {
  const apiKey = await resolveApiKey(organizationId)
  if (!apiKey) return null

  try {
    const res = await fetch(OPENROUTER_EMBEDDINGS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
        'X-Title': process.env.NEXT_PUBLIC_APP_NAME ?? 'ATELIER',
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.data?.[0]?.embedding ?? null
  } catch {
    return null
  }
}
