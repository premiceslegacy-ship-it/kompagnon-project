'use client'
// @atelier-migrated
// Segment Argent : jalons d'acompte, situations de travaux, rentabilité et dépenses.
// Ces trois blocs gardent leur mise en page d'origine (reprise en lot suivant).

import SituationsSection from '@/components/situations/SituationsSection'
import JalonsTab from './JalonsTab'
import RentabiliteTab from './RentabiliteTab'
import type { ChantierDetailState } from './useChantierDetail'

export default function ArgentSegment({ q }: { q: ChantierDetailState }) {
  const c = q.chantier
  return (
    <>
      {q.canEditChantier && (
        <JalonsTab initialJalons={q.initialJalons} chantierId={c.id} budgetHt={c.budget_ht ?? 0} taches={q.taches} />
      )}
      {q.situationsSummary && c.quote_id && (
        <SituationsSection
          chantierId={c.id}
          summary={q.situationsSummary}
          canCreateSituation={q.canCreateSituation}
          canCreateSolde={q.canCreateSolde}
          returnTo={`/chantiers/${c.id}`}
          defaultRetentionPct={c.default_retention_pct ?? 0}
        />
      )}
      {(q.canViewExpenses || q.canCreateExpenses) && (
        <RentabiliteTab
          chantierId={c.id}
          initialProfitability={q.initialProfitability}
          orgMembers={q.orgMembers}
          orgSector={q.orgSector}
          materials={q.materials}
          invoiceStubs={q.invoiceStubs}
          targetMarginPct={c.target_margin_pct ?? 30}
          permissions={{
            canCreateExpenses: q.canCreateExpenses,
            canEditExpenses: q.canEditExpenses,
            canDeleteExpenses: q.canDeleteExpenses,
            canEditRates: q.canEditRates,
            canEditChantier: q.canEditChantier,
          }}
          deletedPointages={q.deletedPointages}
        />
      )}
    </>
  )
}
