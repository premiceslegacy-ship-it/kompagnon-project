// Activation : textes et règles de présentation (sans React). Les droits d'accès,
// l'essai et le paiement restent décidés côté serveur (page.tsx, actions.ts).

import { ATELIER_PRICING } from '@/lib/pricing'

export type Tier = 'pro' | 'expert'
export const PLAN_ORDER: Tier[] = ['pro', 'expert']

export const ACTIVATION_ERRORS: Record<string, string> = {
  trial_already_used: 'L’essai gratuit a déjà été utilisé pour cet email ou ce SIRET.',
  trial_email_already_used: 'Cette adresse email a déjà bénéficié de l’essai gratuit.',
  trial_siret_already_used: 'Ce SIRET possède déjà un espace Atelier. Demandez à la personne qui l’a créé de vous inviter depuis Réglages → Équipe.',
  trial_activation_failed: 'Votre espace est prêt, mais son activation n’a pas abouti. Réessayez dans un instant.',
  checkout_failed: 'Le paiement sécurisé est momentanément indisponible. Aucun débit n’a été effectué.',
  portal_failed: 'Le portail de facturation est momentanément indisponible. Réessayez dans un instant ou contactez contact@orsayn.fr.',
  invalid_tier: 'Cette formule n’est pas disponible.',
  checkout_cancelled: 'Le checkout Stripe a été annulé. Aucun changement n’a été effectué sur votre accès.',
}

export const CHECKOUT_CANCELLED_NOTICE = 'Le checkout Stripe a été annulé. Aucun changement n’a été effectué sur votre accès.'

export function exportNotice(value: string | undefined): string | null {
  if (!value) return null
  return value === 'failed'
    ? 'L’export n’a pas pu être lancé.'
    : 'Votre export est en préparation. Vous recevrez le lien sécurisé par email.'
}

export type ActivationMood = 'unpaid' | 'trial' | 'ended' | 'choose'

/** Quel écran afficher : régularisation, essai offert, essai terminé, ou simple choix. */
export function activationMood(input: { isUnpaid: boolean; canStartTrial: boolean; hasConsumedTrial: boolean }): ActivationMood {
  if (input.isUnpaid) return 'unpaid'
  if (input.canStartTrial) return 'trial'
  if (input.hasConsumedTrial) return 'ended'
  return 'choose'
}

export function activationHeading(mood: ActivationMood): { title: string; description: string } {
  switch (mood) {
    case 'unpaid':
      return {
        title: 'Régularisez votre abonnement',
        description: 'Votre abonnement nécessite une régularisation. Mettez à jour votre moyen de paiement dans Stripe pour retrouver vos outils.',
      }
    case 'trial':
      return {
        title: 'Essayez Pro pendant 7 jours',
        description: 'Découvrez la formule Pro, puis choisissez le niveau qui correspond à votre entreprise.',
      }
    case 'ended':
      return {
        title: 'Récupérez vos soirées',
        description: 'Votre accès est en pause. Vos données, vos clients et vos habitudes restent là : choisissez votre formule pour reprendre sans ressaisie.',
      }
    case 'choose':
      return {
        title: 'Choisissez votre formule',
        description: 'Choisissez le niveau qui correspond à votre façon de travailler et gardez votre gestion sous contrôle.',
      }
  }
}

