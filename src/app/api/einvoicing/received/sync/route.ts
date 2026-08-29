import { NextRequest, NextResponse } from 'next/server'
import { verifyOperatorSignature } from '@/lib/operator'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// Endpoint côté instance cliente pour la réception (Phase 3). Reçoit un POST
// signé HMAC depuis le cockpit (jamais d'appel direct instance→Super PDP en
// réception, voir docs/atelier-facturation-electronique.md §7.5). Symétrique de
// /api/operator/config-sync, mais en sens cockpit→instance sur ce domaine précis.
//
// Idempotent via pa_message_id (UNIQUE sur received_invoices) : un même poll
// rejoué (ou un id déjà synchronisé renvoyé par erreur) ne crée pas de doublon.

type SyncPayload = {
  source_instance: string
  organization_id: string
  pa_message_id: string
  pa_received_at: string
  supplier_siren: string
  supplier_siret: string | null
  supplier_name: string
  supplier_vat: string | null
  invoice_number: string
  invoice_date: string
  due_date: string | null
  total_ht: number
  total_tva: number
  total_ttc: number
}

function isValidPayload(value: unknown): value is SyncPayload {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.source_instance === 'string' && v.source_instance.length > 0
    && typeof v.organization_id === 'string' && v.organization_id.length > 0
    && typeof v.pa_message_id === 'string' && v.pa_message_id.length > 0
    && typeof v.pa_received_at === 'string'
    && typeof v.supplier_siren === 'string' && v.supplier_siren.length > 0
    && typeof v.supplier_name === 'string' && v.supplier_name.length > 0
    && typeof v.invoice_number === 'string' && v.invoice_number.length > 0
    && typeof v.invoice_date === 'string'
    && typeof v.total_ht === 'number'
    && typeof v.total_tva === 'number'
    && typeof v.total_ttc === 'number'
  )
}

export async function POST(req: NextRequest) {
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

  const admin = createAdminClient()

  const { data: organization } = await admin
    .from('organizations')
    .select('id')
    .eq('id', payload.organization_id)
    .maybeSingle()

  if (!organization) {
    return NextResponse.json({ error: 'Organisation inconnue sur cette instance' }, { status: 404 })
  }

  const { data: config } = await admin
    .from('organization_einvoicing_config')
    .select('super_pdp_reception_enabled')
    .eq('organization_id', payload.organization_id)
    .maybeSingle()

  if (!config?.super_pdp_reception_enabled) {
    return NextResponse.json({ error: 'Réception Super PDP non activée pour cette organisation' }, { status: 403 })
  }

  const { data: existing } = await admin
    .from('received_invoices')
    .select('id')
    .eq('pa_message_id', payload.pa_message_id)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ ok: true, id: existing.id, already_synced: true })
  }

  const { data: inserted, error: insertError } = await admin
    .from('received_invoices')
    .insert({
      organization_id: payload.organization_id,
      pa_message_id: payload.pa_message_id,
      pa_received_at: payload.pa_received_at,
      supplier_siren: payload.supplier_siren,
      supplier_siret: payload.supplier_siret,
      supplier_name: payload.supplier_name,
      supplier_vat: payload.supplier_vat,
      invoice_number: payload.invoice_number,
      invoice_date: payload.invoice_date,
      due_date: payload.due_date,
      total_ht: payload.total_ht,
      total_tva: payload.total_tva,
      total_ttc: payload.total_ttc,
      status: 'received',
    })
    .select('id')
    .single()

  if (insertError || !inserted) {
    console.error('[einvoicing/received/sync] insert received_invoices', insertError)
    return NextResponse.json({ error: 'Insertion impossible' }, { status: 500 })
  }

  await admin.from('pa_status_events').insert({
    organization_id: payload.organization_id,
    received_invoice_id: inserted.id,
    pa_message_id: payload.pa_message_id,
    event_type: 'delivered',
    new_status: 'received',
    pa_timestamp: payload.pa_received_at,
  })

  return NextResponse.json({ ok: true, id: inserted.id, already_synced: false })
}
