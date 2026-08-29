import { getQuotes } from '@/lib/data/queries/quotes'
import { getInvoices } from '@/lib/data/queries/invoices'
import { hasPermission } from '@/lib/data/queries/membership'
import { getOrganizationEinvoicingConfig } from '@/lib/data/queries/einvoicing'
import { getReceivedInvoices } from '@/lib/data/queries/received-invoices'
import { getChantiers } from '@/lib/data/queries/chantiers'
import FinancesClient from './FinancesClient'

export default async function FinancesPage() {
  const [quotes, invoices, canCreateQuote, canEditQuote, canSendQuote, canDeleteQuote, canCreateInvoice, canSendInvoice, canRecordPayment, canDeleteInvoice, canCreateSituation, canCreateSolde, einvoicingConfig, canLinkReceivedInvoice] = await Promise.all([
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
    hasPermission('invoices.create_situation'),
    hasPermission('invoices.create_solde'),
    getOrganizationEinvoicingConfig(),
    hasPermission('chantiers.expenses.edit'),
  ])

  const canViewReceivedInvoices =
    einvoicingConfig.mode === 'super_pdp' &&
    einvoicingConfig.oauth_status === 'connected' &&
    einvoicingConfig.reception_enabled === true

  const [receivedInvoices, chantiers] = canViewReceivedInvoices
    ? await Promise.all([getReceivedInvoices(), getChantiers()])
    : [[], []]

  const linkableChantiers = chantiers.map(c => ({
    id: c.id,
    title: c.title,
  }))

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
      canCreateSituation={canCreateSituation}
      canCreateSolde={canCreateSolde}
      canViewReceivedInvoices={canViewReceivedInvoices}
      initialReceivedInvoices={receivedInvoices}
      linkableChantiers={linkableChantiers}
      canLinkReceivedInvoice={canLinkReceivedInvoice}
    />
  )
}
