import { randomUUID } from 'node:crypto'
import type { QualificationTenant } from './fixtures'
import { isLocalSupabaseUrl } from '../tests/isolation/seed-safety'

export type NavigationActor = {
  userId: string
  email: string
  password: string
  roleSlug: 'collaborateur' | 'employee'
  permissionKeys: string[]
  dispose: () => Promise<void>
}

export async function provisionNavigationActor(
  tenant: QualificationTenant,
  roleSlug: NavigationActor['roleSlug'],
): Promise<NavigationActor> {
  const localUrl = process.env.SUPABASE_URL ?? ''
  if (!isLocalSupabaseUrl(localUrl) || new URL(localUrl).protocol !== 'http:'
    || !isLocalSupabaseUrl(tenant.baseUrl)
    || !/^qualification-owner-[a-f0-9]+@atelier\.test$/.test(tenant.email)) {
    throw new Error('Navigation actors require an explicitly local generated qualification tenant.')
  }
  const { admin } = tenant
  const email = `qualification-navigation-${roleSlug}-${randomUUID()}@atelier.test`
  const password = `Qualification-${randomUUID()}-A9!`
  let userId: string | null = null
  let ownedOrganizationId: string | null = null

  async function generatedOwnedOrganization(): Promise<string | null> {
    if (!userId) return null
    const result = await admin.from('memberships').select('organization_id,roles(slug)').eq('user_id', userId).eq('is_active', true)
    if (result.error) throw new Error('Could not inspect the generated navigation membership.')
    let owned: string | null = null
    for (const membership of result.data ?? []) {
      const role = Array.isArray(membership.roles) ? membership.roles[0] : membership.roles
      if (role?.slug !== 'owner' || membership.organization_id === tenant.orgId) continue
      if (owned && owned !== membership.organization_id) throw new Error('Generated navigation ownership is ambiguous.')
      owned = membership.organization_id
    }
    return owned
  }

  async function dispose(): Promise<void> {
    let failed = false
    if (userId && !ownedOrganizationId) {
      try { ownedOrganizationId = await generatedOwnedOrganization() }
      catch { failed = true }
    }
    if (ownedOrganizationId && userId) {
      if (ownedOrganizationId === tenant.orgId) throw new Error('Refusing to delete the parent qualification organization.')
      const result = await admin.from('organizations').delete().eq('id', ownedOrganizationId)
      if (result.error) failed = true
      else ownedOrganizationId = null
    }
    if (userId && !failed) {
      const result = await admin.auth.admin.deleteUser(userId)
      if (result.error) failed = true
      else userId = null
    }
    if (failed) throw new Error('Could not clean up the generated local navigation actor.')
  }

  try {
    const role = await admin.from('roles').select('id').eq('organization_id', tenant.orgId).eq('slug', roleSlug).single()
    if (role.error || !role.data) throw new Error('The generated tenant has no expected navigation role.')
    const created = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { full_name: roleSlug === 'employee' ? 'Intervenant de qualification' : 'Collaborateur de qualification' },
    })
    if (created.error || !created.data.user) throw new Error('Could not create the generated local navigation account.')
    userId = created.data.user.id
    for (let attempt = 0; attempt < 40 && !ownedOrganizationId; attempt++) {
      ownedOrganizationId = await generatedOwnedOrganization()
      if (!ownedOrganizationId) await new Promise(resolve => setTimeout(resolve, 150))
    }
    if (!ownedOrganizationId || ownedOrganizationId === tenant.orgId) throw new Error('Could not prove the generated actor organization.')

    // Reuse the scoped membership replacement from tests/isolation/seed.mts.
    const removed = await admin.from('memberships').delete().eq('user_id', userId).eq('organization_id', ownedOrganizationId)
    if (removed.error) throw new Error('Could not detach the generated navigation membership.')
    const attached = await admin.from('memberships').insert({
      organization_id: tenant.orgId, user_id: userId, role_id: role.data.id,
      is_active: true, accepted_at: new Date().toISOString(),
    })
    if (attached.error) throw new Error('Could not attach the generated navigation role.')
    const removedOrganization = await admin.from('organizations').delete().eq('id', ownedOrganizationId)
    if (removedOrganization.error) throw new Error('Could not remove the generated temporary organization.')
    ownedOrganizationId = null
    const profile = await admin.from('profiles').update({ onboarding_done: true }).eq('id', userId)
    if (profile.error) throw new Error('Could not complete the generated navigation profile.')
    const permissions = await admin.from('role_permissions').select('permission_key').eq('role_id', role.data.id).eq('is_allowed', true)
    if (permissions.error) throw new Error('Could not read the generated navigation role permissions.')
    return { userId, email, password, roleSlug, permissionKeys: (permissions.data ?? []).map(row => row.permission_key), dispose }
  } catch (error) {
    await dispose()
    throw error
  }
}
