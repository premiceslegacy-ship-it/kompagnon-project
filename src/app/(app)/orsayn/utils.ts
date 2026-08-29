import { getQuotaFeatureForTechnicalFeature, QUOTA_DEFINITIONS } from '@/lib/quota-catalog'
import { UNRESOLVED_ORGANIZATION_ID } from '@/lib/operator/trial-lifecycle'
import type { AIBillingMode, ClientRow, OperatorClientQuota, OperatorUsageEvent } from './types'
import type { EinvoicingConfig } from '@/lib/einvoicing-config'

const GLOBAL_CURRENCY = 'EUR'

/** Clé composite stable identifiant un client cockpit — une instance mutualisée
 *  porte plusieurs organisations, donc source_instance seul ne suffit jamais. */
export function clientKey(sourceInstance: string, organizationId: string | null): string {
  return `${sourceInstance}::${organizationId ?? UNRESOLVED_ORGANIZATION_ID}`
}

export function clientPath(sourceInstance: string, organizationId: string | null): string {
  return `/orsayn/clients/${encodeURIComponent(clientKey(sourceInstance, organizationId))}`
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
    client_archived: 'Fiche archivée',
    client_restored: 'Fiche restaurée',
    client_deleted: 'Fiche supprimée',
  }

  return labels[eventType] ?? 'Mise à jour du dossier'
}

export function getCommercialEventLabel(eventType: string): string {
  const labels: Record<string, string> = {
    upgrade_prompt_quota: 'Proposition de montée en gamme',
    manual_email: 'Email manuel',
    trial_expiry_7d: 'Relance essai J-7',
    trial_expiry_2d: 'Relance essai J-2',
    trial_expired: 'Essai expiré',
    subscription_activated: 'Abonnement activé',
  }

  return labels[eventType] ?? 'Action commerciale'
}

export function getSuggestedTier(tier: import('@/lib/quota-catalog').SubscriptionTier): import('@/lib/quota-catalog').SubscriptionTier {
  if (tier === 'setup_only') return 'starter'
  if (tier === 'starter') return 'pro'
  if (tier === 'pro') return 'expert'
  return 'expert'
}

export function getRecommendationClass(severity: 'high' | 'medium' | 'low'): string {
  if (severity === 'high') return 'bg-[rgb(var(--danger)/.10)] text-danger'
  if (severity === 'medium') return 'bg-[rgb(var(--warning)/.12)] text-warning'
  return 'bg-[rgb(var(--text-secondary)/.12)] text-secondary'
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
  return value === 'client_owned' ? 'Le client (sa propre clé)' : 'Orsayn'
}

export function formatCommercialStatus(row: Pick<ClientRow, 'tier' | 'aiBillingMode'>): string {
  if (row.aiBillingMode === 'client_owned') return 'Le client paie l’IA'
  return formatTier(row.tier)
}

export function formatTier(tier: import('@/lib/quota-catalog').SubscriptionTier): string {
  return {
    setup_only: 'Installation seule',
    starter: 'Essentiel',
    pro: 'Pro',
    expert: 'Expert',
  }[tier]
}

export function formatOverflowMode(mode: import('@/lib/quota-catalog').OverflowMode): string {
  return {
    block: 'Bloquer',
    upgrade_prompt: 'Proposer une montée en gamme',
    charge: 'Facturer en plus',
  }[mode]
}

export function formatSyncStatus(status: string | null): string {
  return {
    pending_manual: 'En attente de première configuration',
    pending: 'Configuration en cours',
    synced: 'Configuration à jour',
    failed: 'Échec de configuration',
    skipped: 'Configuration non envoyée',
  }[status ?? ''] ?? 'Pas encore configurée'
}

export function formatSeverity(severity: 'high' | 'medium' | 'low'): string {
  return { high: 'Urgent', medium: 'À surveiller', low: 'Info' }[severity]
}

export const MODULE_LABELS: Record<string, string> = {
  relances_ai: 'Relances intelligentes',
  weekly_summary: 'Synthèse hebdomadaire',
  quote_ai: 'Analyse des devis',
  planning_ai: 'Aide à la planification',
  chantier_assistant: 'Assistant chantier',
  sarah_assistant: 'Sarah, secrétaire métier',
  suggest_tasks: 'Suggestions de tâches',
  catalog_ai: 'Catalogue intelligent',
  document_import_ai: 'Import de documents',
  chantier_report_ai: 'Rapports de chantier',
  labor_estimate_ai: 'Estimation de main-d’œuvre',
  receipt_ocr: 'Lecture des tickets',
  voice_input: 'Saisie vocale',
  voice_live: 'Vocal live Sarah',
  whatsapp_agent: 'Assistant WhatsApp',
  whatsapp_ocr: 'Lecture des documents WhatsApp',
  whatsapp_proactive: 'WhatsApp proactif',
}

