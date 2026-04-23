import { getClients } from '@/lib/data/queries/clients'
import ClientsClient from './ClientsClient'

export default async function ClientsPage() {
  const clients = await getClients()
  return <ClientsClient initialClients={clients} />
}
