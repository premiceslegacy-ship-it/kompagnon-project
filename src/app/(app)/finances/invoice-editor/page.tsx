import { getClients } from '@/lib/data/queries/clients'
import { getAcceptedQuotesWithItems } from '@/lib/data/queries/quotes'
import { getInvoiceById } from '@/lib/data/queries/invoices'
import { getMaterials, getLaborRates, getPrestationTypes } from '@/lib/data/queries/catalog'
import { getOrganization } from '@/lib/data/queries/organization'
import { getChantiers } from '@/lib/data/queries/chantiers'
import { resolveCatalogContext } from '@/lib/catalog-context'
import InvoiceEditorClient from './InvoiceEditorClient'

export default async function InvoiceEditorPage({
  searchParams,
}: {
  searchParams: { id?: string; chantier?: string; returnTo?: string }
}) {
  const [clients, acceptedQuotes, materials, laborRates, prestationTypes, organization, chantiers] = await Promise.all([
    getClients(),
    getAcceptedQuotesWithItems(),
    getMaterials(),
    getLaborRates(),
    getPrestationTypes(),
    getOrganization(),
    getChantiers(),
  ])

  const existingInvoice = searchParams.id
    ? await getInvoiceById(searchParams.id)
    : null

  const catalogContext = resolveCatalogContext(organization)

  const linkableChantiers = chantiers.map(c => ({
    id: c.id,
    title: c.title,
    client_id: (c as any).client?.id ?? null,
  }))

  return (
    <InvoiceEditorClient
      clients={clients}
      acceptedQuotes={acceptedQuotes}
      existingInvoice={existingInvoice}
      materials={materials}
      laborRates={laborRates}
      prestationTypes={prestationTypes}
      catalogContext={catalogContext}
      linkableChantiers={linkableChantiers}
      defaultChantierId={searchParams.chantier ?? null}
      returnTo={searchParams.returnTo ?? null}
      vatConfig={{
        isVatSubject: organization?.is_vat_subject ?? true,
        defaultVatRate: organization?.default_vat_rate ?? 20,
      }}
    />
  )
}
