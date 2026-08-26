import type { AccessStatus, SellableTier } from '@/lib/subscription-access'
import type { OrganizationModules } from '@/lib/organization-modules'
import type { QuotaFeature, QuotaUnit, SubscriptionTier, OverflowMode } from '@/lib/quota-catalog'
import type {
  EinvoicingAnnuaireStatus,
  EinvoicingConfig,
  EinvoicingEnvironment,
  EinvoicingMode,
  EinvoicingOauthStatus,
  EinvoicingProvider,
} from '@/lib/einvoicing-config'

export const AI_BILLING_MODES = ['orsayn_shared', 'client_owned'] as const
export type AIBillingMode = typeof AI_BILLING_MODES[number]

export type OperatorUsageEvent = {
  source_instance: string
  organization_id: string | null
  provider: string
  feature: string
  quota_feature: QuotaFeature | null
  model: string
  provider_cost: number | null
  currency: string
  total_tokens: number | null
  status: string
  occurred_at: string
}

export type OperatorClient = {
  source_instance: string
  organization_id: string | null
  label: string | null
  updated_at: string
}

export type OperatorClientSetting = {
  source_instance: string
  organization_id: string
  label: string | null
  monthly_fee_ht: number | string | null
  billing_currency: 'EUR' | 'USD'
  is_active: boolean
  app_url: string | null
  contact_email: string | null
  config_sync_status: string | null
  config_synced_at: string | null
  config_sync_error: string | null
}

export type OperatorClientSubscription = {
  source_instance: string
  organization_id: string
  tier: SubscriptionTier
  ai_billing_mode: AIBillingMode | null
  mrr_ht: number | string | null
  billing_currency: 'EUR' | 'USD'
  is_active: boolean
  renews_at: string | null
  trial_tier: SubscriptionTier | null
  trial_ends_at: string | null
  trial_converted: boolean | null
  einvoicing_mode: EinvoicingMode | null
  einvoicing_provider: EinvoicingProvider | null
  einvoicing_environment: EinvoicingEnvironment | null
  einvoicing_annuaire_status: EinvoicingAnnuaireStatus | null
  oauth_status: EinvoicingOauthStatus | null
  oauth_connected_at: string | null
  super_pdp_connection_id: string | null
  overflow_mode: OverflowMode
  notes: string | null
  preferred_tier: SellableTier | null
  access_status: AccessStatus | null
  trial_started_at: string | null
  access_ends_at: string | null
  cancel_at: string | null
  stripe_status: string | null
  payment_failed_at: string | null
}

export type OperatorClientEvent = {
  id: string
  source_instance: string
  organization_id: string | null
  event_category: string
  event_type: string
  actor_email: string | null
  metadata: Record<string, unknown> | null
  notes: string | null
  created_at: string
}

export type OperatorCommercialEvent = {
  id: string
  source_instance: string
  organization_id: string | null
  event_type: string
  tier_context: string | null
  sent_at: string
  sent_by: string
  actor_email: string | null
  email_template: string | null
  subject_preview: string | null
  body_text: string | null
  recipient_email: string | null
  delivery_status: string
  auto_send_after: string | null
  notes: string | null
  metadata: Record<string, unknown> | null
}

export type OperatorClientQuota = {
  source_instance: string
  organization_id: string
  quota_feature: QuotaFeature
  quota_unit: QuotaUnit
  quota_monthly: number | string
  current_quantity: number | string
  current_cost_eur: number | string
  period_start: string
}

export type ClientRow = {
  sourceInstance: string
  organizationId: string | null
  label: string
  tier: SubscriptionTier
  appUrl: string | null
  contactEmail: string | null
  configSyncStatus: string | null
  configSyncError: string | null
  monthlyFee: number | null
  billingCurrency: 'EUR' | 'USD'
  aiBillingMode: AIBillingMode
  isActive: boolean
  renewsAt: string | null
  trialEndsAt: string | null
  trialConverted: boolean
  preferredTier: SellableTier
  accessStatus: AccessStatus | null
  accessEndsAt: string | null
  cancelAt: string | null
  stripeStatus: string | null
  paymentFailedAt: string | null
  einvoicingConfig: EinvoicingConfig
  overflowMode: OverflowMode
  notes: string | null
  monthCost: number
  monthCostEur: number
  monthUsageCost: number
  monthUsageCostEur: number
  grossMargin: number | null
  grossMarginEur: number | null
  marginPct: number | null
  lastSeenAt: string | null
  lastStatus: string | null
  monthEventCount: number
  modules: OrganizationModules
  businessActivityId: string | null
  businessVerticalPackId: string | null
  hasMetalPricing: boolean
  quotas: OperatorClientQuota[]
  events: OperatorClientEvent[]
  commercialEvents: OperatorCommercialEvent[]
}

export type UsageAggregateRow = {
  key: string
  label: string
  events: number
  tokens: number
  usageCostEur: number
  orsaynCostEur: number
}

export type CommercialRecommendation = {
  id: string
  sourceInstance: string
  clientLabel: string
  title: string
  reason: string
  severity: 'high' | 'medium' | 'low'
  eventType: 'upgrade_prompt_quota' | 'usage_signal_client_owned'
  currentTier: SubscriptionTier
  suggestedTier: SubscriptionTier
  usageCostLabel: string
  notePlaceholder: string
}
