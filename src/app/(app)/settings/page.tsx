import { headers } from 'next/headers'
import { getCurrentUserProfile } from '@/lib/data/queries/user'
import { getTeamMembers } from '@/lib/data/queries/team'
import { getOrgRoles, getOrgJoinCode, getRolesWithPermissions } from '@/lib/data/queries/roles'
import { getOrganization } from '@/lib/data/queries/organization'
import { getLaborRates, getMaterials, getPrestationTypes } from '@/lib/data/queries/catalog'
import { resolveCatalogContext } from '@/lib/catalog-context'
import { getWhatsAppConfig } from '@/lib/data/mutations/whatsapp'
import { getCurrentMembershipContext, hasPermission } from '@/lib/data/queries/membership'
import { getOrganizationExports } from '@/lib/data/queries/organization-exports'
import { getEmailTemplates } from '@/lib/data/queries/emailTemplates'
import { getPublicRuntimeConfig } from '@/lib/supabase/config'
import SettingsClient from './SettingsClient'

function getAppUrl(): string {
  const host = headers().get('host') ?? 'localhost:3000'
  const proto = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https'
  return `${proto}://${host}`
}

export default async function SettingsPage() {
  const [profile, members, roles, joinCode, organization, catalogMaterials, catalogLaborRates, catalogPrestationTypes, whatsappConfig, membership, organizationExports, emailTemplates, rolesWithPermissions, canInvite, canRemoveMembers, canEditRoles, canEditOrg] = await Promise.all([
    getCurrentUserProfile(),
    getTeamMembers(),
    getOrgRoles(),
    getOrgJoinCode(),
    getOrganization(),
    getMaterials(),
    getLaborRates(),
    getPrestationTypes(),
    getWhatsAppConfig(),
    getCurrentMembershipContext(),
    getOrganizationExports(),
    getEmailTemplates(),
    getRolesWithPermissions(),
    hasPermission('team.invite'),
    hasPermission('team.remove_members'),
    hasPermission('team.edit_roles'),
    hasPermission('settings.edit_org'),
  ])

  const catalogContext = resolveCatalogContext(organization)
  const { supabaseUrl } = getPublicRuntimeConfig()
  const sharedWabaDisplayNumber = process.env.NEXT_PUBLIC_SHARED_WABA_DISPLAY_NUMBER ?? null

  return (
    <SettingsClient
      initialFullName={profile?.full_name ?? null}
      initialEmail={profile?.email ?? null}
      members={members}
      roles={roles}
      joinCode={joinCode}
      organization={organization}
      appUrl={getAppUrl()}
      supabaseUrl={supabaseUrl}
      sharedWabaDisplayNumber={sharedWabaDisplayNumber}
      catalogMaterials={catalogMaterials}
      catalogLaborRates={catalogLaborRates}
      catalogPrestationTypes={catalogPrestationTypes}
      whatsappConfig={whatsappConfig}
      catalogContext={catalogContext}
      currentRoleSlug={membership?.roleSlug ?? null}
      organizationExports={organizationExports}
      emailTemplates={emailTemplates}
      rolesWithPermissions={rolesWithPermissions}
      canInvite={canInvite}
      canRemoveMembers={canRemoveMembers}
      canEditRoles={canEditRoles}
      canEditOrg={canEditOrg}
    />
  )
}
