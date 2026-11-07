// @atelier-migrated
// Entreprise : outils purs pour les trois écrans (identité, mentions légales, TVA et paiement).

import type { OrganizationFieldErrors, OrganizationValidationField } from '@/lib/validations/organization'

export type EntrepriseTab = 'entreprise' | 'legal' | 'paiement'

/** Écran qui porte chaque champ validé à l'enregistrement. */
const FIELD_TAB: Partial<Record<OrganizationValidationField, EntrepriseTab>> = {
  name: 'entreprise',
  siret: 'entreprise',
  vat_number: 'entreprise',
  email: 'entreprise',
  postal_code: 'entreprise',
  iban: 'paiement',
  bic: 'paiement',
  payment_terms_days: 'paiement',
  late_penalty_rate: 'paiement',
  court_competent: 'paiement',
  default_vat_rate: 'paiement',
}

export function tabOfOrgField(field: string): EntrepriseTab | null {
  return FIELD_TAB[field as OrganizationValidationField] ?? null
}

/** Premier champ en erreur, avec l'écran où le montrer. */
export function firstOrgError(errors: OrganizationFieldErrors): { field: string; tab: EntrepriseTab } | null {
  for (const field of Object.keys(errors)) {
    const tab = tabOfOrgField(field)
    if (tab) return { field, tab }
  }
  return null
}

export type DecennaleTone = 'danger' | 'warn' | 'ok'

/** Jours restants avant l'échéance de la décennale, avec le ton et la phrase à afficher. */
export function decennaleStatus(dateFin: string, now: number = Date.now()): { daysLeft: number; tone: DecennaleTone; text: string } | null {
  if (!dateFin) return null
  const time = new Date(dateFin).getTime()
  if (Number.isNaN(time)) return null
  const daysLeft = Math.ceil((time - now) / 86_400_000)
  const plural = (n: number) => (n > 1 ? 's' : '')
  if (daysLeft < 0) {
    const days = Math.abs(daysLeft)
    return { daysLeft, tone: 'danger', text: `Assurance expirée depuis ${days} jour${plural(days)}, renouvelez-la d’urgence.` }
  }
  if (daysLeft <= 60) {
    return { daysLeft, tone: 'warn', text: `Expire dans ${daysLeft} jour${plural(daysLeft)}, pensez au renouvellement.` }
  }
  return { daysLeft, tone: 'ok', text: `Valide encore ${daysLeft} jours.` }
}

export function vatRateLabel(rate: number): string {
  if (rate === 20) return '20 % : taux normal (neuf)'
  if (rate === 10) return '10 % : rénovation de logement'
  if (rate === 5.5) return '5,5 % : amélioration énergétique'
  return '0 % : exonéré'
}

/** Ligne de résumé d'une liste d'activités (« Plomberie, Électricité »). */
export function summarizeLabels(labels: string[], empty: string): string {
  if (labels.length === 0) return empty
  if (labels.length <= 2) return labels.join(', ')
  return `${labels.slice(0, 2).join(', ')} et ${labels.length - 2} autre${labels.length - 2 > 1 ? 's' : ''}`
}
