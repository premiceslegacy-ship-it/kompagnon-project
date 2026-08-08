import { redirect } from 'next/navigation'
import { getOrganizationModules } from '@/lib/data/queries/organization-modules'
import { getCurrentMembershipContext } from '@/lib/data/queries/membership'
import { getOrganization } from '@/lib/data/queries/organization'
import { inferMeasurementTrades } from '@/lib/plan-measurement'
import AtelierIAClient from './AtelierIAClient'

export default async function AtelierIAPage() {
  const [membership, modules, organization] = await Promise.all([
    getCurrentMembershipContext(),
    getOrganizationModules(),
    getOrganization(),
  ])

  const isOwnerOrAdmin = membership?.roleSlug === 'owner' || membership?.roleSlug === 'admin'
  const hasAIModule = modules.quote_ai || modules.document_import_ai || modules.voice_input

  if (!isOwnerOrAdmin || !hasAIModule) {
    redirect('/dashboard')
  }

  const activityIds = [organization?.business_activity_id, ...(organization?.secondary_activity_ids ?? [])]
    .filter((id): id is NonNullable<typeof id> => Boolean(id))
  return <AtelierIAClient initialMeasurementTrades={inferMeasurementTrades(activityIds, organization?.sector)} />
}
