import { notFound } from 'next/navigation'
import { getClients } from '@/lib/data/queries/clients'
import { getQuoteById, getQuotesForLinking, getQuoteVariants } from '@/lib/data/queries/quotes'
import { getSupplierPriceRequestsForQuote } from '@/lib/data/queries/supplier-price-requests'
import { getSuppliers } from '@/lib/data/queries/suppliers'
import { getMaterials, getLaborRates, getPrestationTypes } from '@/lib/data/queries/catalog'
import { getQuoteClauseTemplates } from '@/lib/data/queries/clause-templates'
import { getOrganization } from '@/lib/data/queries/organization'
import { resolveCatalogContext } from '@/lib/catalog-context'
import { getOrganizationModules } from '@/lib/data/queries/organization-modules'
import { getMetalPriceGrids } from '@/lib/data/mutations/metal-price-grids'
import { getMetalPriceSnapshotsForQuote } from '@/lib/data/queries/metal-price-snapshots'
import QuoteEditorClient from './QuoteEditorClient'

export default async function QuoteEditorPage({
  searchParams,
}: {
  searchParams: { id?: string; client?: string; returnTo?: string }
}) {
  const [clients, materials, laborRates, prestationTypes, organization, modules, allQuotes, metalPriceGrids, clauseTemplates, allSuppliers] = await Promise.all([
    getClients(),
    getMaterials(),
    getLaborRates(),
    getPrestationTypes(),
    getOrganization(),
    getOrganizationModules(),
    getQuotesForLinking(),
    getMetalPriceGrids(),
    getQuoteClauseTemplates(),
    getSuppliers(),
  ])

  let initialQuote = null
  let initialVariants: import('@/lib/data/queries/quotes').QuoteVariantStub[] = []
  let initialPriceRequests: import('@/lib/data/mutations/supplier-price-requests').SupplierPriceRequest[] = []
  if (searchParams.id) {
    initialQuote = await getQuoteById(searchParams.id)
    if (!initialQuote) notFound()
    const [variants, priceRequests] = await Promise.all([
      initialQuote.variant_group_id ? getQuoteVariants(initialQuote.variant_group_id) : Promise.resolve([]),
      getSupplierPriceRequestsForQuote(searchParams.id),
    ])
    initialVariants = variants
    initialPriceRequests = priceRequests
  }

  const hasMetalPricing = organization?.has_metal_pricing ?? false
  const initialMetalSnapshots = hasMetalPricing && searchParams.id
    ? await getMetalPriceSnapshotsForQuote(searchParams.id)
    : []

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
      allQuotes={allQuotes}
      hasMetalPricing={hasMetalPricing}
      metalPriceGrids={metalPriceGrids}
      initialMetalSnapshots={initialMetalSnapshots}
      clauseTemplates={clauseTemplates}
      initialVariants={initialVariants}
      initialPriceRequests={initialPriceRequests}
      allSuppliers={allSuppliers}
      orgForMentions={organization ? {
        name: organization.name,
        siret: organization.siret ?? null,
        rcs: organization.rcs ?? null,
        vat_number: organization.vat_number ?? null,
        is_vat_subject: organization.is_vat_subject ?? true,
        address_line1: organization.address_line1 ?? null,
        postal_code: organization.postal_code ?? null,
        city: organization.city ?? null,
        phone: organization.phone ?? null,
        email: organization.email ?? null,
        insurance_info: organization.insurance_info ?? null,
        decennale_enabled: organization.decennale_enabled ?? null,
        forme_juridique: organization.forme_juridique ?? null,
        late_penalty_rate: organization.late_penalty_rate ?? null,
        payment_terms_days: organization.payment_terms_days ?? null,
        iban: organization.iban ?? null,
      } : null}
      vatConfig={{
        isVatSubject: organization?.is_vat_subject ?? true,
        defaultVatRate: organization?.default_vat_rate ?? 20,
        defaultQuoteValidityDays: organization?.default_quote_validity_days ?? 30,
        defaultShowSectionSubtotals: organization?.default_show_section_subtotals ?? false,
      }}
    />
  )
}
