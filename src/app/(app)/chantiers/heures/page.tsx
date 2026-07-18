import { getAllPointagesGlobal, getChantiers, getMissingPointageSlots } from '@/lib/data/queries/chantiers'
import { getOrgIndividualMembers } from '@/lib/data/queries/members'
import { hasPermission } from '@/lib/data/queries/membership'
import HeuresGlobalesClient from './HeuresGlobalesClient'

export default async function HeuresGlobalesPage() {
  const canManage = await hasPermission('chantiers.manage_pointages')
  const [pointages, individualMembers, chantiers, missingSlots] = canManage
    ? await Promise.all([
        getAllPointagesGlobal(),
        getOrgIndividualMembers(),
        getChantiers(),
        getMissingPointageSlots(),
      ])
    : [[], [], [], []]

  return (
    <HeuresGlobalesClient
      initialPointages={pointages}
      individualMembers={individualMembers}
      chantiers={chantiers.map(c => ({ id: c.id, title: c.title }))}
      canManage={canManage}
      missingSlots={missingSlots}
    />
  )
}
