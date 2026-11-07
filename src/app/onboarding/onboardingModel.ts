// Onboarding : règles de parcours, de saisie et de présentation (sans React).
// Le serveur (actions.ts) revalide tout ; ceci ne sert qu'à guider la saisie.

import type { BusinessActivityId } from '@/lib/catalog-context'
import {
  normalizeEmail,
  normalizeSiret,
  type OrganizationFieldErrors,
} from '@/lib/validations/organization'

// Étapes dirigeant : 0 bienvenue · 1 entreprise · 2 coordonnées · 'launch' premier devis
// · 3 factures électroniques · 4 équipe. Étape collaborateur : 'join'.
// Téléphone, forme juridique, capital, RCS, IBAN/BIC, délais de paiement et tribunal
// sont différés dans les Réglages : aucun n'est bloquant (colonnes nullables), seul le
// SIRET reste requis pour démarrer l'essai self-service.
export type OnboardingStep = 0 | 1 | 2 | 3 | 4 | 'launch' | 'join'

export type InviteRow = { email: string; roleId: string }

// Cinq familles mises en avant (docs/scope-verticales-prioritaires.md) plutôt que les
// 21 activités à plat. Une famille à plusieurs activités propose un sous-choix une fois
// sélectionnée (ex : métal regroupe trois activités de profils différents).
export const PRIORITY_FAMILIES: { label: string; description: string; activityIds: BusinessActivityId[] }[] = [
  { label: 'Métallerie, tôlerie, chaudronnerie', description: 'Garde-corps, portails, escaliers, fabrication atelier.', activityIds: ['metallerie', 'tolerie', 'chaudronnerie'] },
  { label: 'Rénovation, entreprise générale', description: "Travaux tous corps d'état et interventions multi-lots.", activityIds: ['renovation'] },
  { label: 'Menuiserie, fermetures, agencement', description: 'Pose, fabrication et finitions bois, alu ou PVC.', activityIds: ['menuiserie'] },
  { label: 'CVC, maintenance technique', description: "Plomberie, sanitaire, chauffage, contrats d'entretien.", activityIds: ['plomberie'] },
  { label: 'Nettoyage', description: 'Entretien régulier, consommables et prestations récurrentes.', activityIds: ['nettoyage_bureaux'] },
]

export const ONBOARDING_ERRORS: Record<string, string> = {
  missing_fields: 'Veuillez remplir tous les champs obligatoires.',
  org_not_found: 'Votre espace de travail est introuvable. Veuillez vous reconnecter.',
  org_update_failed: 'La mise à jour de votre espace a échoué. Veuillez réessayer.',
  invalid_org_details: 'Certaines informations entreprise doivent être corrigées avant de continuer.',
  siret_required: 'Le SIRET est obligatoire pour activer votre essai gratuit.',
  trial_activation_failed: 'Votre espace est prêt. Activez votre accès pour continuer.',
  invalid_code: 'Code entreprise introuvable. Vérifiez le code et réessayez.',
  join_failed: "Une erreur est survenue lors de la connexion à l'entreprise. Veuillez réessayer.",
}

const JOIN_ERRORS = new Set(['invalid_code', 'join_failed'])

/**
 * Après un refus du serveur, la page se recharge et l'état saisi est perdu. On
 * rouvre l'étape concernée plutôt que l'accueil, qui n'affiche jamais l'erreur.
 */
export function initialStepForError(errorKey: string | null): OnboardingStep {
  if (!errorKey || !(errorKey in ONBOARDING_ERRORS)) return 0
  return JOIN_ERRORS.has(errorKey) ? 'join' : 1
}

/** Points d'avancement : le parcours dirigeant en compte quatre, les autres étapes aucun. */
export function stepProgress(step: OnboardingStep): { current: number; total: number } | undefined {
  switch (step) {
    case 1: return { current: 0, total: 4 }
    case 2: return { current: 1, total: 4 }
    case 3: return { current: 2, total: 4 }
    case 4: return { current: 3, total: 4 }
    default: return undefined
  }
}

export function validateCompany(input: { companyName: string; activity: BusinessActivityId | '' }): OrganizationFieldErrors {
  const errors: OrganizationFieldErrors = {}
  if (!input.companyName.trim()) errors.name = "Le nom de l'entreprise est obligatoire."
  if (!input.activity) errors.name = errors.name ?? 'Choisissez une activité de référence.'
  return errors
}

export function validateContact(input: { email: string; siret: string; selfService: boolean }): OrganizationFieldErrors {
  const errors: OrganizationFieldErrors = {}
  const email = normalizeEmail(input.email)
  const siret = normalizeSiret(input.siret)
  if (!input.email.trim()) errors.email = "L'email de contact est obligatoire."
  else if (email.error) errors.email = email.error
  if (input.selfService && !input.siret.trim()) errors.siret = 'Le SIRET est obligatoire pour activer votre essai.'
  else if (siret.error) errors.siret = siret.error
  return errors
}

export function hasErrors(errors: OrganizationFieldErrors): boolean {
  return Object.keys(errors).length > 0
}

/** Champs transmis tels quels au serveur : leurs réglages arrivent plus tard (Réglages). */
export const DEFERRED_ORG_FIELDS = {
  phone: '',
  address_line1: '',
  postal_code: '',
  city: '',
  vat_number: '',
  forme_juridique: '',
  capital_social: '',
  rcs: '',
  rcs_ville: '',
  is_vat_subject: 'true',
  default_vat_rate: '20',
  iban: '',
  bic: '',
  bank_name: '',
  payment_terms_days: '30',
  late_penalty_rate: '3',
  court_competent: '',
  logo_url: '',
} as const

export function einvoicingIntent(wantsReception: boolean, wantsEmission: boolean): 'activate' | 'later' {
  return wantsReception || wantsEmission ? 'activate' : 'later'
}

export function isInviteEmailValid(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

export function hasInvalidInviteEmail(invites: InviteRow[]): boolean {
  return invites.some((invite) => invite.email.trim() !== '' && !isInviteEmailValid(invite.email))
}

export function addInviteRow(invites: InviteRow[], roleId: string): InviteRow[] {
  return [...invites, { email: '', roleId }]
}

export function removeInviteRow(invites: InviteRow[], index: number): InviteRow[] {
  return invites.filter((_, position) => position !== index)
}

export function updateInviteRow(invites: InviteRow[], index: number, field: keyof InviteRow, value: string): InviteRow[] {
  return invites.map((invite, position) => (position === index ? { ...invite, [field]: value } : invite))
}

export function welcomeTitle(firstName: string | null): string {
  return firstName ? `Bienvenue, ${firstName}` : 'Bienvenue'
}
