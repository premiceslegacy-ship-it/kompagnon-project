'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { hasPermission } from '@/lib/data/queries/membership'
import { getOperatorSigningSecret, getOperatorSourceInstance, signOperatorRequest, OPERATOR_TIMESTAMP_HEADER } from '@/lib/operator'
import { signOauthState } from '@/lib/super-pdp/oauth-state'
import { getOrganizationEinvoicingConfig } from '@/lib/data/queries/einvoicing'
import { normalizeEinvoicingConfig } from '@/lib/einvoicing-config'
import { getFacturXmlForInvoice, InvoiceIssuanceAuthorityError, type FacturXInvoicePayload } from '@/lib/pdf/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Notifie le cockpit en best-effort qu'un client a active la facturation
// electronique en self-service (connexion OAuth ou toggle emission) --
// l'instance a deja ecrit sa propre config avant d'appeler cette fonction,
// donc un echec ici ne doit jamais bloquer l'action locale. Meme pattern que
// postOperator() de src/lib/data/mutations/subscription-self-service.ts.
async function notifyOperatorEinvoicingActivate(input: {
  action: 'oauth_started' | 'emission_toggled' | 'reception_toggled'
  organizationId: string
  sourceInstance: string
  emissionEnabled?: boolean
  receptionEnabled?: boolean
}): Promise<void> {
  const ingestUrl = process.env.OPERATOR_INGEST_URL?.trim()
  const secret = getOperatorSigningSecret(input.sourceInstance)
  if (!ingestUrl || !secret) return
  const cockpitBase = new URL(ingestUrl).origin
  const body = JSON.stringify({
    source_instance: input.sourceInstance,
    organization_id: input.organizationId,
    app_url: process.env.NEXT_PUBLIC_APP_URL,
    action: input.action,
    ...(input.emissionEnabled !== undefined ? { emission_enabled: input.emissionEnabled } : {}),
    ...(input.receptionEnabled !== undefined ? { reception_enabled: input.receptionEnabled } : {}),
  })
  const { signature, timestamp } = signOperatorRequest(body, secret)
  await fetch(`${cockpitBase}/api/operator/self-service/einvoicing-activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-operator-signature': signature, [OPERATOR_TIMESTAMP_HEADER]: timestamp },
    body,
  })
}

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

  const endpoint = process.env.SUPER_PDP_API_ENDPOINT?.trim()
  const clientId = process.env.SUPER_PDP_CLIENT_ID?.trim()
  const redirectUri = process.env.SUPER_PDP_REDIRECT_URL?.trim()

  if (!endpoint || !clientId || !redirectUri) {
    return { error: 'Facturation électronique non configurée sur cette instance.' }
  }

  // Self-service : le client active lui-même mode='super_pdp' en cliquant,
  // sans intervention prealable du cockpit (voir docs/atelier-facturation-electronique.md).
  const currentConfig = await getOrganizationEinvoicingConfig()
  const updatedConfig = normalizeEinvoicingConfig({ ...currentConfig, mode: 'super_pdp' })
  const admin = createAdminClient()
  const { error: upsertError } = await admin
    .from('organization_einvoicing_config')
    .upsert({
      organization_id: organizationId,
      mode: updatedConfig.mode,
      provider: updatedConfig.provider,
      environment: updatedConfig.environment,
      annuaire_status: updatedConfig.annuaire_status,
      oauth_status: updatedConfig.oauth_status,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'organization_id' })
  if (upsertError) {
    console.error('[startEinvoicingOauth] upsert local config', upsertError)
    return { error: 'Impossible d’activer la facturation électronique.' }
  }

  const sourceInstance = getOperatorSourceInstance()

  await notifyOperatorEinvoicingActivate({ action: 'oauth_started', organizationId, sourceInstance }).catch((err) => {
    console.error('[startEinvoicingOauth] cockpit notify failed', err)
  })

  const state = signOauthState(sourceInstance, organizationId)

  const authorizeUrl = `${endpoint}/oauth2/authorize?${new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: '',
  }).toString()}`

  revalidatePath('/settings')

  return { url: authorizeUrl }
}

// Emission facultative jusqu'au 01/09/2027 (obligation legale) : le client
// l'active explicitement depuis ses parametres ou l'onboarding.
export async function setEmissionEnabled(enabled: boolean): Promise<{ error: string | null }> {
  if (!(await hasPermission('einvoicing.configure'))) {
    return { error: 'Action non autorisée.' }
  }

  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) {
    return { error: 'Organisation introuvable.' }
  }

  const currentConfig = await getOrganizationEinvoicingConfig()
  if (currentConfig.mode !== 'super_pdp' || currentConfig.oauth_status !== 'connected') {
    return { error: 'Connectez d’abord votre compte Super PDP avant d’activer l’émission.' }
  }

  const admin = createAdminClient()
  const nowIso = new Date().toISOString()
  const { error } = await admin
    .from('organization_einvoicing_config')
    .update({ super_pdp_emission_enabled: enabled, emission_consent_at: nowIso, updated_at: nowIso })
    .eq('organization_id', organizationId)
  if (error) {
    console.error('[setEmissionEnabled] update', error)
    return { error: 'Impossible de mettre à jour le réglage.' }
  }

  // Attendue (pas de ctx.waitUntil disponible depuis une server action sur
  // Cloudflare Workers -- un fetch non attendu risquerait d'etre coupe avant
  // d'aboutir). La donnee qui compte (super_pdp_emission_enabled) est deja
  // ecrite localement ci-dessus ; seul l'echec de CETTE notification reste
  // absorbe (best-effort sur le resultat, pas sur l'attente).
  await notifyOperatorEinvoicingActivate({
    action: 'emission_toggled',
    organizationId,
    sourceInstance: getOperatorSourceInstance(),
    emissionEnabled: enabled,
  }).catch((err) => console.error('[setEmissionEnabled] cockpit notify failed', err))

  revalidatePath('/settings')
  return { error: null }
}

// Reception obligatoire par la loi depuis le 01/09/2026, sans derogation possible --
// le client garde neanmoins le controle total de ce reglage (choix produit assume face
// a la mefiance actuelle envers les plateformes administratives). L'UI (EinvoicingTab)
// doit faire confirmer explicitement toute desactivation, mais cette action ne bloque
// jamais elle-meme la desactivation : le consentement est trace via reception_consent_at,
// pas empeche techniquement. Voir docs/atelier-facturation-electronique.md.
export async function setReceptionEnabled(enabled: boolean): Promise<{ error: string | null }> {
  if (!(await hasPermission('einvoicing.configure'))) {
    return { error: 'Action non autorisée.' }
  }

  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) {
    return { error: 'Organisation introuvable.' }
  }

  const currentConfig = await getOrganizationEinvoicingConfig()
  if (currentConfig.mode !== 'super_pdp' || currentConfig.oauth_status !== 'connected') {
    return { error: 'Connectez d’abord votre compte Super PDP avant de configurer la réception.' }
  }

  const admin = createAdminClient()
  const nowIso = new Date().toISOString()
  const { error } = await admin
    .from('organization_einvoicing_config')
    .update({ super_pdp_reception_enabled: enabled, reception_consent_at: nowIso, updated_at: nowIso })
    .eq('organization_id', organizationId)
  if (error) {
    console.error('[setReceptionEnabled] update', error)
    return { error: 'Impossible de mettre à jour le réglage.' }
  }

  await notifyOperatorEinvoicingActivate({
    action: 'reception_toggled',
    organizationId,
    sourceInstance: getOperatorSourceInstance(),
    receptionEnabled: enabled,
  }).catch((err) => console.error('[setReceptionEnabled] cockpit notify failed', err))

  revalidatePath('/settings')
  return { error: null }
}

type TransmitResult = { success: true; messageId: string } | { error: string }

// Transmet une facture déjà émise/envoyée à Super PDP. Appelée automatiquement
// depuis sendInvoice() (best-effort, en plus du bouton "Valider & Envoyer")
// quand emission_enabled=true et que le client est B2B+SIRET -- jamais
// déclenchée pour un client non identifié comme professionnel (contrainte
// produit : ce n'est pas tous les clients qui doivent passer par Atelier pour
// leur facturation électronique). Suit le pattern instance→cockpit de
// createStripePortalSession (src/lib/data/mutations/stripe-portal.ts) :
// POST signé HMAC vers le même worker cockpit, dérivé de OPERATOR_INGEST_URL.
export async function transmitInvoiceViaSuperPdp(invoiceId: string): Promise<TransmitResult> {
  if (!(await hasPermission('invoices.send'))) {
    return { error: 'Permission refusée.' }
  }

  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) {
    return { error: 'Organisation introuvable.' }
  }

  const einvoicingConfig = await getOrganizationEinvoicingConfig()
  if (
    einvoicingConfig.mode !== 'super_pdp'
    || einvoicingConfig.oauth_status !== 'connected'
    || !einvoicingConfig.emission_enabled
  ) {
    return { error: 'La transmission via Super PDP n’est pas activée pour votre organisation.' }
  }

  const ingestUrl = process.env.OPERATOR_INGEST_URL?.trim()
  const secret = process.env.OPERATOR_CONFIG_SYNC_SECRET?.trim()
    || process.env.OPERATOR_INGEST_SECRET?.trim()
  const sourceInstance = getOperatorSourceInstance()

  if (!ingestUrl || !secret) {
    return { error: 'Configuration opérateur manquante.' }
  }

  // Eligibility and transmitted XML both come from the immutable issued snapshot.
  let payload: FacturXInvoicePayload | null
  try {
    payload = await getFacturXmlForInvoice(invoiceId, organizationId)
  } catch (err) {
    if (err instanceof InvoiceIssuanceAuthorityError) return { error: err.message }
    console.error('[transmitInvoiceViaSuperPdp] fiscal authority load failed', err)
    return { error: 'Impossible de préparer le document fiscal.' }
  }
  if (!payload) return { error: 'Facture introuvable ou pas encore émise.' }
  if (payload.buyerType !== 'company' || !payload.buyerSiret?.trim()) {
    return { error: 'La transmission Super PDP est réservée aux clients professionnels (SIRET requis).' }
  }
  const xml = payload.xml

  const cockpitBase = new URL(ingestUrl).origin
  const body = JSON.stringify({
    source_instance: sourceInstance,
    organization_id: organizationId,
    invoice_id: invoiceId,
    xml,
  })
  const { signature, timestamp } = signOperatorRequest(body, secret)

  let response: Response
  try {
    response = await fetch(`${cockpitBase}/api/einvoicing/invoices/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-operator-signature': signature, [OPERATOR_TIMESTAMP_HEADER]: timestamp },
      body,
    })
  } catch (err) {
    console.error('[transmitInvoiceViaSuperPdp]', err)
    return { error: 'Impossible de contacter le cockpit Orsayn.' }
  }

  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: string }
    return { error: data.error ?? `Erreur ${response.status}` }
  }

  const { message_id: messageId, status } = await response.json() as { message_id: string; status: string | null }

  const admin = createAdminClient()
  const nowIso = new Date().toISOString()

  const { error: updateError } = await admin
    .from('invoices')
    .update({ pa_message_id: messageId, pa_status: 'submitted', pa_status_updated_at: nowIso })
    .eq('id', invoiceId)
    .eq('organization_id', organizationId)

  if (updateError) {
    console.error('[transmitInvoiceViaSuperPdp] update invoices', updateError)
    return { error: 'Facture transmise mais le statut n’a pas pu être enregistré.' }
  }

  await admin.from('pa_status_events').insert({
    organization_id: organizationId,
    invoice_id: invoiceId,
    pa_message_id: messageId,
    event_type: 'submitted',
    new_status: status ?? 'submitted',
    pa_timestamp: nowIso,
  })

  revalidatePath('/finances')

  return { success: true, messageId }
}
