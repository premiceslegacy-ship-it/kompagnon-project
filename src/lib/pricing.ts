export const ATELIER_PRICING = {
  setup: {
    id: 'setup',
    label: 'Installation accompagnée',
    amountEur: 3000,
    cadence: 'forfait unique',
  },
  pro: {
    id: 'pro',
    label: 'Pro',
    amountEur: 69,
    cadence: 'HT / mois',
  },
  expert: {
    id: 'expert',
    label: 'Expert',
    amountEur: 169,
    cadence: 'HT / mois',
  },
} as const

export type SellablePlanId = 'pro' | 'expert'

export const SELLABLE_PLANS = [ATELIER_PRICING.pro, ATELIER_PRICING.expert] as const

export function getAtelierPlan(id: string) {
  return ATELIER_PRICING[id as keyof typeof ATELIER_PRICING] ?? null
}
