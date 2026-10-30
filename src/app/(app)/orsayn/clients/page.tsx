import { notFound } from 'next/navigation'
import { getCockpitData } from '../data'
import ClientsList from '../ClientsList'

export default async function ClientsPage({ searchParams: searchParamsPromise }: { searchParams: Promise<{ filter?: string }> }) {
  const searchParams = await searchParamsPromise
  const data = await getCockpitData()
  if (!data) notFound()

  const initialFilter = ['active', 'archived', 'all', 'sync', 'trial', 'payment'].includes(searchParams?.filter ?? '')
    ? searchParams?.filter as 'active' | 'archived' | 'all' | 'sync' | 'trial' | 'payment'
    : 'active'
  return <ClientsList data={data} initialFilter={initialFilter} />
}
