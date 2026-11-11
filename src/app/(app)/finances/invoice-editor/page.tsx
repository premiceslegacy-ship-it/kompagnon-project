import { getClients, getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { getAcceptedQuotesWithItems } from '@/lib/data/queries/quotes'
import { getInvoiceById } from '@/lib/data/queries/invoices'
import { getMaterials, getLaborRates, getPrestationTypes } from '@/lib/data/queries/catalog'
import { getOrganization } from '@/lib/data/queries/organization'
import { getChantiers } from '@/lib/data/queries/chantiers'
import { resolveCatalogContext } from '@/lib/catalog-context'
import { hasPermission } from '@/lib/data/queries/membership'
import { AccessDenied } from '@/components/errors/AccessDenied'
import InvoiceEditorClient from './InvoiceEditorClient'
import { loadInvoiceAuthorityForPdf } from '@/lib/pdf/server'
import type { InvoiceDerivedTotals } from './invoiceEditorModel'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function InvoiceEditorPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ id?: string; chantier?: string; returnTo?: string }>
}) {
  const searchParams = await searchParamsPromise
  const canCreate = await hasPermission('invoices.create')
  const [canEdit, canView] = searchParams.id
    ? await Promise.all([hasPermission('invoices.edit'), hasPermission('invoices.view')])
    : [false, false]
  if (!searchParams.id && !canCreate) return <AccessDenied what="l’éditeur de factures" />
  if (searchParams.id && !canEdit && !canView) return <AccessDenied what="cette facture" />

  const existingInvoice = searchParams.id ? await getInvoiceById(searchParams.id) : null
  if (searchParams.id && !existingInvoice) return <AccessDenied what="cette facture" />
  if (existingInvoice?.status === 'draft' && !canEdit) return <AccessDenied what="modifier cette facture" />
  if (existingInvoice && existingInvoice.status !== 'draft' && !canView) return <AccessDenied what="voir cette facture" />

  if (existingInvoice && existingInvoice.status !== 'draft') {
    return (
      <InvoiceEditorClient
        clients={[]}
        acceptedQuotes={[]}
        existingInvoice={existingInvoice}
        materials={[]}
        laborRates={[]}
        prestationTypes={[]}
        catalogContext={resolveCatalogContext(null)}
        linkableChantiers={[]}
        defaultChantierId={null}
        returnTo={searchParams.returnTo ?? null}
        vatConfig={{ isVatSubject: true, defaultVatRate: 20 }}
        derivedTotals={null}
      />
    )
  }

  const [clients, acceptedQuotes, materials, laborRates, prestationTypes, organization, chantiers] = await Promise.all([
    getClients(),
    getAcceptedQuotesWithItems(),
    getMaterials(),
    getLaborRates(),
    getPrestationTypes(),
    getOrganization(),
    getChantiers(),
  ])


  const catalogContext = resolveCatalogContext(organization)
  let vatConfig = {
    isVatSubject: organization?.is_vat_subject ?? true,
    defaultVatRate: organization?.default_vat_rate ?? 20,
  }
  let derivedTotals: InvoiceDerivedTotals | null = null
  if (existingInvoice?.invoice_type === 'solde' || existingInvoice?.invoice_type === 'avoir') {
    const orgId = await getCurrentOrganizationId()
    const source = orgId ? await loadInvoiceAuthorityForPdf(existingInvoice.id, orgId) : null
    if (source?.status !== 'draft' && source) {
      const query = new URLSearchParams({ id: existingInvoice.id })
      if (searchParams.returnTo) query.set('returnTo', searchParams.returnTo)
      redirect(`/finances/invoice-editor?${query}`)
    }
    const record = source?.invoiceRecord
    if (!source || !record || !record.vat_breakdown
        || record.total_ht == null || record.total_tva == null || record.total_ttc == null) {
      throw new Error('Le décompte de ce brouillon doit être recréé depuis son document source vérifié.')
    }
    const vatByRate: Record<number, number> = {}
    for (const bucket of record.vat_breakdown) vatByRate[bucket.rate] = bucket.tax_amount
    derivedTotals = { totalHt: record.total_ht, totalTva: record.total_tva, totalTtc: record.total_ttc, vatByRate }
    vatConfig = {
      isVatSubject: source.organization.is_vat_subject !== false,
      defaultVatRate: record.vat_breakdown[0]?.rate ?? 0,
    }
  }

  const linkableChantiers = chantiers.map(c => ({
    id: c.id,
    title: c.title,
    client_id: (c as any).client?.id ?? null,
    quote_id: (c as any).quote_id ?? null,
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
      vatConfig={vatConfig}
      derivedTotals={derivedTotals}
    />
  )
}
