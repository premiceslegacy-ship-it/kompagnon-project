import { getQuotes } from '@/lib/data/queries/quotes'
import { getInvoices } from '@/lib/data/queries/invoices'
import FinancesClient from './FinancesClient'

export default async function FinancesPage() {
  const [quotes, invoices] = await Promise.all([getQuotes(), getInvoices()])
  return <FinancesClient initialQuotes={quotes} initialInvoices={invoices} />
}
