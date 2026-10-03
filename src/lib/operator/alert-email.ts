import type { createOperatorAdminClient } from '@/lib/supabase/operator'

type OperatorClient = ReturnType<typeof createOperatorAdminClient>

/**
 * Bouton d'un email d'alerte stocké en base : l'événement ne garde que le libellé
 * et le chemin (metadata.cta), l'URL complète se résout au moment de l'envoi avec
 * l'adresse de l'application de l'organisation concernée.
 */
export async function resolveAlertCta(
  operator: OperatorClient,
  input: { source_instance: string; organization_id: string | null; metadata: Record<string, unknown> | null },
): Promise<{ label: string; url: string } | undefined> {
  const cta = input.metadata?.cta as { label?: unknown; path?: unknown } | undefined
  if (typeof cta?.label !== 'string' || typeof cta.path !== 'string' || !input.organization_id) return undefined
  const { data } = await operator
    .from('operator_client_settings')
    .select('app_url')
    .eq('source_instance', input.source_instance)
    .eq('organization_id', input.organization_id)
    .maybeSingle()
  if (!data?.app_url) return undefined
  return { label: cta.label, url: `${String(data.app_url).replace(/\/+$/, '')}${cta.path}` }
}
