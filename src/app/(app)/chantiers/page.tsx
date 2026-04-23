import { getChantiers, getChantierStats } from '@/lib/data/queries/chantiers'
import { getClients } from '@/lib/data/queries/clients'
import { getQuotesForLinking } from '@/lib/data/queries/quotes'
import ChantiersClient from './ChantiersClient'

export default async function ChantiersPage() {
  const [chantiers, stats, clients, linkableQuotes] = await Promise.all([
    getChantiers(),
    getChantierStats(),
    getClients(),
    getQuotesForLinking(),
  ])

  return <ChantiersClient initialChantiers={chantiers} stats={stats} clients={clients} linkableQuotes={linkableQuotes} />
}
