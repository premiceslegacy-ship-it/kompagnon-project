import { getClients } from '@/lib/data/queries/clients'
import { hasPermission } from '@/lib/data/queries/membership'
import ClientsClient from './ClientsClient'

export default async function ClientsPage() {
  const [clients, canCreate, canEdit, canDelete, canImport] = await Promise.all([
    getClients(),
    hasPermission('clients.create'),
    hasPermission('clients.edit'),
    hasPermission('clients.delete'),
    hasPermission('import.clients'),
  ])
  return <ClientsClient initialClients={clients} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} canImport={canImport} />
}