export const PLAN_COPY: Record<Tier, {
  name: string
  price: number
  promise: string
  audience: string
  benefits: string[]
  quotas: string[]
}> = {
  pro: {
    name: 'Pro',
    price: ATELIER_PRICING.pro.amountEur,
    promise: 'L’IA qui vous fait gagner du temps, chaque jour.',
    audience: 'Pour l’artisan actif et les petites équipes.',
    benefits: [
      'Sarah retrouve l’info et vous fait avancer sur clients, chantiers et planning',
      'Devis préparés depuis un texte, un plan ou une photo',
      'Parlez-lui à la voix, même en direct au téléphone',
    ],
    quotas: ['120 échanges par mois', '60 analyses de devis par mois', '60 min de voix en direct par mois'],
  },
  expert: {
    name: 'Expert',
    price: ATELIER_PRICING.expert.amountEur,
    promise: 'L’IA sans plafond pour votre croissance.',
    audience: 'Pour les équipes qui s’en servent tous les jours.',
    benefits: [
      'Tout Pro, sans compteur à surveiller',
      'Devis, relances et analyses sans quota',
      '5 fois plus de voix en direct qu’en Pro',
    ],
    quotas: ['Échanges et analyses illimités', '300 min de voix en direct par mois', 'Imports de catalogue illimités'],
  },
}

export const SETUP_COPY = {
  name: 'Mise en place accompagnée',
  headline: 'Payez une fois. L’IA, vous la payez à l’usage.',
  lead: 'Plus d’abonnement : vous branchez votre propre compte IA (OpenRouter) et ne payez que ce que vous consommez, sans forfait ni plafond.',
  benefits: [
    'Catalogue, prix, devis et clients repris pour vous',
    'Prise en main guidée, sans formation longue',
    '14 jours de support prioritaire',
  ],
  footnote: 'La consommation IA est facturée par OpenRouter selon votre usage, en plus du prix de la mise en place.',
  cta: 'Demander la mise en place',
} as const

export const SETUP_COMPARISON_MONTHS = 36

/**
 * L'argument d'amortissement : une mise en place payée une fois contre Expert payé
 * chaque mois. `maxAiPerMonth` est la consommation IA mensuelle sous laquelle la
 * mise en place reste moins chère qu'Expert sur la période.
 */
export function setupComparison(setupAmount: number, monthlyAmount: number, months: number = SETUP_COMPARISON_MONTHS) {
  const monthlyTotal = monthlyAmount * months
  return {
    months,
    monthlyTotal,
    breakEvenMonths: Math.ceil(setupAmount / monthlyAmount),
    maxAiPerMonth: Math.max(0, Math.floor((monthlyTotal - setupAmount) / months)),
  }
}

/** La formule mise en avant : Pro pendant l'essai offert, sinon celle déjà choisie. */
export function featuredTier(trialAvailable: boolean, preferred: Tier): Tier {
  return trialAvailable ? 'pro' : preferred
}

export function planAction(tier: Tier, trialAvailable: boolean): 'trial' | 'checkout' {
  return trialAvailable && tier === 'pro' ? 'trial' : 'checkout'
}

export function planCtaLabel(tier: Tier, trialAvailable: boolean): string {
  if (planAction(tier, trialAvailable) === 'trial') return 'Essayer Pro gratuitement'
  return trialAvailable ? `Choisir ${PLAN_COPY[tier].name}` : `Reprendre avec ${PLAN_COPY[tier].name}`
}

export function planFootnote(tier: Tier, trialAvailable: boolean): string {
  return planAction(tier, trialAvailable) === 'trial'
    ? 'Pro offert 7 jours, aucune carte demandée.'
    : 'Paiement sécurisé via Stripe, abonnement mensuel.'
}

export function planBadge(tier: Tier, trialAvailable: boolean, preferred: Tier): string | null {
  if (featuredTier(trialAvailable, preferred) !== tier) return null
  return trialAvailable ? '7 jours offerts' : 'Recommandé pour reprendre'
}

export function setupWhatsappUrl(baseUrl: string | undefined, companyName: string): string | null {
  if (!baseUrl?.trim()) return null
  try {
    const url = new URL(baseUrl.trim())
    url.searchParams.set('text', `Bonjour, je souhaite en savoir plus sur l’installation d’Atelier pour ${companyName}.`)
    return url.toString()
  } catch {
    return null
  }
}

export function formatEuros(amount: number): string {
  return `${amount.toLocaleString('fr-FR')} €`
}
