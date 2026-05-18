import { getEquipes } from '@/lib/data/queries/chantiers'
import { getOrgIndividualMembers } from '@/lib/data/queries/members'
import { getTeamMembers } from '@/lib/data/queries/team'
import { canManageLaborRates, hasPermission, getCurrentMembershipContext } from '@/lib/data/queries/membership'
import { getAllMemberGoals } from '@/lib/data/queries/member-goals'
import EquipesClient from './EquipesClient'

export default async function EquipesPage() {
  const now = new Date()
  const [equipes, soloMembers, appMembers, canManageTeam, canEditRates, canEditGoals, memberGoals, membership] = await Promise.all([
    getEquipes(),
    getOrgIndividualMembers(),
    getTeamMembers().catch(() => []),
    hasPermission('chantiers.manage_team'),
    canManageLaborRates(),
    hasPermission('settings.edit_goals'),
    getAllMemberGoals(now.getFullYear(), now.getMonth() + 1),
    getCurrentMembershipContext(),
  ])

  return (
    <EquipesClient
      equipes={equipes}
      soloMembers={soloMembers}
      appMembers={appMembers}
      canManageTeam={canManageTeam}
      canEditRates={canEditRates}
      canEditGoals={canEditGoals}
      memberGoals={memberGoals}
      currentUserId={membership?.userId ?? ''}
    />
  )
}
