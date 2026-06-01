import { redirect } from 'next/navigation'
import { getOrganizationModules } from '@/lib/data/queries/organization-modules'
import { getCurrentMembershipContext } from '@/lib/data/queries/membership'
import AtelierIAClient from './AtelierIAClient'

export default async function AtelierIAPage() {
  const [membership, modules] = await Promise.all([
    getCurrentMembershipContext(),
    getOrganizationModules(),
  ])

  const isOwnerOrAdmin = membership?.roleSlug === 'owner' || membership?.roleSlug === 'admin'
  const hasAIModule = modules.quote_ai || modules.document_import_ai || modules.voice_input

  if (!isOwnerOrAdmin || !hasAIModule) {
    redirect('/dashboard')
  }

  return <AtelierIAClient />
}
