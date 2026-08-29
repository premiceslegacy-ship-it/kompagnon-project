import { NextRequest, NextResponse } from 'next/server'
import { isOperatorModeEnabled } from '@/lib/supabase/operator'
import { verifyOperatorSignature } from '@/lib/operator'
import { getOperatorClientContext } from '@/lib/operator/trial-lifecycle'
import { submitInvoice } from '@/lib/super-pdp/client'

export const dynamic = 'force-dynamic'

// Endpoint proxy cockpit pour l'émission (Phase 2). Nouveau sens instance→cockpit :
// jusqu'ici tout le HMAC allait cockpit→instance (config-sync). Réutilise le même
// secret partagé (OPERATOR_CONFIG_SYNC_SECRET) plutôt qu'une nouvelle variable —
// voir docs/atelier-facturation-electronique.md §7.4.
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
    && typeof v.organization_id === 'string' && v.organization_id.length > 0
    && typeof v.invoice_id === 'string' && v.invoice_id.length > 0
    && typeof v.xml === 'string' && v.xml.length > 0
  )
}

export async function POST(req: NextRequest) {
  if (!isOperatorModeEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const secret = process.env.OPERATOR_CONFIG_SYNC_SECRET?.trim()
    || process.env.OPERATOR_INGEST_SECRET?.trim()

  if (!secret) {
    return NextResponse.json({ error: 'Operator config sync secret missing' }, { status: 500 })
  }

  const rawBody = await req.text()
  const signature = req.headers.get('x-operator-signature')
  if (!verifyOperatorSignature(rawBody, secret, signature)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

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

  const result = await submitInvoice(payload.source_instance, payload.organization_id, payload.xml)

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status })
  }

  return NextResponse.json({
    message_id: String(result.data.id),
    status: result.data.events[0]?.status_code ?? null,
  })
}
