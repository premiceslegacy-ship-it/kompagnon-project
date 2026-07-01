import { getEquipes } from '@/lib/data/queries/chantiers'
import { getOrgIndividualMembers } from '@/lib/data/queries/members'
import { getTeamMembers } from '@/lib/data/queries/team'
import { canManageLaborRates, hasPermission, getCurrentMembershipContext } from '@/lib/data/queries/membership'
import { getAllMemberGoals } from '@/lib/data/queries/member-goals'
import { getOrgRoles } from '@/lib/data/queries/roles'
import EquipesClient from './EquipesClient'

export default async function EquipesPage() {
  const now = new Date()
  const [equipes, soloMembers, appMembers, orgRoles, canManageTeam, canEditRates, canEditGoals, memberGoals, membership] = await Promise.all([
    getEquipes(),
    getOrgIndividualMembers(),
    getTeamMembers().catch(() => []),
    getOrgRoles(),
    hasPermission('chantiers.manage_team'),
    canManageLaborRates(),
    hasPermission('settings.edit_goals'),
    getAllMemberGoals(now.getFullYear(), now.getMonth() + 1),
    getCurrentMembershipContext(),
  ])

  const visibleSoloMembers = canEditRates
    ? soloMembers
    : soloMembers.map(member => ({ ...member, taux_horaire: null }))
  const visibleAppMembers = canEditRates
    ? appMembers
    : appMembers.map(member => ({ ...member, labor_cost_per_hour: null }))

  return (
    <EquipesClient
      equipes={equipes}
      soloMembers={visibleSoloMembers}
      appMembers={visibleAppMembers}
      orgRoles={orgRoles}
      canManageTeam={canManageTeam}
      canEditRates={canEditRates}
      canEditGoals={canEditGoals}
      memberGoals={memberGoals}
      currentUserId={membership?.userId ?? ''}
    />
  )
}
