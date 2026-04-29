import { getChantiers, getChantierStats } from '@/lib/data/queries/chantiers'
import { getClients } from '@/lib/data/queries/clients'
import { getQuotesForLinking } from '@/lib/data/queries/quotes'
import { hasPermission } from '@/lib/data/queries/membership'
import ChantiersClient from './ChantiersClient'

export default async function ChantiersPage() {
  const [chantiers, stats, clients, linkableQuotes, canCreate, canDelete] = await Promise.all([
    getChantiers(),
    getChantierStats(),
    getClients(),
    getQuotesForLinking(),
    hasPermission('chantiers.create'),
    hasPermission('chantiers.delete'),
  ])

  return <ChantiersClient initialChantiers={chantiers} stats={stats} clients={clients} linkableQuotes={linkableQuotes} canCreate={canCreate} canDelete={canDelete} />
}
