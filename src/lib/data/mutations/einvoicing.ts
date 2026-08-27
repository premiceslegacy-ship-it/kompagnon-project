'use server'

import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { hasPermission } from '@/lib/data/queries/membership'
import { getOperatorSourceInstance } from '@/lib/operator'
import { signOauthState } from '@/lib/super-pdp/oauth-state'
import { getOrganizationEinvoicingConfig } from '@/lib/data/queries/einvoicing'

// Construit l'URL d'autorisation Super PDP et la retourne au client, qui fait
// lui-même la redirection (window.location.href). L'instance redirige DIRECTEMENT
// vers Super PDP (pas via un endpoint cockpit intermédiaire) : SUPER_PDP_CLIENT_ID
// est public, identique sur toutes les instances — voir docs/atelier-facturation-electronique.md §7.3.
export async function startEinvoicingOauth(): Promise<{ url: string } | { error: string }> {
  if (!(await hasPermission('einvoicing.configure'))) {
    return { error: 'Action non autorisée.' }
  }

  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) {
    return { error: 'Organisation introuvable.' }
  }

  const einvoicingConfig = await getOrganizationEinvoicingConfig()
  if (einvoicingConfig.mode !== 'super_pdp') {
    return { error: 'La facturation électronique automatisée n’est pas activée pour cette organisation.' }
  }

  const endpoint = process.env.SUPER_PDP_API_ENDPOINT?.trim()
  const clientId = process.env.SUPER_PDP_CLIENT_ID?.trim()
  const redirectUri = process.env.SUPER_PDP_REDIRECT_URL?.trim()

  if (!endpoint || !clientId || !redirectUri) {
    return { error: 'Facturation électronique non configurée sur cette instance.' }
  }

  const sourceInstance = getOperatorSourceInstance()
  const state = signOauthState(sourceInstance, organizationId)

  const authorizeUrl = `${endpoint}/oauth2/authorize?${new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: '',
  }).toString()}`

  return { url: authorizeUrl }
}
