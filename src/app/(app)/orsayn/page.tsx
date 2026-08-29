import { notFound } from 'next/navigation'
import { getCockpitData } from './data'
import Dashboard from './Dashboard'

export default async function OrsaynPage() {
  const data = await getCockpitData()
  if (!data) notFound()

  return <Dashboard data={data} />
}
