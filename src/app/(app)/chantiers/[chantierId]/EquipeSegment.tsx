'use client'
// @atelier-migrated
// Segment Équipe : planning de la semaine, heures pointées, équipes et intervenants.
// Le planning, les équipes et les intervenants gardent leur mise en page d'origine (reprise en lot suivant).

import HoursSection from './HoursSection'
import IndividualMembersSection from './IndividualMembersSection'
import { EquipesTab } from './LegacyEquipe'
import PlanningSection from './PlanningSection'
import type { ChantierDetailState } from './useChantierDetail'

export default function EquipeSegment({ q }: { q: ChantierDetailState }) {
  return (
    <>
      {q.canEditChantier && <PlanningSection q={q} />}
      {(q.canPointage || q.canManagePointages) && <HoursSection q={q} />}
      {q.canManageTeam && (
        <>
          <EquipesTab
            chantierId={q.chantier.id}
            allEquipes={q.allEquipes}
            chantierEquipes={q.initialChantierEquipes}
            linkedQuoteId={q.linkedQuoteId}
            orgMembers={q.orgMembers}
            orgRoles={q.orgRoles}
            canEditRates={q.canEditRates}
            currentUserId={q.currentUserId}
          />
          <IndividualMembersSection
            chantierId={q.chantier.id}
            initialMembers={q.initialIndividualMembers}
            orgMembers={q.orgMembers}
            orgPhantomMembers={q.orgPhantomMembers}
            orgRoles={q.orgRoles}
            canEditRates={q.canEditRates}
            currentUserId={q.currentUserId}
          />
        </>
      )}
    </>
  )
}
