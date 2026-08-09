import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getCachedOrganizationId } from './session-cache'
import { entitlementFromDb, type OrganizationEntitlement } from '@/lib/subscription-access'

export function isSelfServiceMode(): boolean {
  return process.env.SELF_SERVICE_MODE === 'true'
}

async function _getOrganizationEntitlement(orgId?: string | null): Promise<OrganizationEntitlement | null> {
  if (!isSelfServiceMode()) return null
  const organizationId = orgId ?? await getCachedOrganizationId()
  if (!organizationId) return null

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('organization_entitlements')
    .select('organization_id, access_status, effective_tier, preferred_tier, trial_started_at, trial_ends_at, access_ends_at, updated_at')
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (error) {
    console.error('[getOrganizationEntitlement]', error)
    return null
  }
  return data ? entitlementFromDb(data as Record<string, unknown>) : null
}

export const getOrganizationEntitlement = cache(_getOrganizationEntitlement)

export async function getOrganizationEntitlementAdmin(organizationId: string): Promise<OrganizationEntitlement | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('organization_entitlements')
    .select('organization_id, access_status, effective_tier, preferred_tier, trial_started_at, trial_ends_at, access_ends_at, updated_at')
    .eq('organization_id', organizationId)
    .maybeSingle()
  if (error) {
    console.error('[getOrganizationEntitlementAdmin]', error)
    return null
  }
  return data ? entitlementFromDb(data as Record<string, unknown>) : null
}
