import { getClients } from '@/lib/data/queries/clients'
import { getAcceptedQuotesWithItems } from '@/lib/data/queries/quotes'
import { getInvoiceById } from '@/lib/data/queries/invoices'
import { getMaterials, getLaborRates, getPrestationTypes } from '@/lib/data/queries/catalog'
import { getOrganization } from '@/lib/data/queries/organization'
import { resolveCatalogContext } from '@/lib/catalog-context'
import InvoiceEditorClient from './InvoiceEditorClient'

export default async function InvoiceEditorPage({
  searchParams,
}: {
  searchParams: { id?: string }
}) {
  const [clients, acceptedQuotes, materials, laborRates, prestationTypes, organization] = await Promise.all([
    getClients(),
    getAcceptedQuotesWithItems(),
    getMaterials(),
    getLaborRates(),
    getPrestationTypes(),
    getOrganization(),
  ])

  const existingInvoice = searchParams.id
    ? await getInvoiceById(searchParams.id)
    : null

  const catalogContext = resolveCatalogContext(organization)

  return (
    <InvoiceEditorClient
      clients={clients}
      acceptedQuotes={acceptedQuotes}
      existingInvoice={existingInvoice}
      materials={materials}
      laborRates={laborRates}
      prestationTypes={prestationTypes}
      catalogContext={catalogContext}
      vatConfig={{
        isVatSubject: organization?.is_vat_subject ?? true,
        defaultVatRate: organization?.default_vat_rate ?? 20,
      }}
    />
  )
}
