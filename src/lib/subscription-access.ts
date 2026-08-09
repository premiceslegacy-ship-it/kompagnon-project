import type { SubscriptionTier } from '@/lib/quota-catalog'

export const SELLABLE_TIERS = ['pro', 'expert'] as const
export type SellableTier = typeof SELLABLE_TIERS[number]

export const ACCESS_STATUSES = [
  'locked',
  'trialing',
  'active',
  'past_due',
  'canceling',
  'expired',
  'unpaid',
] as const

export type AccessStatus = typeof ACCESS_STATUSES[number]

export type OrganizationEntitlement = {
  organizationId: string
  accessStatus: AccessStatus
  effectiveTier: SubscriptionTier
  preferredTier: SellableTier
  trialStartedAt: string | null
  trialEndsAt: string | null
  accessEndsAt: string | null
  updatedAt?: string | null
}

export type EntitlementSyncPayload = {
  access_status: AccessStatus
  effective_tier: SubscriptionTier
  preferred_tier: SellableTier
  trial_started_at: string | null
  trial_ends_at: string | null
  access_ends_at: string | null
}

export function isSellableTier(value: unknown): value is SellableTier {
  return typeof value === 'string' && (SELLABLE_TIERS as readonly string[]).includes(value)
}

export function isAccessStatus(value: unknown): value is AccessStatus {
  return typeof value === 'string' && (ACCESS_STATUSES as readonly string[]).includes(value)
}

function isFuture(value: string | null | undefined, now: number): boolean {
  if (!value) return false
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) && timestamp > now
}

/**
 * Le timestamp local est volontairement autoritaire pour fermer un essai même
 * si le cron cockpit ou un webhook Stripe est momentanément en retard.
 */
export function hasActiveAccess(
  entitlement: Pick<OrganizationEntitlement, 'accessStatus' | 'trialEndsAt' | 'accessEndsAt'> | null,
  now = Date.now(),
): boolean {
  if (!entitlement) return false
  if (entitlement.accessStatus === 'active' || entitlement.accessStatus === 'past_due') return true
  if (entitlement.accessStatus === 'trialing') return isFuture(entitlement.trialEndsAt, now)
  if (entitlement.accessStatus === 'canceling') return isFuture(entitlement.accessEndsAt, now)
  return false
}

export function getDisplayAccessStatus(
  entitlement: Pick<OrganizationEntitlement, 'accessStatus' | 'trialEndsAt' | 'accessEndsAt'>,
  now = Date.now(),
): AccessStatus {
  if (entitlement.accessStatus === 'trialing' && !isFuture(entitlement.trialEndsAt, now)) return 'expired'
  if (entitlement.accessStatus === 'canceling' && !isFuture(entitlement.accessEndsAt, now)) return 'expired'
  return entitlement.accessStatus
}

export function entitlementFromDb(row: Record<string, unknown>): OrganizationEntitlement | null {
  if (!isAccessStatus(row.access_status) || !isSellableTier(row.preferred_tier)) return null
  const tier = typeof row.effective_tier === 'string' ? row.effective_tier as SubscriptionTier : 'setup_only'
  return {
    organizationId: String(row.organization_id ?? ''),
    accessStatus: row.access_status,
    effectiveTier: tier,
    preferredTier: row.preferred_tier,
    trialStartedAt: typeof row.trial_started_at === 'string' ? row.trial_started_at : null,
    trialEndsAt: typeof row.trial_ends_at === 'string' ? row.trial_ends_at : null,
    accessEndsAt: typeof row.access_ends_at === 'string' ? row.access_ends_at : null,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
  }
}
