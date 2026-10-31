import { createAdminClient } from '@/lib/supabase/admin'
import { getOrganizationOpenRouterKey } from '@/lib/ai/openrouter-credentials'

const EMBEDDING_MODEL = 'qwen/qwen3-embedding-8b'
const OPENROUTER_EMBEDDINGS_URL = 'https://openrouter.ai/api/v1/embeddings'

async function resolveApiKey(organizationId: string): Promise<string | null> {
  if (!organizationId) return null

  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('organization_modules')
      .select('ai_billing_mode')
      .eq('organization_id', organizationId)
      .maybeSingle()

    if (error) {
      console.error('[ai.embeddings.billing-mode]', error)
      return null
    }

    if (data?.ai_billing_mode === 'client_owned') {
      let apiKey: string | null
      try {
        apiKey = await getOrganizationOpenRouterKey(organizationId)
      } catch (credentialError) {
        console.error('[ai.embeddings.client-key]', credentialError)
        return null
      }
      if (!apiKey) {
        console.error('[ai.embeddings] Clé OpenRouter client absente ou invalide.')
      }
      return apiKey
    }

    if (data?.ai_billing_mode === 'orsayn_shared') {
      return process.env.OPENROUTER_API_KEY ?? null
    }

    return null
  } catch (error) {
    console.error('[ai.embeddings.billing-mode]', error)
    return null
  }
}

// L'organisation est requise pour choisir entre une clé client et le mode
// partagé. Sans contexte tenant, aucun appel fournisseur n'est effectué.
export async function generateEmbedding(text: string, organizationId: string): Promise<number[] | null> {
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
