import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getCachedOrganizationId } from './session-cache'
import {
  DEFAULT_ORGANIZATION_MODULES,
  normalizeOrganizationModules,
  type OrganizationModuleKey,
  type OrganizationModules,
} from '@/lib/organization-modules'

async function _getOrganizationModules(orgId?: string | null): Promise<OrganizationModules> {
  const targetOrgId = orgId ?? await getCachedOrganizationId()
  if (!targetOrgId) return { ...DEFAULT_ORGANIZATION_MODULES }

  const supabase = await createClient()

  const [modulesResult, orgResult] = await Promise.all([
    supabase
      .from('organization_modules')
      .select('modules')
      .eq('organization_id', targetOrgId)
      .maybeSingle(),
    supabase
      .from('organizations')
      .select('business_profile')
      .eq('id', targetOrgId)
      .maybeSingle(),
  ])

  if (modulesResult.error) {
    console.error('[getOrganizationModules]', modulesResult.error)
    return { ...DEFAULT_ORGANIZATION_MODULES }
  }

  return normalizeOrganizationModules(modulesResult.data?.modules, orgResult.data?.business_profile)
}

export const getOrganizationModules = cache(_getOrganizationModules)

export async function getOrganizationModulesAdmin(orgId: string): Promise<OrganizationModules> {
  const admin = createAdminClient()

  const [modulesResult, orgResult] = await Promise.all([
    admin
      .from('organization_modules')
      .select('modules')
      .eq('organization_id', orgId)
      .maybeSingle(),
    admin
      .from('organizations')
      .select('business_profile')
      .eq('id', orgId)
      .maybeSingle(),
  ])

  if (modulesResult.error) {
    console.error('[getOrganizationModulesAdmin]', modulesResult.error)
    return { ...DEFAULT_ORGANIZATION_MODULES }
  }

  return normalizeOrganizationModules(modulesResult.data?.modules, orgResult.data?.business_profile)
}

export async function isModuleEnabled(moduleKey: OrganizationModuleKey, orgId?: string | null): Promise<boolean> {
  const modules = await getOrganizationModules(orgId)
  return modules[moduleKey]
}

export async function isModuleEnabledAdmin(orgId: string, moduleKey: OrganizationModuleKey): Promise<boolean> {
  const modules = await getOrganizationModulesAdmin(orgId)
  return modules[moduleKey]
}

