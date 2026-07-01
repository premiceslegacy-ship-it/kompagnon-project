import { getClients } from '@/lib/data/queries/clients'
import { hasPermission } from '@/lib/data/queries/membership'
import { isModuleEnabled } from '@/lib/data/queries/organization-modules'
import { getOrganization } from '@/lib/data/queries/organization'
import ClientsClient from './ClientsClient'

export default async function ClientsPage() {
  const [clients, canCreate, canEdit, canDelete, canImport, canEmail, hasAI, org] = await Promise.all([
    getClients(),
    hasPermission('clients.create'),
    hasPermission('clients.edit'),
    hasPermission('clients.delete'),
    hasPermission('import.clients'),
    hasPermission('reminders.send_manual'),
    isModuleEnabled('relances_ai'),  // email-draft utilise le module relances_ai — Starter inclus
    getOrganization(),
  ])
  return (
    <ClientsClient
      initialClients={clients}
      canCreate={canCreate}
      canEdit={canEdit}
      canDelete={canDelete}
      canImport={canImport}
      canEmail={canEmail}
      orgEmail={org?.email ?? null}
      orgName={org?.name ?? ''}
      orgSignature={org?.email_signature ?? null}
      hasAI={hasAI}
    />
  )
}
