import { getQuotes } from '@/lib/data/queries/quotes'
import { getInvoices } from '@/lib/data/queries/invoices'
import { hasPermission } from '@/lib/data/queries/membership'
import FinancesClient from './FinancesClient'

export default async function FinancesPage() {
  const [quotes, invoices, canCreateQuote, canEditQuote, canSendQuote, canDeleteQuote, canCreateInvoice, canSendInvoice, canRecordPayment, canDeleteInvoice] = await Promise.all([
    getQuotes(),
    getInvoices(),
    hasPermission('quotes.create'),
    hasPermission('quotes.edit'),
    hasPermission('quotes.send'),
    hasPermission('quotes.delete'),
    hasPermission('invoices.create'),
    hasPermission('invoices.send'),
    hasPermission('invoices.record_payment'),
    hasPermission('invoices.delete'),
  ])
  return (
    <FinancesClient
      initialQuotes={quotes}
      initialInvoices={invoices}
      canCreateQuote={canCreateQuote}
      canEditQuote={canEditQuote}
      canSendQuote={canSendQuote}
      canDeleteQuote={canDeleteQuote}
      canCreateInvoice={canCreateInvoice}
      canSendInvoice={canSendInvoice}
      canRecordPayment={canRecordPayment}
      canDeleteInvoice={canDeleteInvoice}
    />
  )
}
