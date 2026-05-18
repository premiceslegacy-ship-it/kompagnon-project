import { getChantiers } from '@/lib/data/queries/chantiers'
import { getClients } from '@/lib/data/queries/clients'
import { getContracts, getContractTemplateOptions } from '@/lib/data/queries/contracts'
import { hasPermission } from '@/lib/data/queries/membership'
import { getQuotes } from '@/lib/data/queries/quotes'
import ContractsClient from './ContractsClient'

export default async function ContractsPage() {
  const [contracts, clients, chantiers, templates, quotes, canCreate, canEdit, canDelete] = await Promise.all([
    getContracts(),
    getClients(),
    getChantiers(),
    getContractTemplateOptions(),
    getQuotes(),
    hasPermission('contracts.create'),
    hasPermission('contracts.edit'),
    hasPermission('contracts.delete'),
  ])

  return (
    <ContractsClient
      initialContracts={contracts}
      clients={clients}
      chantiers={chantiers}
      templates={templates}
      quotes={quotes}
      canCreate={canCreate}
      canEdit={canEdit}
      canDelete={canDelete}
    />
  )
}

