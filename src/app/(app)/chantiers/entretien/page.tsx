import { fetchMaintenanceContracts } from '@/lib/data/queries/maintenance'
import { getClients } from '@/lib/data/queries/clients'
import { getOrgIndividualMembers } from '@/lib/data/queries/members'
import { getTeamMembers } from '@/lib/data/queries/team'
import { getCurrentUserProfile } from '@/lib/data/queries/user'
import { getQuotesForLinking } from '@/lib/data/queries/quotes'
import { getLaborRates, getMaterials, getPrestationTypes } from '@/lib/data/queries/catalog'
import { getOrganization } from '@/lib/data/queries/organization'
import EntretienClient from './EntretienClient'

export default async function EntretienPage() {
  const [contracts, clients, quotes, ghostMembers, teamMembers, currentUser, materials, laborRates, prestationTypes, org] = await Promise.all([
    fetchMaintenanceContracts(),
    getClients(),
    getQuotesForLinking(),
    getOrgIndividualMembers(),
    getTeamMembers(),
    getCurrentUserProfile(),
    getMaterials(),
    getLaborRates(),
    getPrestationTypes(),
    getOrganization(),
  ])

  return (
    <EntretienClient
      initialContracts={contracts}
      clients={clients}
      quotes={quotes}
      ghostMembers={ghostMembers}
      teamMembers={teamMembers}
      currentUserId={currentUser?.id ?? null}
      currentUserName={currentUser?.full_name ?? currentUser?.email ?? null}
      materials={materials}
      laborRates={laborRates}
      prestationTypes={prestationTypes}
      orgSector={org?.sector ?? null}
    />
  )
}