export function getLatestQuotaRows(quotas: OperatorClientQuota[]): OperatorClientQuota[] {
  const latestPeriods = new Map<string, string>()
  for (const quota of quotas) {
    const current = latestPeriods.get(quota.quota_feature)
    if (!current || quota.period_start > current) latestPeriods.set(quota.quota_feature, quota.period_start)
  }
  return quotas.filter((quota) => latestPeriods.get(quota.quota_feature) === quota.period_start)
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

  const quotaFeature = getQuotaFeatureForTechnicalFeature(event.feature)
  return quotaFeature ? QUOTA_DEFINITIONS[quotaFeature].label : 'Autre consommation IA'
}

export function getQuotaBadgeClass(quota: OperatorClientQuota): string {
  const monthly = normalizeNumber(quota.quota_monthly)
  const current = normalizeNumber(quota.current_quantity)
  if (monthly < 0) return 'bg-[rgb(var(--text-secondary)/.10)] text-secondary'
  if (monthly === 0 && current > 0) return 'bg-[rgb(var(--danger)/.10)] text-danger'
  const pct = monthly > 0 ? (current / monthly) * 100 : 0
  if (current > monthly) return 'bg-[rgb(var(--danger)/.10)] text-danger'
  if (pct >= 90) return 'bg-[rgb(var(--warning)/.12)] text-warning'
  if (pct >= 70) return 'bg-[rgb(var(--accent-primary)/.12)] text-accent'
  return 'bg-[rgb(var(--success)/.12)] text-success'
}

export function convertEurToCurrency(value: number, currency: 'EUR' | 'USD', usdToEurRate: number): number {
  if (currency === 'EUR') return value
  return usdToEurRate > 0 ? value / usdToEurRate : value
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
      className: 'bg-[rgb(var(--text-secondary)/.10)] text-secondary',
    }
  }

  const ageMs = Date.now() - new Date(lastSeenAt).getTime()
  const ageDays = ageMs / (1000 * 60 * 60 * 24)

  if (lastStatus === 'error' && ageDays <= 2) {
    return {
      label: 'Erreurs récentes',
      className: 'bg-[rgb(var(--danger)/.10)] text-danger',
    }
  }

  if (ageDays > 7) {
    return {
      label: 'Silencieux',
      className: 'bg-[rgb(var(--warning)/.12)] text-warning',
    }
  }

  return {
    label: 'Actif',
    className: 'bg-[rgb(var(--success)/.12)] text-success',
  }
}

export function getEinvoicingBadge(config: EinvoicingConfig) {
  if (config.mode === 'super_pdp') {
    if (config.oauth_status === 'connected') {
      if (config.emission_enabled && config.reception_enabled) {
        return {
          label: 'Factur-X : Émission + réception activées',
          className: 'bg-[rgb(var(--success)/.12)] text-success',
        }
      }
      if (config.emission_enabled || config.reception_enabled) {
        return {
          label: config.emission_enabled ? 'Factur-X : Émission activée' : 'Factur-X : Réception activée',
          className: 'bg-[rgb(var(--success)/.12)] text-success',
        }
      }
      return {
        label: 'Factur-X : Connecté, rien d\'activé',
        className: 'bg-[rgb(var(--warning)/.12)] text-warning',
      }
    }
    if (config.oauth_status === 'error') {
      return {
        label: 'Factur-X : Connexion à vérifier',
        className: 'bg-[rgb(var(--danger)/.10)] text-danger',
      }
    }
    return {
      label: 'Factur-X : Envoi automatisé à finaliser',
      className: 'bg-[rgb(var(--warning)/.12)] text-warning',
    }
  }

  if (config.mode === 'export_only') {
    return {
      label: 'Factur-X : Dépôt manuel',
      className: 'bg-[rgb(var(--warning)/.12)] text-warning',
    }
  }

  return {
    label: 'Factur-X : Non transmis',
    className: 'bg-[rgb(var(--text-secondary)/.10)] text-secondary',
  }
}
