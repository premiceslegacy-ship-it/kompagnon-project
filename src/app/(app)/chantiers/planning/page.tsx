import { getAllPlannings, getChantiers, getEquipes } from '@/lib/data/queries/chantiers'
import { getOrgIndividualMembers } from '@/lib/data/queries/members'
import { getOrganizationModules } from '@/lib/data/queries/organization-modules'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { hasPermission } from '@/lib/data/queries/membership'
import { getOrganization } from '@/lib/data/queries/organization'
import { getAllTourneeRoutes } from '@/lib/data/mutations/planning'
import PlanningGlobalClient from './PlanningGlobalClient'

async function computeIcalToken(orgId: string): Promise<string> {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(orgId))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// Le planning global charge tout en mémoire côté client et navigue (jour/semaine/mois)
// sans refaire de requête serveur. On borne donc la requête initiale à une fenêtre
// large (±6 mois) plutôt que de charger l'historique complet de l'organisation, qui
// grossit indéfiniment sans que la navigation ne s'en serve réellement au quotidien.
function planningWindow() {
  const now = new Date()
  const from = new Date(now)
  from.setMonth(from.getMonth() - 6)
  const to = new Date(now)
  to.setMonth(to.getMonth() + 6)
  const toYmd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { from: toYmd(from), to: toYmd(to) }
}

export default async function PlanningGlobalPage() {
  const [plannings, chantiers, equipes, individualMembers, modules, orgId, canManage, organization, routeDepartures] = await Promise.all([
    getAllPlannings(planningWindow()),
    getChantiers(),
    getEquipes(),
    getOrgIndividualMembers(),
    getOrganizationModules(),
    getCurrentOrganizationId(),
    hasPermission('chantiers.planning'),
    getOrganization(),
    getAllTourneeRoutes(),
  ])

  const icalToken = orgId ? await computeIcalToken(orgId) : null

  return (
    <PlanningGlobalClient
      initialPlannings={plannings}
      chantiers={chantiers}
      equipes={equipes}
      individualMembers={individualMembers}
      planningAiEnabled={modules.planning_ai}
      orgId={orgId}
      icalToken={icalToken}
      canManage={canManage}
      orgDepartureAddress={organization?.departure_address ?? null}
      orgDeparturePostalCode={organization?.departure_postal_code ?? null}
      orgDepartureCity={organization?.departure_city ?? null}
      orgDepartureLatitude={organization?.departure_latitude ?? null}
      orgDepartureLongitude={organization?.departure_longitude ?? null}
      routeDepartures={routeDepartures}
    />
  )
}
