import { notFound } from 'next/navigation'
import { getCockpitData } from '../../data'
import ClientDetail from '../../ClientDetail'

export default async function ClientPage({ params }: { params: { key: string } }) {
  const data = await getCockpitData()
  if (!data) notFound()

  const key = decodeURIComponent(params.key)
  const row = data.clientRows.find((client) => `${client.sourceInstance}::${client.organizationId ?? '00000000-0000-0000-0000-000000000000'}` === key)
  if (!row) notFound()

  return <ClientDetail row={row} />
}
