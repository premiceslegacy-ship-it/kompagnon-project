import { getAllPointagesGlobal, getChantiers } from '@/lib/data/queries/chantiers'
import { getOrgIndividualMembers } from '@/lib/data/queries/members'
import HeuresGlobalesClient from './HeuresGlobalesClient'

export default async function HeuresGlobalesPage() {
  const [pointages, individualMembers, chantiers] = await Promise.all([
    getAllPointagesGlobal(),
    getOrgIndividualMembers(),
    getChantiers(),
  ])
  return (
    <HeuresGlobalesClient
      initialPointages={pointages}
      individualMembers={individualMembers}
      chantiers={chantiers.map(c => ({ id: c.id, title: c.title }))}
    />
  )
}
