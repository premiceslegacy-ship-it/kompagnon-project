// @atelier-migrated
// Champs cachés transmis aux actions serveur (noms et valeurs inchangés).

import { DEFERRED_ORG_FIELDS, einvoicingIntent } from './onboardingModel'
import type { OnboardingState } from './useOnboarding'

function ActivityFields({ q }: { q: OnboardingState }) {
  return (
    <>
      <input type="hidden" name="company_name" value={q.companyName} />
      <input type="hidden" name="business_activity" value={q.selectedActivity} />
      <input type="hidden" name="secondary_activity_ids" value={JSON.stringify(q.selectedSecondaryActivities)} />
      <input type="hidden" name="business_profile" value={q.resolvedSelection?.businessProfile ?? ''} />
      <input type="hidden" name="sector" value={q.resolvedSelection?.sectorLabel ?? ''} />
      <input type="hidden" name="email" value={q.email} />
      <input type="hidden" name="siret" value={q.siret} />
    </>
  )
}

/** Lancement direct : premier devis. L'intention de facturation électronique reste « plus tard ». */
export function LaunchFields({ q }: { q: OnboardingState }) {
  return (
    <>
      <ActivityFields q={q} />
      <input type="hidden" name="is_vat_subject" value={DEFERRED_ORG_FIELDS.is_vat_subject} />
      <input type="hidden" name="default_vat_rate" value={DEFERRED_ORG_FIELDS.default_vat_rate} />
      <input type="hidden" name="payment_terms_days" value={DEFERRED_ORG_FIELDS.payment_terms_days} />
      <input type="hidden" name="late_penalty_rate" value={DEFERRED_ORG_FIELDS.late_penalty_rate} />
      <input type="hidden" name="einvoicing_intent" value="later" />
    </>
  )
}

/** Fin de parcours dirigeant : tous les champs, dont les choix de facturation électronique. */
export function CompleteFields({ q }: { q: OnboardingState }) {
  return (
    <>
      <ActivityFields q={q} />
      {Object.entries(DEFERRED_ORG_FIELDS).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <input type="hidden" name="einvoicing_intent" value={einvoicingIntent(q.einvoicingWantsReception, q.einvoicingWantsEmission)} />
    </>
  )
}
