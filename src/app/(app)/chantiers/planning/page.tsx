import { getAllPlannings, getChantiers } from '@/lib/data/queries/chantiers'
import { getOrganizationModules } from '@/lib/data/queries/organization-modules'
import PlanningGlobalClient from './PlanningGlobalClient'

export default async function PlanningGlobalPage() {
  const [plannings, chantiers, modules] = await Promise.all([
    getAllPlannings(),
    getChantiers(),
    getOrganizationModules(),
  ])

  return <PlanningGlobalClient initialPlannings={plannings} chantiers={chantiers} planningAiEnabled={modules.planning_ai} />
}
