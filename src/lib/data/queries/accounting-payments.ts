import { createClient } from '@/lib/supabase/server'
import { AccountingExportAuthorityError } from '@/lib/exports/vat-rules'
import { getInvoiceExportRecordsByIds, type InvoiceForExport } from './invoices'

export type AccountingPaymentForExport = {
  id: string
  invoice: InvoiceForExport
  amount: number
  payment_date: string
  reference: string | null
  prior_paid_amount: number
}

export type CreditNoteSourceForExport = {
  invoice_type: string
  paid_amount_before_credit: number
}

type PaymentLedgerRow = {
  id: string
  invoice_id: string | null
  amount: number
  payment_date: string
  reference: string | null
  prior_paid_amount: number
}

type CreditLedgerRow = {
  id: string
  source_invoice_id: string | null
  issue_date: string | null
  paid_amount_before_credit: number
}

export async function getAccountingPaymentData(
  from: string,
  to: string,
  options: { includePayments: boolean; creditNotes: readonly InvoiceForExport[] },
): Promise<{
  payments: AccountingPaymentForExport[]
  creditNoteSources: Map<string, CreditNoteSourceForExport>
}> {
  const empty = { payments: [], creditNoteSources: new Map<string, CreditNoteSourceForExport>() }
  if (!options.includePayments && options.creditNotes.length === 0) return empty
  if (options.creditNotes.some(credit => !credit.credit_note_for)) {
    throw new AccountingExportAuthorityError('La facture d’origine d’un avoir n’est pas présente dans son autorité figée.')
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_accounting_payment_ledger', {
    p_from: from,
    p_to: to,
    p_credit_note_ids: options.creditNotes.map(credit => credit.id),
    p_include_payments: options.includePayments,
  })
  if (error) throw error
  if (!data || !Array.isArray(data.payments) || !Array.isArray(data.credit_notes)) {
    throw new AccountingExportAuthorityError('Le registre des règlements n’a pas pu être vérifié.')
  }
  const ledger = data as { payments: PaymentLedgerRow[]; credit_notes: CreditLedgerRow[] }
  const contextIds = new Set<string>()
  for (const payment of ledger.payments) {
    if (!payment.invoice_id) {
      throw new AccountingExportAuthorityError('Un règlement sélectionné n’est rattaché à aucune facture vérifiable.')
    }
    contextIds.add(payment.invoice_id)
  }
  for (const credit of ledger.credit_notes) {
    if (!credit.source_invoice_id) throw new AccountingExportAuthorityError('La facture d’origine d’un avoir est introuvable.')
    contextIds.add(credit.source_invoice_id)
  }
  const contexts = new Map<string, InvoiceForExport>()
  const ids = [...contextIds]
  for (let offset = 0; offset < ids.length; offset += 100) {
    for (const invoice of await getInvoiceExportRecordsByIds(ids.slice(offset, offset + 100))) {
      contexts.set(invoice.id, invoice)
    }
  }

  const payments = ledger.payments.map(payment => {
    const invoice = contexts.get(payment.invoice_id!)
    const amount = Number(payment.amount)
    const priorPaid = Number(payment.prior_paid_amount)
    if (!invoice || invoice.invoice_type === 'avoir' || !payment.payment_date
        || !Number.isFinite(amount) || amount <= 0 || !Number.isFinite(priorPaid) || priorPaid < 0) {
      throw new AccountingExportAuthorityError('Un règlement sélectionné ne dispose pas d’une autorité comptable vérifiable.')
    }
    return {
      id: payment.id, invoice, amount, payment_date: payment.payment_date,
      reference: payment.reference, prior_paid_amount: priorPaid,
    }
  })

  const ledgerCredits = new Map(ledger.credit_notes.map(credit => [credit.id, credit]))
  const creditNoteSources = new Map<string, CreditNoteSourceForExport>()
  for (const credit of options.creditNotes) {
    const recorded = ledgerCredits.get(credit.id)
    const source = recorded?.source_invoice_id ? contexts.get(recorded.source_invoice_id) : null
    const paidBefore = Number(recorded?.paid_amount_before_credit)
    if (!recorded || recorded.source_invoice_id !== credit.credit_note_for || recorded.issue_date !== credit.issue_date
        || !source || source.invoice_type === 'avoir' || !Number.isFinite(paidBefore) || paidBefore < 0) {
      throw new AccountingExportAuthorityError('Le rattachement historique d’un avoir ne peut pas être vérifié.')
    }
    if (source.total_ht !== credit.total_ht || source.total_tva !== credit.total_tva || source.total_ttc !== credit.total_ttc) {
      throw new AccountingExportAuthorityError('Cet avoir partiel nécessite un décompte comptable vérifié avant son export.')
    }
    creditNoteSources.set(credit.id, { invoice_type: source.invoice_type, paid_amount_before_credit: paidBefore })
  }
  return { payments, creditNoteSources }
}
