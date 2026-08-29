// Wrapper API Super PDP — cockpit uniquement, jamais importé côté instance cliente
// (les tokens ne quittent jamais createOperatorAdminClient(), voir §7.2/§7.4 de
// docs/atelier-facturation-electronique.md). Endpoints et formats confirmés par
// exécution réelle le 29/08/2026 (scripts/super-pdp-emission-reception-probe.mjs).

import { createOperatorAdminClient } from '@/lib/supabase/operator'
import { encryptSecret, decryptSecret } from '@/lib/crypto/secrets'
import {
  isSuperPdpTokenResponse,
  isSuperPdpInvoice,
  isSuperPdpInvoiceList,
  type SuperPdpTokenResponse,
  type SuperPdpInvoice,
  type SuperPdpInvoiceList,
} from '@/lib/super-pdp/types'

// Marge avant expiration pour déclencher un refresh préventif plutôt que d'échouer
// un appel en cours. access_token dure 1800s (confirmé) ; 2 min de marge suffit
// largement pour la durée d'une requête HTTP.
const REFRESH_MARGIN_MS = 2 * 60 * 1000

export type SuperPdpResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string }

function requireConfig() {
  const endpoint = process.env.SUPER_PDP_API_ENDPOINT?.trim()
  const clientId = process.env.SUPER_PDP_CLIENT_ID?.trim()
  const clientSecret = process.env.SUPER_PDP_CLIENT_SECRET?.trim()
  const encryptionKey = process.env.SUPER_PDP_ENCRYPTION_KEY?.trim()

  if (!endpoint || !clientId || !clientSecret || !encryptionKey) {
    throw new Error('Configuration Super PDP incomplète côté cockpit')
  }

  return { endpoint, clientId, clientSecret, encryptionKey }
}

// Forme d'erreur volontairement large : {http_status_code, message} est confirmé sur
// /v1.beta/invoices, mais pas encore vérifié sur tous les endpoints métier.
async function parseErrorBody(resp: Response): Promise<string> {
  try {
    const body: unknown = await resp.json()
    if (body && typeof body === 'object' && 'message' in body && typeof (body as Record<string, unknown>).message === 'string') {
      return (body as Record<string, unknown>).message as string
    }
    return JSON.stringify(body)
  } catch {
    return resp.statusText || `HTTP ${resp.status}`
  }
}

/**
 * Retourne un access_token valide pour (sourceInstance, organizationId), en le
 * rafraîchissant si besoin. Le refresh_token Super PDP tourne à usage unique
 * (rotation confirmée le 29/08/2026) : le nouveau token est toujours re-chiffré
 * et persisté avant d'être retourné à l'appelant.
 */
