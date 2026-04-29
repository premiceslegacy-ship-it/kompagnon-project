import { getAllPlannings, getChantiers } from '@/lib/data/queries/chantiers'
import { getOrganizationModules } from '@/lib/data/queries/organization-modules'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import PlanningGlobalClient from './PlanningGlobalClient'

async function computeIcalToken(orgId: string): Promise<string> {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(orgId))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export default async function PlanningGlobalPage() {
  const [plannings, chantiers, modules, orgId] = await Promise.all([
    getAllPlannings(),
    getChantiers(),
    getOrganizationModules(),
    getCurrentOrganizationId(),
  ])

  const icalToken = orgId ? await computeIcalToken(orgId) : null

  return (
    <PlanningGlobalClient
      initialPlannings={plannings}
      chantiers={chantiers}
      planningAiEnabled={modules.planning_ai}
      orgId={orgId}
      icalToken={icalToken}
    />
  )
}
