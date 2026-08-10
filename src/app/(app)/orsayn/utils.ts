import { QUOTA_DEFINITIONS } from '@/lib/quota-catalog'
import { UNRESOLVED_ORGANIZATION_ID } from '@/lib/operator/trial-lifecycle'
import type { AIBillingMode, ClientRow, OperatorClientQuota, OperatorUsageEvent } from './types'
import type { EinvoicingConfig } from '@/lib/einvoicing-config'

const GLOBAL_CURRENCY = 'EUR'

/** Clé composite stable identifiant un client cockpit — une instance mutualisée
 *  porte plusieurs organisations, donc source_instance seul ne suffit jamais. */
export function clientKey(sourceInstance: string, organizationId: string | null): string {
  return `${sourceInstance}::${organizationId ?? UNRESOLVED_ORGANIZATION_ID}`
}

export function formatMoney(value: number, currency: 'EUR' | 'USD' = GLOBAL_CURRENCY): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatPercent(value: number | null): string {
  if (value === null) return 'À compléter'
  return new Intl.NumberFormat('fr-FR', {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(value / 100)
}

export function formatDate(value: string | null): string {
  if (!value) return 'Jamais'

  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export function formatDateInput(value: string | null): string {
  if (!value) return ''
  return value.slice(0, 10)
}

export function isActiveTrial(value: string | null): boolean {
  return !!value && new Date(value).getTime() > Date.now()
}

export function getTrialLabel(value: string | null, converted: boolean): string {
  if (converted) return 'Converti'
  if (!value) return 'Aucun essai'

  const endsAt = new Date(value)
  const daysLeft = Math.ceil((endsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  if (daysLeft < 0) return 'Essai expiré'
  if (daysLeft === 0) return 'Expire aujourd’hui'
  return `J-${daysLeft}`
}

export function getEventLabel(eventType: string): string {
  const labels: Record<string, string> = {
    subscription_updated: 'Offre appliquée',
    trial_started: 'Essai activé',
    trial_converted: 'Essai converti',
    trial_ended: 'Essai terminé',
    config_resync_requested: 'Config resynchronisée',
    modules_updated: 'Modules appliqués',
  }

  return labels[eventType] ?? eventType
}

export function getCommercialEventLabel(eventType: string): string {
  const labels: Record<string, string> = {
    upgrade_prompt_quota: 'Upgrade quota',
    manual_email: 'Email manuel',
    trial_expiry_7d: 'Relance essai J-7',
    trial_expiry_2d: 'Relance essai J-2',
    trial_expired: 'Essai expiré',
    subscription_activated: 'Abonnement activé',
  }

  return labels[eventType] ?? eventType
}

export function getSuggestedTier(tier: import('@/lib/quota-catalog').SubscriptionTier): import('@/lib/quota-catalog').SubscriptionTier {
  if (tier === 'setup_only') return 'starter'
  if (tier === 'starter') return 'pro'
  if (tier === 'pro') return 'expert'
  return 'expert'
}

export function getRecommendationClass(severity: 'high' | 'medium' | 'low'): string {
  if (severity === 'high') return 'bg-red-500/10 text-red-700'
  if (severity === 'medium') return 'bg-amber-500/10 text-amber-700'
  return 'bg-slate-500/10 text-slate-700 dark:text-slate-200'
}

export function normalizeFee(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function normalizeNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function normalizeAIBillingMode(value: unknown): AIBillingMode {
  return (['orsayn_shared', 'client_owned'] as readonly unknown[]).includes(value) ? value as AIBillingMode : 'orsayn_shared'
}

export function formatAIBillingMode(value: AIBillingMode): string {
  return value === 'client_owned' ? 'Clé client' : 'Clé Orsayn'
}

export function formatCommercialStatus(row: Pick<ClientRow, 'tier' | 'aiBillingMode'>): string {
  if (row.aiBillingMode === 'client_owned') return 'BYOK - clé client'
  return `Stripe ${row.tier}`
}

export function formatQuotaValue(value: number): string {
  if (value < 0) return 'Illimité'
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)
}

export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat('fr-FR', {
    notation: value >= 10000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value)
}

export function getUsageFeatureLabel(event: OperatorUsageEvent): string {
  if (event.quota_feature && QUOTA_DEFINITIONS[event.quota_feature]) {
    return QUOTA_DEFINITIONS[event.quota_feature].label
  }

  return event.feature
}

export function getQuotaBadgeClass(quota: OperatorClientQuota): string {
  const monthly = normalizeNumber(quota.quota_monthly)
  const current = normalizeNumber(quota.current_quantity)
  if (monthly < 0) return 'bg-slate-500/10 text-slate-600'
  if (monthly === 0 && current > 0) return 'bg-red-500/10 text-red-600'
  const pct = monthly > 0 ? (current / monthly) * 100 : 0
  if (current > monthly) return 'bg-red-500/10 text-red-600'
  if (pct >= 90) return 'bg-orange-500/10 text-orange-700'
  if (pct >= 70) return 'bg-amber-500/10 text-amber-700'
  return 'bg-green-500/10 text-green-700'
}

export function convertUsdToCurrency(value: number, currency: 'EUR' | 'USD', usdToEurRate: number): number {
  if (currency === 'USD') return value
  return value * usdToEurRate
}

export function convertAmountToEur(value: number, currency: 'EUR' | 'USD', usdToEurRate: number): number {
  if (currency === 'EUR') return value
  return value * usdToEurRate
}

export function convertProviderCostToEur(value: number | null, currency: string, usdToEurRate: number): number {
  const amount = Number(value ?? 0)
  if (!Number.isFinite(amount)) return 0
  if (currency.toUpperCase() === 'EUR') return amount
  if (currency.toUpperCase() === 'USD') return amount * usdToEurRate
  return amount
}

export function getSyncBadge(lastSeenAt: string | null, lastStatus: string | null) {
  if (!lastSeenAt) {
    return {
      label: 'Jamais synchronisé',
      className: 'bg-slate-500/10 text-slate-600',
    }
  }

  const ageMs = Date.now() - new Date(lastSeenAt).getTime()
  const ageDays = ageMs / (1000 * 60 * 60 * 24)

  if (lastStatus === 'error' && ageDays <= 2) {
    return {
      label: 'Erreurs récentes',
      className: 'bg-red-500/10 text-red-600',
    }
  }

  if (ageDays > 7) {
    return {
      label: 'Silencieux',
      className: 'bg-amber-500/10 text-amber-700',
    }
  }

  return {
    label: 'Actif',
    className: 'bg-green-500/10 text-green-700',
  }
}

export function getEinvoicingBadge(config: EinvoicingConfig) {
  if (config.mode === 'b2brouter') {
    return {
      label: `B2Brouter ${config.environment}`,
      className: 'bg-green-500/10 text-green-700',
    }
  }

  if (config.mode === 'export_only') {
    return {
      label: 'Factur-X prêt',
      className: 'bg-amber-500/10 text-amber-700',
    }
  }

  return {
    label: 'Non configuré',
    className: 'bg-slate-500/10 text-slate-600',
  }
}
