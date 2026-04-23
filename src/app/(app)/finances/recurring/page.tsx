import { getClients } from '@/lib/data/queries/clients'
import { getRecurringInvoices, getPendingSchedules } from '@/lib/data/queries/recurring'
import { getMaterials, getLaborRates, getPrestationTypes } from '@/lib/data/queries/catalog'
import { getInvoiceById } from '@/lib/data/queries/invoices'
import { getOrganization } from '@/lib/data/queries/organization'
import RecurringClient from './RecurringClient'

export default async function RecurringPage({
  searchParams,
}: {
  searchParams: { from_invoice?: string }
}) {
  const [clients, recurringInvoices, pendingSchedules, materials, laborRates, prestationTypes, organization] = await Promise.all([
    getClients(),
    getRecurringInvoices(),
    getPendingSchedules(),
    getMaterials(),
    getLaborRates(),
    getPrestationTypes(),
    getOrganization(),
  ])

  // Pré-remplir le formulaire depuis une facture existante
  const sourceInvoice = searchParams.from_invoice
    ? await getInvoiceById(searchParams.from_invoice)
    : null

  const fromInvoice = sourceInvoice
    ? {
        title: sourceInvoice.title ?? '',
        clientId: sourceInvoice.client_id ?? '',
        items: (sourceInvoice.items ?? []).map((i, idx) => ({
          id: idx + 1,
          desc: i.description ?? '',
          qty: i.quantity,
          unit: i.unit ?? '',
          pu: i.unit_price,
          vat: i.vat_rate ?? (organization?.is_vat_subject === false ? 0 : (organization?.default_vat_rate ?? 20)),
          is_internal: i.is_internal ?? false,
        })),
      }
    : null

  return (
    <RecurringClient
      clients={clients}
      recurringInvoices={recurringInvoices}
      pendingSchedules={pendingSchedules}
      materials={materials}
      laborRates={laborRates}
      prestationTypes={prestationTypes}
      fromInvoice={fromInvoice}
      vatConfig={{
        isVatSubject: organization?.is_vat_subject ?? true,
        defaultVatRate: organization?.default_vat_rate ?? 20,
      }}
    />
  )
}
