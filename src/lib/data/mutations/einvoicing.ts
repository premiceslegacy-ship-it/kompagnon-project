'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { hasPermission } from '@/lib/data/queries/membership'
import { getOperatorSourceInstance, signOperatorPayload } from '@/lib/operator'
import { signOauthState } from '@/lib/super-pdp/oauth-state'
import { getOrganizationEinvoicingConfig } from '@/lib/data/queries/einvoicing'
import { getFacturXmlForInvoice } from '@/lib/pdf/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

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

type TransmitResult = { success: true; messageId: string } | { error: string }

// Transmet une facture déjà émise/envoyée à Super PDP. Action strictement volontaire,
// jamais déclenchée automatiquement (contrainte explicite : ce n'est pas tous les
// clients qui doivent passer par Atelier pour leur facturation électronique). Suit le
// pattern instance→cockpit de createStripePortalSession (src/lib/data/mutations/stripe-portal.ts) :
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

  // Facturation électronique B2B uniquement (obligation légale 2026-2027) : ne
  // fait jamais confiance au seul masquage du bouton côté UI, revérifie ici que
  // le client de la facture est bien une entreprise avec un SIRET renseigné.
  const supabase = await createClient()
  const { data: invoiceRow } = await supabase
    .from('invoices')
    .select('client:clients(type, siret)')
    .eq('id', invoiceId)
    .eq('organization_id', organizationId)
    .maybeSingle()
  const rawClient = invoiceRow?.client as { type: string | null; siret: string | null } | { type: string | null; siret: string | null }[] | null
  const invoiceClient = Array.isArray(rawClient) ? rawClient[0] ?? null : rawClient
  if (invoiceClient?.type !== 'company' || !invoiceClient.siret?.trim()) {
    return { error: 'La transmission Super PDP est réservée aux clients professionnels (SIRET requis).' }
  }

  const xml = await getFacturXmlForInvoice(invoiceId, organizationId)
  if (!xml) {
    return { error: 'Facture introuvable.' }
  }

  const cockpitBase = new URL(ingestUrl).origin
  const body = JSON.stringify({
    source_instance: sourceInstance,
    organization_id: organizationId,
    invoice_id: invoiceId,
    xml,
  })
  const signature = signOperatorPayload(body, secret)

  let response: Response
  try {
    response = await fetch(`${cockpitBase}/api/einvoicing/invoices/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-operator-signature': signature },
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
