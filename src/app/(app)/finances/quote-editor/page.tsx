import { notFound } from 'next/navigation'
import { getClients } from '@/lib/data/queries/clients'
import { getQuoteById } from '@/lib/data/queries/quotes'
import { getMaterials, getLaborRates, getPrestationTypes } from '@/lib/data/queries/catalog'
import { getOrganization } from '@/lib/data/queries/organization'
import { resolveCatalogContext } from '@/lib/catalog-context'
import { getOrganizationModules } from '@/lib/data/queries/organization-modules'
import QuoteEditorClient from './QuoteEditorClient'

export default async function QuoteEditorPage({
  searchParams,
}: {
  searchParams: { id?: string; client?: string; returnTo?: string }
}) {
  const [clients, materials, laborRates, prestationTypes, organization, modules] = await Promise.all([
    getClients(),
    getMaterials(),
    getLaborRates(),
    getPrestationTypes(),
    getOrganization(),
    getOrganizationModules(),
  ])

  let initialQuote = null
  if (searchParams.id) {
    initialQuote = await getQuoteById(searchParams.id)
    if (!initialQuote) notFound()
  }

  const catalogContext = resolveCatalogContext(organization)

  return (
    <QuoteEditorClient
      clients={clients}
      initialQuote={initialQuote}
      materials={materials}
      laborRates={laborRates}
      prestationTypes={prestationTypes}
      initialClientId={searchParams.client}
      returnTo={searchParams.returnTo ?? null}
      catalogContext={catalogContext}
      modules={modules}
      vatConfig={{
        isVatSubject: organization?.is_vat_subject ?? true,
        defaultVatRate: organization?.default_vat_rate ?? 20,
        defaultQuoteValidityDays: organization?.default_quote_validity_days ?? 30,
      }}
    />
  )
}
