import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import {
  DEFAULT_ORGANIZATION_MODULES,
  normalizeOrganizationModules,
  type OrganizationModuleKey,
  type OrganizationModules,
} from '@/lib/organization-modules'

async function getCurrentOrganizationIdFromSession(): Promise<string | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data: membership } = await supabase
    .from('memberships')
    .select('organization_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single()

  return membership?.organization_id ?? null
}

export async function getOrganizationModules(orgId?: string | null): Promise<OrganizationModules> {
  const targetOrgId = orgId ?? await getCurrentOrganizationIdFromSession()
  if (!targetOrgId) return { ...DEFAULT_ORGANIZATION_MODULES }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('organization_modules')
    .select('modules')
    .eq('organization_id', targetOrgId)
    .maybeSingle()

  if (error) {
    console.error('[getOrganizationModules]', error)
    return { ...DEFAULT_ORGANIZATION_MODULES }
  }

  return normalizeOrganizationModules(data?.modules)
}

export async function getOrganizationModulesAdmin(orgId: string): Promise<OrganizationModules> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('organization_modules')
    .select('modules')
    .eq('organization_id', orgId)
    .maybeSingle()

  if (error) {
    console.error('[getOrganizationModulesAdmin]', error)
    return { ...DEFAULT_ORGANIZATION_MODULES }
  }

  return normalizeOrganizationModules(data?.modules)
}

export async function isModuleEnabled(moduleKey: OrganizationModuleKey, orgId?: string | null): Promise<boolean> {
  const modules = await getOrganizationModules(orgId)
  return modules[moduleKey]
}

export async function isModuleEnabledAdmin(orgId: string, moduleKey: OrganizationModuleKey): Promise<boolean> {
  const modules = await getOrganizationModulesAdmin(orgId)
  return modules[moduleKey]
}

