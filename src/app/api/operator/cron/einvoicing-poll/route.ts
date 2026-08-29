import { NextRequest, NextResponse } from 'next/server'
import { createOperatorAdminClient } from '@/lib/supabase/operator'
import { verifyCronSecret } from '@/lib/cron-auth'
import { signOperatorPayload } from '@/lib/operator'
import { listReceivedInvoices, getInvoiceDetail } from '@/lib/super-pdp/client'
import type { SuperPdpInvoice } from '@/lib/super-pdp/types'

export const dynamic = 'force-dynamic'

// Polling de réception Super PDP (Phase 3), toutes les 15 min via le worker
// operator-cron. Facultatif par client : seules les organisations avec
// reception_enabled=true sont pollées (voir docs/atelier-facturation-electronique.md §7.5).
//
// Le cockpit ne touche jamais la DB d'une instance cliente : chaque facture neuve
// est transmise via un POST signé HMAC vers /api/einvoicing/received/sync côté
// instance, qui l'insère dans sa propre DB.
//
// en_invoice (JSON EN 16931 normalisé) peut ne pas être rempli immédiatement
// après réception (traitement asynchrone côté Super PDP, non confirmé en délai —
// voir §15 de la doc). Une facture sans en_invoice exploitable est laissée de
// côté et retentée au poll suivant : le curseur n'avance que sur les factures
// pleinement exploitées, jamais sur les stubs incomplets.

const PAGE_SIZE = 500

type ReceptionStateRow = {
  source_instance: string
  organization_id: string
  last_synced_invoice_id: string | null
  consecutive_errors: number
}

type ClientRow = { source_instance: string; organization_id: string }
type SettingRow = { source_instance: string; organization_id: string; app_url: string | null }

async function collectPages<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const page = data ?? []
    rows.push(...page)
    if (page.length < PAGE_SIZE) return rows
  }
}

// Forme EN 16931 non confirmée par un exemple rempli réel (voir §15) — extraction
// volontairement défensive, chemins les plus courants du profil Comfort/EN16931.
function extractInvoiceFields(enInvoice: Record<string, unknown>): {
  supplierSiren: string
  supplierSiret: string | null
  supplierName: string
  supplierVat: string | null
  invoiceNumber: string
  invoiceDate: string
  dueDate: string | null
  totalHt: number
  totalTva: number
  totalTtc: number
} | null {
  const seller = (enInvoice.seller ?? enInvoice.supplier ?? {}) as Record<string, unknown>
  const totals = (enInvoice.totals ?? enInvoice.monetary_summary ?? {}) as Record<string, unknown>

  const supplierSiren = String(seller.siren ?? seller.registration_number ?? '').trim()
  const supplierName = String(seller.name ?? seller.trade_name ?? seller.legal_name ?? '').trim()
  const invoiceNumber = String(enInvoice.invoice_number ?? enInvoice.number ?? '').trim()
  const invoiceDate = String(enInvoice.invoice_date ?? enInvoice.issue_date ?? '').trim()
  const totalHt = Number(totals.total_ht ?? totals.tax_exclusive_amount ?? Number.NaN)
  const totalTva = Number(totals.total_tva ?? totals.tax_amount ?? Number.NaN)
  const totalTtc = Number(totals.total_ttc ?? totals.tax_inclusive_amount ?? Number.NaN)

  if (!supplierSiren || !supplierName || !invoiceNumber || !invoiceDate) return null
  if (!Number.isFinite(totalHt) || !Number.isFinite(totalTva) || !Number.isFinite(totalTtc)) return null

  return {
    supplierSiren,
    supplierSiret: seller.siret ? String(seller.siret) : null,
    supplierName,
    supplierVat: seller.vat_number ? String(seller.vat_number) : null,
    invoiceNumber,
    invoiceDate,
    dueDate: enInvoice.due_date ? String(enInvoice.due_date) : null,
    totalHt,
    totalTva,
    totalTtc,
  }
}

