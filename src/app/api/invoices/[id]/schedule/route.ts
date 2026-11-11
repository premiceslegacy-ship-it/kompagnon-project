import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { hasPermission } from '@/lib/data/queries/membership'
import { getIssuedInvoiceCreditTotals } from '@/lib/data/queries/invoices'
import { roundMoney } from '@/lib/utils/money'

export async function GET(_req: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise
  const supabase = await createClient()
  if (!(await hasPermission('invoices.record_payment'))) {
    return NextResponse.json({ error: 'Permission refusée.' }, { status: 403 })
  }
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })

  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices')
    .select('status, invoice_type, total_ttc, total_paid')
    .eq('id', params.id)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (invoiceError) return NextResponse.json({ error: invoiceError.message }, { status: 500 })
  if (!invoice) return NextResponse.json({ error: 'Facture introuvable.' }, { status: 404 })
  let creditedTtc = 0
  if (invoice.invoice_type !== 'avoir') {
    try {
      creditedTtc = (await getIssuedInvoiceCreditTotals([params.id])).get(params.id) ?? 0
    } catch {
      return NextResponse.json({ error: 'Impossible de vérifier les avoirs émis de cette facture.' }, { status: 409 })
    }
  }
  

  const { data, error } = await supabase
    .from('invoice_payment_schedule')
    .select('id, label, due_date, amount, amount_type, percentage, position, paid_payment_id')
    .eq('invoice_id', params.id)
    .eq('organization_id', orgId)
    .order('position', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const scheduleItems = data ?? []
  const scheduleIds = scheduleItems.map(item => item.id)
  const paidBySchedule = new Map<string, number>()
  if (scheduleIds.length > 0) {
    const { data: payments, error: paymentsError } = await supabase
      .from('payments')
      .select('payment_schedule_id, amount')
      .eq('invoice_id', params.id)
      .eq('organization_id', orgId)
      .in('payment_schedule_id', scheduleIds)

    if (paymentsError) return NextResponse.json({ error: paymentsError.message }, { status: 500 })
    for (const payment of payments ?? []) {
      const scheduleId = payment.payment_schedule_id
      if (!scheduleId) continue
      paidBySchedule.set(scheduleId, roundMoney((paidBySchedule.get(scheduleId) ?? 0) + (Number(payment.amount) || 0)))
    }
  }

  const invoiceTtc = roundMoney(Number(invoice.total_ttc) || 0)
  const invoicePaid = roundMoney(Number(invoice.total_paid) || 0)
  const invoiceOutstanding = invoice.invoice_type === 'avoir' || invoice.status === 'paid'
    ? 0
    : Math.max(0, roundMoney(invoiceTtc - invoicePaid - creditedTtc))
  const invoiceNotPayable = invoice.invoice_type === 'avoir' || invoice.status === 'paid' || invoiceOutstanding === 0

  let scheduleInvoiceOutstanding = invoiceOutstanding
  const schedule = scheduleItems.map(item => {
    // Match record_invoice_schedule_payment: percentage installments are rounded
    // from the invoice TTC, never from the stored amount column.
    const amount = item.amount_type === 'percentage'
      ? roundMoney(invoiceTtc * ((Number(item.percentage) || 0) / 100))
      : roundMoney(Number(item.amount) || 0)
    const ledgerPaid = paidBySchedule.get(item.id) ?? 0
    const paid_amount = item.paid_payment_id ? Math.max(amount, ledgerPaid) : ledgerPaid
    const installmentOutstanding = Math.max(0, roundMoney(amount - paid_amount))
    const remaining_amount = invoiceNotPayable
      ? 0
      : Math.min(installmentOutstanding, scheduleInvoiceOutstanding)
    scheduleInvoiceOutstanding = Math.max(0, roundMoney(scheduleInvoiceOutstanding - remaining_amount))
    return {
      ...item,
      amount,
      paid_amount,
      remaining_amount,
      is_paid: invoiceNotPayable || item.paid_payment_id !== null || remaining_amount === 0,
    }
  })

  return NextResponse.json({ schedule, invoice_outstanding: invoiceOutstanding })
}