export async function getValidAccessToken(
  sourceInstance: string,
  organizationId: string,
): Promise<SuperPdpResult<string>> {
  const { endpoint, clientId, clientSecret, encryptionKey } = requireConfig()
  const operator = createOperatorAdminClient()

  const { data: credentials, error } = await operator
    .from('super_pdp_oauth_credentials')
    .select('access_token_encrypted, refresh_token_encrypted, token_expires_at')
    .eq('source_instance', sourceInstance)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (error || !credentials) {
    return { ok: false, status: 404, message: 'Aucune connexion Super PDP pour cette organisation' }
  }

  const expiresAt = new Date(credentials.token_expires_at).getTime()
  const stillValid = expiresAt - Date.now() > REFRESH_MARGIN_MS

  if (stillValid) {
    const accessToken = await decryptSecret(credentials.access_token_encrypted, encryptionKey)
    return { ok: true, data: accessToken }
  }

  const refreshToken = await decryptSecret(credentials.refresh_token_encrypted, encryptionKey)

  let tokenResponse: SuperPdpTokenResponse
  try {
    const resp = await fetch(`${endpoint}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    })
    const body: unknown = await resp.json()
    if (!resp.ok || !isSuperPdpTokenResponse(body)) {
      return { ok: false, status: resp.status, message: 'Échec du rafraîchissement du token Super PDP' }
    }
    tokenResponse = body
  } catch {
    return { ok: false, status: 502, message: 'Échec du rafraîchissement du token Super PDP' }
  }

  const [accessTokenEncrypted, refreshTokenEncrypted] = await Promise.all([
    encryptSecret(tokenResponse.access_token, encryptionKey),
    encryptSecret(tokenResponse.refresh_token, encryptionKey),
  ])

  await operator
    .from('super_pdp_oauth_credentials')
    .update({
      access_token_encrypted: accessTokenEncrypted,
      refresh_token_encrypted: refreshTokenEncrypted,
      token_expires_at: new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('source_instance', sourceInstance)
    .eq('organization_id', organizationId)

  return { ok: true, data: tokenResponse.access_token }
}

/**
 * Émission : POST /v1.beta/invoices, body = XML brut (CII). Retourne l'objet
 * facture Super PDP (id à stocker dans invoices.pa_message_id).
 */
export async function submitInvoice(
  sourceInstance: string,
  organizationId: string,
  xml: string,
): Promise<SuperPdpResult<SuperPdpInvoice>> {
  const { endpoint } = requireConfig()
  const tokenResult = await getValidAccessToken(sourceInstance, organizationId)
  if (!tokenResult.ok) return tokenResult

  const resp = await fetch(`${endpoint}/v1.beta/invoices`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenResult.data}`, 'Content-Type': 'application/xml' },
    body: xml,
  })

  if (!resp.ok) {
    return { ok: false, status: resp.status, message: await parseErrorBody(resp) }
  }

  const body: unknown = await resp.json()
  if (!isSuperPdpInvoice(body)) {
    return { ok: false, status: 502, message: 'Réponse Super PDP inattendue lors de l\'émission' }
  }
  return { ok: true, data: body }
}

/**
 * Réception : GET /v1.beta/invoices?starting_after_id=N&order=desc. Pagination
 * par curseur = plus grand id vu (confirmé, pas de curseur opaque séparé).
 */
export async function listReceivedInvoices(
  sourceInstance: string,
  organizationId: string,
  startingAfterId: string | null,
): Promise<SuperPdpResult<SuperPdpInvoiceList>> {
  const { endpoint } = requireConfig()
  const tokenResult = await getValidAccessToken(sourceInstance, organizationId)
  if (!tokenResult.ok) return tokenResult

  const params = new URLSearchParams({ order: 'desc' })
  if (startingAfterId) params.set('starting_after_id', startingAfterId)

  const resp = await fetch(`${endpoint}/v1.beta/invoices?${params.toString()}`, {
    headers: { Authorization: `Bearer ${tokenResult.data}` },
  })

  if (!resp.ok) {
    return { ok: false, status: resp.status, message: await parseErrorBody(resp) }
  }

  const body: unknown = await resp.json()
  if (!isSuperPdpInvoiceList(body)) {
    return { ok: false, status: 502, message: 'Réponse Super PDP inattendue lors du listing' }
  }
  return { ok: true, data: body }
}

/** Détail d'une facture : GET /v1.beta/invoices/{id}. */
export async function getInvoiceDetail(
  sourceInstance: string,
  organizationId: string,
  invoiceId: string,
): Promise<SuperPdpResult<SuperPdpInvoice>> {
  const { endpoint } = requireConfig()
  const tokenResult = await getValidAccessToken(sourceInstance, organizationId)
  if (!tokenResult.ok) return tokenResult

  const resp = await fetch(`${endpoint}/v1.beta/invoices/${invoiceId}`, {
    headers: { Authorization: `Bearer ${tokenResult.data}` },
  })

  if (!resp.ok) {
    return { ok: false, status: resp.status, message: await parseErrorBody(resp) }
  }

  const body: unknown = await resp.json()
  if (!isSuperPdpInvoice(body)) {
    return { ok: false, status: 502, message: 'Réponse Super PDP inattendue lors de la lecture du détail' }
  }
  return { ok: true, data: body }
}
