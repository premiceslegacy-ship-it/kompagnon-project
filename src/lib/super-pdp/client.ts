// Wrapper API Super PDP — cockpit uniquement, jamais importé côté instance cliente
// (les tokens ne quittent jamais createOperatorAdminClient(), voir §7.2/§7.4 de
// docs/atelier-facturation-electronique.md). Endpoints et formats confirmés par
// exécution réelle le 29/08/2026 (scripts/super-pdp-emission-reception-probe.mjs).

import type { SupabaseClient } from '@supabase/supabase-js'
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

// La marge est également appliquée dans le RPC de revendication afin que
// chaque Worker prenne la décision sur la même horloge de base de données.

export type SuperPdpResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string }

function requireConfig() {
  const endpoint = process.env.SUPER_PDP_API_ENDPOINT?.trim()
  const clientId = process.env.SUPER_PDP_CLIENT_ID?.trim()
  const clientSecret = process.env.SUPER_PDP_CLIENT_SECRET?.trim()
  const encryptionKey = process.env.SUPER_PDP_ENCRYPTION_KEY?.trim()
  const environment = process.env.SUPER_PDP_ENV?.trim()

  if (!endpoint || !clientId || !clientSecret || !encryptionKey
    || (environment !== 'sandbox' && environment !== 'production')) {
    throw new Error('Configuration Super PDP incomplète ou environnement invalide côté cockpit')
  }

  return { endpoint, clientId, clientSecret, encryptionKey, environment }
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
 * Retourne un access_token valide pour (sourceInstance, organizationId).
 * L'acquisition est durable en base : un seul Worker peut consommer le
 * refresh_token à usage unique, et aucun token rafraîchi n'est utilisé avant
 * la persistance atomique des deux nouveaux ciphertexts.
 */
type RefreshClaim = {
  result_state: 'fresh' | 'claimed' | 'busy' | 'reconnect_required' | 'missing' | 'environment_mismatch'
  access_token_encrypted: string | null
  refresh_token_encrypted: string | null
  claim_owner: string | null
  credential_revision: string | null
}

function isRefreshClaimState(value: unknown): value is RefreshClaim['result_state'] {
  return value === 'fresh'
    || value === 'claimed'
    || value === 'busy'
    || value === 'reconnect_required'
    || value === 'missing'
    || value === 'environment_mismatch'
}

function parseRefreshClaim(value: unknown): RefreshClaim | null {
  const row = Array.isArray(value) ? value[0] : value
  if (!row || typeof row !== 'object') return null
  const claim = row as Record<string, unknown>
  if (!isRefreshClaimState(claim.result_state)) return null
  return {
    result_state: claim.result_state,
    access_token_encrypted: typeof claim.access_token_encrypted === 'string' ? claim.access_token_encrypted : null,
    refresh_token_encrypted: typeof claim.refresh_token_encrypted === 'string' ? claim.refresh_token_encrypted : null,
    claim_owner: typeof claim.claim_owner === 'string' ? claim.claim_owner : null,
    credential_revision: typeof claim.credential_revision === 'string' ? claim.credential_revision : null,
  }
}

function isUsableRefreshResponse(value: unknown): value is SuperPdpTokenResponse {
  return isSuperPdpTokenResponse(value)
    && Number.isFinite(value.expires_in)
    && value.expires_in > 0
}

async function failRefreshClaim(
  operator: SupabaseClient,
  sourceInstance: string,
  organizationId: string,
  claimOwner: string,
  credentialRevision: string,
): Promise<void> {
  try {
    await operator.rpc('fail_super_pdp_oauth_refresh', {
      p_source_instance: sourceInstance,
      p_organization_id: organizationId,
      p_claim_owner: claimOwner,
      p_expected_revision: credentialRevision,
    })
  } catch {
    // An unconfirmed failure leaves the durable claim to expire into
    // reconnect_required; it must never make the old refresh token reusable.
  }
}

export async function getValidAccessToken(
  sourceInstance: string,
  organizationId: string,
): Promise<SuperPdpResult<string>> {
  const { endpoint, clientId, clientSecret, encryptionKey, environment } = requireConfig()
  const operator = createOperatorAdminClient()
  const claimOwner = crypto.randomUUID()

  let claimResult: { data: unknown; error: unknown }
  try {
    claimResult = await operator.rpc('claim_super_pdp_oauth_refresh', {
      p_source_instance: sourceInstance,
      p_organization_id: organizationId,
      p_claim_owner: claimOwner,
      p_environment: environment,
    })
  } catch {
    return { ok: false, status: 503, message: 'État de connexion Super PDP indisponible' }
  }

  const claim = claimResult.error ? null : parseRefreshClaim(claimResult.data)
  if (!claim) {
    return { ok: false, status: 503, message: 'État de connexion Super PDP indisponible' }
  }
  if (claim.result_state === 'missing') {
    return { ok: false, status: 404, message: 'Aucune connexion Super PDP pour cette organisation' }
  }
  if (claim.result_state === 'environment_mismatch') {
    return { ok: false, status: 409, message: 'Reconnectez le compte Super PDP dans l’environnement configuré côté cockpit' }
  }
  if (claim.result_state === 'busy') {
    return { ok: false, status: 503, message: 'Actualisation Super PDP en cours; réessayez dans quelques instants' }
  }
  if (claim.result_state === 'reconnect_required') {
    return { ok: false, status: 409, message: 'Reconnectez le compte Super PDP avant de continuer' }
  }

  if (claim.result_state === 'fresh') {
    if (!claim.access_token_encrypted) {
      return { ok: false, status: 503, message: 'Identifiants Super PDP illisibles; reconnectez le compte' }
    }
    try {
      return { ok: true, data: await decryptSecret(claim.access_token_encrypted, encryptionKey) }
    } catch {
      return { ok: false, status: 503, message: 'Identifiants Super PDP illisibles; reconnectez le compte' }
    }
  }

  if (claim.claim_owner !== claimOwner || !claim.refresh_token_encrypted || !claim.credential_revision) {
    return { ok: false, status: 503, message: 'État de renouvellement Super PDP invalide' }
  }

  let refreshToken: string
  try {
    refreshToken = await decryptSecret(claim.refresh_token_encrypted, encryptionKey)
  } catch {
    await failRefreshClaim(operator, sourceInstance, organizationId, claimOwner, claim.credential_revision)
    return { ok: false, status: 409, message: 'Reconnectez le compte Super PDP avant de continuer' }
  }

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
      signal: AbortSignal.timeout(10_000),
    })
    const body: unknown = await resp.json()
    if (!resp.ok || !isUsableRefreshResponse(body)) {
      await failRefreshClaim(operator, sourceInstance, organizationId, claimOwner, claim.credential_revision)
      return { ok: false, status: 502, message: 'Échec du rafraîchissement; reconnectez le compte Super PDP' }
    }
    tokenResponse = body
  } catch {
    await failRefreshClaim(operator, sourceInstance, organizationId, claimOwner, claim.credential_revision)
    return { ok: false, status: 502, message: 'Résultat du rafraîchissement incertain; reconnectez le compte Super PDP' }
  }

  let accessTokenEncrypted: string
  let refreshTokenEncrypted: string
  try {
    [accessTokenEncrypted, refreshTokenEncrypted] = await Promise.all([
      encryptSecret(tokenResponse.access_token, encryptionKey),
      encryptSecret(tokenResponse.refresh_token, encryptionKey),
    ])
  } catch {
    await failRefreshClaim(operator, sourceInstance, organizationId, claimOwner, claim.credential_revision)
    return { ok: false, status: 503, message: 'Impossible de conserver le renouvellement; reconnectez le compte Super PDP' }
  }

  let completion: { data: unknown; error: unknown }
  try {
    completion = await operator.rpc('complete_super_pdp_oauth_refresh', {
      p_source_instance: sourceInstance,
      p_organization_id: organizationId,
      p_claim_owner: claimOwner,
      p_expected_revision: claim.credential_revision,
      p_access_token_encrypted: accessTokenEncrypted,
      p_refresh_token_encrypted: refreshTokenEncrypted,
      p_token_expires_at: new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString(),
    })
  } catch {
    await failRefreshClaim(operator, sourceInstance, organizationId, claimOwner, claim.credential_revision)
    return { ok: false, status: 503, message: 'Impossible de confirmer le renouvellement; reconnectez le compte Super PDP' }
  }

  if (completion.error || completion.data !== true) {
    await failRefreshClaim(operator, sourceInstance, organizationId, claimOwner, claim.credential_revision)
    return {
      ok: false,
      status: completion.error ? 503 : 409,
      message: 'Le renouvellement n’a pas été conservé; réessayez ou reconnectez le compte Super PDP',
    }
  }

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