async function pollOneClient(
  operator: ReturnType<typeof createOperatorAdminClient>,
  client: ClientRow,
  appUrl: string,
  secret: string,
  state: ReceptionStateRow | undefined,
): Promise<{ synced: number; error: string | null }> {
  const listResult = await listReceivedInvoices(client.source_instance, client.organization_id, state?.last_synced_invoice_id ?? null)
  if (!listResult.ok) {
    return { synced: 0, error: listResult.message }
  }

  const received = listResult.data.data.filter((invoice) => invoice.direction === 'in')
  if (received.length === 0) {
    return { synced: 0, error: null }
  }

  let synced = 0
  let cursor = state?.last_synced_invoice_id ?? null

  // order=desc : on retraite du plus ancien au plus récent pour avancer le
  // curseur de façon strictement croissante et idempotente.
  const ordered = [...received].sort((a, b) => a.id - b.id)

  for (const invoice of ordered) {
    const detailResult = await getInvoiceDetail(client.source_instance, client.organization_id, String(invoice.id))
    const detail: SuperPdpInvoice | null = detailResult.ok ? detailResult.data : null
    const enInvoice = detail?.en_invoice && typeof detail.en_invoice === 'object'
      ? detail.en_invoice as Record<string, unknown>
      : null

    const fields = enInvoice ? extractInvoiceFields(enInvoice) : null
    if (!fields) {
      // Traitement Super PDP pas encore terminé pour cette facture : on
      // n'avance pas le curseur au-delà, elle sera retentée au poll suivant.
      break
    }

    const body = JSON.stringify({
      source_instance: client.source_instance,
      organization_id: client.organization_id,
      pa_message_id: String(invoice.id),
      pa_received_at: invoice.created_at,
      supplier_siren: fields.supplierSiren,
      supplier_siret: fields.supplierSiret,
      supplier_name: fields.supplierName,
      supplier_vat: fields.supplierVat,
      invoice_number: fields.invoiceNumber,
      invoice_date: fields.invoiceDate,
      due_date: fields.dueDate,
      total_ht: fields.totalHt,
      total_tva: fields.totalTva,
      total_ttc: fields.totalTtc,
    })
    const signature = signOperatorPayload(body, secret)

    try {
      const resp = await fetch(`${appUrl}/api/einvoicing/received/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-operator-signature': signature },
        body,
      })
      if (!resp.ok) {
        break
      }
    } catch {
      break
    }

    cursor = String(invoice.id)
    synced++
  }

  await operator.from('super_pdp_reception_state').upsert({
    source_instance: client.source_instance,
    organization_id: client.organization_id,
    last_synced_invoice_id: cursor,
    last_polled_at: new Date().toISOString(),
    last_success_at: new Date().toISOString(),
    last_error: null,
    consecutive_errors: 0,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'source_instance,organization_id' })

  return { synced, error: null }
}

export async function POST(req: NextRequest) {
  if (process.env.OPERATOR_MODE !== 'true') {
    return NextResponse.json({ error: 'Not available' }, { status: 404 })
  }
  if (!verifyCronSecret(req.headers.get('x-cron-secret'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const secret = process.env.OPERATOR_CONFIG_SYNC_SECRET?.trim()
    || process.env.OPERATOR_INGEST_SECRET?.trim()
  if (!secret) {
    return NextResponse.json({ error: 'Operator config sync secret missing' }, { status: 500 })
  }

  const operator = createOperatorAdminClient()

  const clients = await collectPages<ClientRow>((from, to) => operator
    .from('operator_client_subscriptions')
    .select('source_instance, organization_id')
    .eq('super_pdp_reception_enabled', true)
    .range(from, to))

  if (clients.length === 0) {
    return NextResponse.json({ polled: 0, synced: 0, failed: 0 })
  }

  const settings = await collectPages<SettingRow>((from, to) => operator
    .from('operator_client_settings')
    .select('source_instance, organization_id, app_url')
    .range(from, to))
  const appUrlByOrg = new Map(settings.map((s) => [`${s.source_instance}::${s.organization_id}`, s.app_url]))

  const states = await collectPages<ReceptionStateRow>((from, to) => operator
    .from('super_pdp_reception_state')
    .select('source_instance, organization_id, last_synced_invoice_id, consecutive_errors')
    .range(from, to))
  const stateByOrg = new Map(states.map((s) => [`${s.source_instance}::${s.organization_id}`, s]))

  let polled = 0
  let syncedTotal = 0
  let failed = 0

  for (const client of clients) {
    const key = `${client.source_instance}::${client.organization_id}`
    const appUrl = appUrlByOrg.get(key)
    if (!appUrl) continue

    polled++
    try {
      const result = await pollOneClient(operator, client, appUrl, secret, stateByOrg.get(key))
      if (result.error) {
        failed++
        const state = stateByOrg.get(key)
        await operator.from('super_pdp_reception_state').upsert({
          source_instance: client.source_instance,
          organization_id: client.organization_id,
          last_synced_invoice_id: state?.last_synced_invoice_id ?? null,
          last_polled_at: new Date().toISOString(),
          last_error: result.error,
          consecutive_errors: (state?.consecutive_errors ?? 0) + 1,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'source_instance,organization_id' })
      } else {
        syncedTotal += result.synced
      }
    } catch (err) {
      failed++
      console.error('[operator/cron/einvoicing-poll]', client.source_instance, client.organization_id, err)
    }
  }

  console.log(`[operator/cron/einvoicing-poll] polled=${polled} synced=${syncedTotal} failed=${failed}`)
  return NextResponse.json({ polled, synced: syncedTotal, failed })
}
