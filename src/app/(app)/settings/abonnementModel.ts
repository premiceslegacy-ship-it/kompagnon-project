// @atelier-migrated
// Abonnement : offres, avantages, parcours de résiliation, statut d'accès, e-facturation (outils purs).

import type { EinvoicingConfig } from '@/lib/einvoicing-config'
import type { OrganizationModules } from '@/lib/organization-modules'
import type { SubscriptionTier } from '@/lib/quota-catalog'
import type { AccessStatus } from '@/lib/subscription-access'

export type TierInfo = {
  tier: Exclude<SubscriptionTier, 'setup_only'>
  label: string
  price: string
  description: string
  stripeEnvKey: 'NEXT_PUBLIC_STRIPE_LINK_PRO' | 'NEXT_PUBLIC_STRIPE_LINK_EXPERT'
  features: string[]
  highlight?: string
}

// Starter n'est plus une offre commerciale (seules setup_only / pro / expert existent).
export const TIER_INFO: TierInfo[] = [
  {
    tier: 'pro', label: 'Pro', price: '69', description: 'Sarah, votre secrétaire métier disponible 24h/24.',
    stripeEnvKey: 'NEXT_PUBLIC_STRIPE_LINK_PRO', highlight: 'Le plus choisi',
    features: [
      'Tous les outils de gestion, sans limites',
      'Sarah, secrétaire métier IA (120 appels/mois)',
      'Sarah vocale ElevenLabs (60 min/mois)',
      'Planning IA illimité',
      'Catalogue IA, import documents illimité',
    ],
  },
  {
    tier: 'expert', label: 'Expert', price: '169', description: 'Tout illimité. Pour les structures qui vont vite.',
    stripeEnvKey: 'NEXT_PUBLIC_STRIPE_LINK_EXPERT',
    features: ['Tout Pro, sans aucune limite', 'Sarah illimitée, texte et vocale (300 min/mois)', 'Toutes les IA illimitées', 'Support prioritaire'],
  },
]

export const CURRENT_TIER_BENEFITS: Record<SubscriptionTier, string[]> = {
  setup_only: [],
  pro: [
    'Sarah répond à vos questions métier à tout moment',
    'Sarah vocale gère vos urgences les mains dans le cambouis',
    'Tous les outils du quotidien sans compteur qui stresse',
    '120 appels Sarah/mois, de quoi couvrir une semaine chargée chaque semaine',
  ],
  expert: [
    'Aucune limite sur Sarah, ni sur aucun autre outil IA',
    'Sarah vocale 300 min/mois, soit 10 minutes par jour ouvré',
    'La totalité de la plateforme déverrouillée, sans compromis',
    'Vous allez plus vite que vos concurrents, chaque jour',
  ],
}

export const CANCEL_REASONS = [
  'Je n’utilise pas assez l’application',
  'Le prix est trop élevé pour mon activité',
  'Je passe à un autre outil',
  'Je ferme ou mets en pause mon activité',
  'Autre',
] as const

export const CANCEL_CONFIRM_WORD = 'RÉSILIER'

const RANK: Record<SubscriptionTier, number> = { setup_only: 0, pro: 1, expert: 2 }
export const tierRank = (tier: SubscriptionTier) => RANK[tier]

/** Sans offre explicite : « Pro » dès que Sarah et le vocal en direct sont actifs, sinon « setup ». */
export function detectCurrentTier(modules: OrganizationModules): SubscriptionTier {
  return modules.sarah_assistant && modules.voice_live ? 'pro' : 'setup_only'
}

export const tierLabel = (tier: SubscriptionTier) =>
  tier === 'setup_only' ? 'Sans abonnement IA' : (TIER_INFO.find(t => t.tier === tier)?.label ?? tier)

export const tierPrice = (tier: SubscriptionTier) => TIER_INFO.find(t => t.tier === tier)?.price ?? null

/** Offres au-dessus de l'offre actuelle. */
export const upgradeTiers = (current: SubscriptionTier) => TIER_INFO.filter(t => tierRank(t.tier) > tierRank(current))

export type PillStatus = 'wait' | 'success' | 'danger' | 'neutral'

export function accessPill(status: AccessStatus | null | undefined): { label: string; status: PillStatus } {
  if (status === 'canceling') return { label: 'Résiliation programmée', status: 'wait' }
  if (status === 'past_due') return { label: 'Paiement à régulariser', status: 'danger' }
  return { label: 'Actif', status: 'success' }
}

/** Phrase d'état de l'accès pour l'achat « setup » (sans abonnement récurrent). */
export function setupAccessText(status: AccessStatus | null | undefined): string {
  if (status === 'active') return 'Actif, sans abonnement récurrent.'
  if (status === 'canceling') return 'Fin d’accès programmée.'
  if (status === 'locked' || status === 'expired') return 'Accès suspendu, sans abonnement récurrent.'
  return 'Statut de l’accès à vérifier.'
}

export const isCancelConfirmed = (text: string) => text.trim().toUpperCase() === CANCEL_CONFIRM_WORD

export const frDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR')

/* ── Facturation électronique ────────────────────────────────────────── */

export const OAUTH_STATUS_LABELS: Record<EinvoicingConfig['oauth_status'], string> = {
  not_connected: 'Non connecté',
  pending: 'Connexion en cours',
  connected: 'Connecté',
  error: 'Erreur de connexion',
  revoked: 'Connexion révoquée',
}

export function oauthPill(status: EinvoicingConfig['oauth_status']): PillStatus {
  if (status === 'connected') return 'success'
  if (status === 'pending') return 'wait'
  if (status === 'error' || status === 'revoked') return 'danger'
  return 'neutral'
}

export const activateLabel = (environment: EinvoicingConfig['environment']) =>
  environment === 'production' ? 'Activer la facturation électronique' : 'Tester la connexion Super PDP'
