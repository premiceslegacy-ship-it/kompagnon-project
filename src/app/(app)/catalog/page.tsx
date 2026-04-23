import { getMaterials, getLaborRates, getPrestationTypes } from '@/lib/data/queries/catalog'
import { getOrganization } from '@/lib/data/queries/organization'
import { resolveCatalogContext } from '@/lib/catalog-context'
import CatalogClient from './CatalogClient'

export default async function CatalogPage() {
  const [materials, laborRates, prestationTypes, organization] = await Promise.all([
    getMaterials(),
    getLaborRates(),
    getPrestationTypes(true),
    getOrganization(),
  ])

  const catalogContext = resolveCatalogContext(organization)

  return (
    <CatalogClient
      initialMaterials={materials}
      initialLaborRates={laborRates}
      initialPrestationTypes={prestationTypes}
      catalogContext={catalogContext}
    />
  )
}
