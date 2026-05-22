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
