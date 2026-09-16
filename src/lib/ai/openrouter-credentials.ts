// Clé OpenRouter par organisation (offre setup 3k en mutualisé, ai_billing_mode
// = 'client_owned'). Lue uniquement côté serveur via createAdminClient() —
// organization_ai_credentials n'a aucune policy RLS pour authenticated, voir
// supabase/migrations/187_organization_openrouter_key.sql.

import { createAdminClient } from '@/lib/supabase/admin'
import { encryptSecret, decryptSecret } from '@/lib/crypto/secrets'

function getEncryptionKey(): string {
  const key = process.env.ORGANIZATION_AI_CREDENTIALS_ENCRYPTION_KEY?.trim()
  if (!key) {
    throw new Error('ORGANIZATION_AI_CREDENTIALS_ENCRYPTION_KEY manquante')
  }
  return key
}

export async function getOrganizationOpenRouterKey(organizationId: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('organization_ai_credentials')
    .select('openrouter_key_encrypted')
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (error) {
    console.error('[openrouter-credentials.get]', error)
    return null
  }
  if (!data) return null

  try {
    return await decryptSecret(data.openrouter_key_encrypted, getEncryptionKey())
  } catch (err) {
    console.error('[openrouter-credentials.decrypt]', err)
    return null
  }
}

export async function setOrganizationOpenRouterKey(organizationId: string, plaintextKey: string): Promise<void> {
  const admin = createAdminClient()
  const encrypted = await encryptSecret(plaintextKey, getEncryptionKey())

  const { error } = await admin
    .from('organization_ai_credentials')
    .upsert({ organization_id: organizationId, openrouter_key_encrypted: encrypted }, { onConflict: 'organization_id' })

  if (error) {
    throw new Error(`Écriture clé OpenRouter échouée: ${error.message}`)
  }
}

export async function deleteOrganizationOpenRouterKey(organizationId: string): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin
    .from('organization_ai_credentials')
    .delete()
    .eq('organization_id', organizationId)

  if (error) {
    throw new Error(`Suppression clé OpenRouter échouée: ${error.message}`)
  }
}
