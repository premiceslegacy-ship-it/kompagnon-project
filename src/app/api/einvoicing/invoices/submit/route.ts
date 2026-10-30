import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createOperatorAdminClient, isOperatorModeEnabled } from '@/lib/supabase/operator'
import { hasOperatorMasterSecret, readOperatorRequest } from '@/lib/operator'
import { getOperatorClientContext } from '@/lib/operator/trial-lifecycle'
import { submitInvoice } from '@/lib/super-pdp/client'

export const dynamic = 'force-dynamic'

// Endpoint proxy cockpit pour l'émission (Phase 2), appelé par chaque instance
// avec son secret HMAC dérivé. Le cockpit vérifie l'identité via son master,
// puis garde une revendication durable par facture avant l'effet provider.
//
// Déployée sur toutes les instances via le même build, mais active uniquement en
// mode cockpit — comme le callback OAuth. Une instance cliente reçoit 404 ici.

type SubmitPayload = {
  source_instance: string
  organization_id: string
  invoice_id: string
  xml: string
}

function isValidPayload(value: unknown): value is SubmitPayload {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.source_instance === 'string' && v.source_instance.length > 0
    && typeof v.organization_id === 'string' && isUuid(v.organization_id)
    && typeof v.invoice_id === 'string' && isUuid(v.invoice_id)
    && typeof v.xml === 'string' && v.xml.length > 0
  )
}
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

export async function POST(req: NextRequest) {
  if (!isOperatorModeEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (!hasOperatorMasterSecret()) {
    return NextResponse.json({ error: 'Operator master secret missing' }, { status: 500 })
  }

  const rawBody = await req.text()
  const check = readOperatorRequest<Record<string, unknown>>(rawBody, req.headers, { requireMaster: true })
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status })
  }
  const payload: unknown = check.body

  if (!isValidPayload(payload)) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  // Ne fait jamais confiance au seul appel entrant : revérifie le gating complet
  // (mode + oauth_status + emission_enabled) depuis la DB opérateur, même si
  // l'instance appelante a déjà vérifié la même chose de son côté.
  const context = await getOperatorClientContext(payload.source_instance, payload.organization_id)
  const { einvoicingConfig } = context.subscription

  if (
    einvoicingConfig.mode !== 'super_pdp'
    || einvoicingConfig.oauth_status !== 'connected'
    || !einvoicingConfig.emission_enabled
  ) {
    return NextResponse.json({ error: 'Émission Super PDP non activée pour cette organisation' }, { status: 403 })
  }

  const operator = createOperatorAdminClient()
  const requestSha256 = createHash('sha256').update(payload.xml, 'utf8').digest('hex')
  const submissionKey = {
    source_instance: payload.source_instance,
    organization_id: payload.organization_id,
    invoice_id: payload.invoice_id,
  }
  const { data: claim, error: claimError } = await operator
    .from('operator_einvoicing_submissions')
    .insert({
      ...submissionKey,
      request_sha256: requestSha256,
      status: 'processing',
    })
    .select('invoice_id')
    .maybeSingle()

  if (claimError) {
    if (claimError.code !== '23505') {
      console.error('[einvoicing/submit.claim]', claimError)
      return NextResponse.json({ error: 'Impossible de revendiquer cette émission' }, { status: 500 })
    }

    const { data: existing, error: existingError } = await operator
      .from('operator_einvoicing_submissions')
      .select('request_sha256, status, provider_message_id, provider_status')
      .match(submissionKey)
      .maybeSingle()
    if (existingError || !existing) {
      console.error('[einvoicing/submit.read-claim]', existingError)
      return NextResponse.json({ error: 'État d’émission indisponible' }, { status: 500 })
    }
    if (existing.request_sha256 !== requestSha256) {
      return NextResponse.json({ error: 'Cette facture a déjà une émission avec un contenu différent' }, { status: 409 })
    }
    if (existing.status === 'submitted' && existing.provider_message_id) {
      return NextResponse.json({
        message_id: existing.provider_message_id,
        status: existing.provider_status ?? null,
      })
    }

    // `processing` is deliberately not lease-expired: a crash after Super PDP
    // accepted the invoice is indistinguishable from a failed request. Keep it
    // non-retryable until an operator reconciles the provider state.
    return NextResponse.json({ error: 'Émission déjà en cours ou à réconcilier' }, { status: 409 })
  }
  if (!claim) {
    console.error('[einvoicing/submit.claim] claim row missing without error')
    return NextResponse.json({ error: 'Impossible de revendiquer cette émission' }, { status: 500 })
  }

  const result = await submitInvoice(payload.source_instance, payload.organization_id, payload.xml).catch((error: unknown) => {
    // A transport failure may happen after provider acceptance; retain the
    // processing claim so a signed replay cannot create a second invoice.
    console.error('[einvoicing/submit.provider-uncertain]', error)
    return { ok: false as const, status: 502, message: 'Résultat de l’émission incertain; réconciliation requise' }
  })

  if (!result.ok) {
    if (result.status < 500) {
      const { error: releaseError } = await operator
        .from('operator_einvoicing_submissions')
        .delete()
        .match(submissionKey)
        .eq('request_sha256', requestSha256)
        .eq('status', 'processing')
        .select('invoice_id')
        .maybeSingle()
      if (releaseError) console.error('[einvoicing/submit.release-rejected]', releaseError)
    } else {
      console.error('[einvoicing/submit.provider-uncertain]', result.status, result.message)
    }
    return NextResponse.json({ error: result.message }, { status: result.status })
  }

  const messageId = String(result.data.id)
  const providerStatus = result.data.events[0]?.status_code ?? null
  const { data: completed, error: completeError } = await operator
    .from('operator_einvoicing_submissions')
    .update({
      status: 'submitted',
      provider_message_id: messageId,
      provider_status: providerStatus,
      submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .match(submissionKey)
    .eq('request_sha256', requestSha256)
    .eq('status', 'processing')
    .select('invoice_id')
    .maybeSingle()
  if (completeError || !completed) {
    // Do not release the claim: Super PDP has accepted the invoice, and a
    // replay must not submit it again merely because local persistence failed.
    console.error('[einvoicing/submit.complete]', completeError)
    return NextResponse.json({ error: 'Facture transmise; état local à réconcilier' }, { status: 500 })
  }

  return NextResponse.json({ message_id: messageId, status: providerStatus })
}
