import { getMaterials, getLaborRates, getPrestationTypes } from '@/lib/data/queries/catalog'
import { getSuppliers } from '@/lib/data/queries/suppliers'
import { getOrganization } from '@/lib/data/queries/organization'
import { isModuleEnabled } from '@/lib/data/queries/organization-modules'
import { resolveCatalogContext } from '@/lib/catalog-context'
import CatalogClient from './CatalogClient'

export default async function CatalogPage() {
  const [materials, laborRates, prestationTypes, suppliers, organization, catalogAIEnabled] = await Promise.all([
    getMaterials(),
    getLaborRates(),
    getPrestationTypes(true),
    getSuppliers(),
    getOrganization(),
    isModuleEnabled('catalog_ai'),
  ])

  const catalogContext = resolveCatalogContext(organization)

  return (
    <CatalogClient
      initialMaterials={materials}
      initialLaborRates={laborRates}
      initialPrestationTypes={prestationTypes}
      initialSuppliers={suppliers}
      catalogContext={catalogContext}
      catalogAIEnabled={catalogAIEnabled}
    />
  )
}
