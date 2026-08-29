import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from './clients'

export type ReceivedInvoiceForExport = {
  id: string
  invoice_number: string
  invoice_date: string
  supplier_siret: string | null
  supplier_name: string
  total_ht: number
  total_tva: number
  total_ttc: number
  pa_message_id: string | null
}

export async function getReceivedInvoicesForExport(
  from: string,
  to: string,
): Promise<ReceivedInvoiceForExport[]> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  const { data, error } = await supabase
    .from('received_invoices')
    .select('id, invoice_number, invoice_date, supplier_siret, supplier_name, total_ht, total_tva, total_ttc, pa_message_id')
    .eq('organization_id', orgId)
    .neq('status', 'rejected')
    .gte('invoice_date', from)
    .lte('invoice_date', to)
    .order('invoice_date', { ascending: true })

  if (error) {
    console.error('[getReceivedInvoicesForExport]', error)
    return []
  }

  return (data ?? []).map(ri => ({
    ...ri,
    total_ht: ri.total_ht ?? 0,
    total_tva: ri.total_tva ?? 0,
    total_ttc: ri.total_ttc ?? 0,
  })) as ReceivedInvoiceForExport[]
}

export type ReceivedInvoiceStatus = 'received' | 'verified' | 'accounted' | 'rejected'

export type ReceivedInvoice = {
  id: string
  pa_message_id: string | null
  supplier_name: string
  supplier_siren: string | null
  invoice_number: string
  invoice_date: string
  due_date: string | null
  total_ht: number
  total_tva: number
  total_ttc: number
  status: ReceivedInvoiceStatus
  rejection_reason: string | null
  chantier_id: string | null
  chantier_title: string | null
}

export async function getReceivedInvoices(): Promise<ReceivedInvoice[]> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  const { data, error } = await supabase
    .from('received_invoices')
    .select(`
      id, pa_message_id, supplier_name, supplier_siren,
      invoice_number, invoice_date, due_date,
      total_ht, total_tva, total_ttc, status, rejection_reason,
      chantier_id, chantier:chantiers(id, title)
    `)
    .eq('organization_id', orgId)
    .order('invoice_date', { ascending: false })

  if (error) {
    console.error('[getReceivedInvoices]', error)
    return []
  }

  return (data ?? []).map(ri => {
    const chantier = Array.isArray(ri.chantier) ? ri.chantier[0] : ri.chantier
    return {
      id: ri.id,
      pa_message_id: ri.pa_message_id,
      supplier_name: ri.supplier_name,
      supplier_siren: ri.supplier_siren,
      invoice_number: ri.invoice_number,
      invoice_date: ri.invoice_date,
      due_date: ri.due_date,
      total_ht: ri.total_ht ?? 0,
      total_tva: ri.total_tva ?? 0,
      total_ttc: ri.total_ttc ?? 0,
      status: ri.status,
      rejection_reason: ri.rejection_reason,
      chantier_id: ri.chantier_id,
      chantier_title: chantier?.title ?? null,
    }
  }) as ReceivedInvoice[]
}
