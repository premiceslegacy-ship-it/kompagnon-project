import { headers } from 'next/headers'
import { getCurrentUserProfile } from '@/lib/data/queries/user'
import { getTeamMembers } from '@/lib/data/queries/team'
import { getOrgRoles, getOrgJoinCode } from '@/lib/data/queries/roles'
import { getOrganization } from '@/lib/data/queries/organization'
import { getMaterials, getPrestationTypes } from '@/lib/data/queries/catalog'
import { resolveCatalogContext } from '@/lib/catalog-context'
import { getWhatsAppConfig } from '@/lib/data/mutations/whatsapp'
import { getCurrentMembershipContext } from '@/lib/data/queries/membership'
import { getOrganizationExports } from '@/lib/data/queries/organization-exports'
import { getOrganizationModules } from '@/lib/data/queries/organization-modules'
import SettingsClient from './SettingsClient'

function getAppUrl(): string {
  const host = headers().get('host') ?? 'localhost:3000'
  const proto = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https'
  return `${proto}://${host}`
}

export default async function SettingsPage() {
  const [profile, members, roles, joinCode, organization, catalogMaterials, catalogPrestationTypes, whatsappConfig, membership, organizationExports, modules] = await Promise.all([
    getCurrentUserProfile(),
    getTeamMembers(),
    getOrgRoles(),
    getOrgJoinCode(),
    getOrganization(),
    getMaterials(),
    getPrestationTypes(),
    getWhatsAppConfig(),
    getCurrentMembershipContext(),
    getOrganizationExports(),
    getOrganizationModules(),
  ])

  const catalogContext = resolveCatalogContext(organization)

  return (
    <SettingsClient
      initialFullName={profile?.full_name ?? null}
      initialEmail={profile?.email ?? null}
      members={members}
      roles={roles}
      joinCode={joinCode}
      organization={organization}
      appUrl={getAppUrl()}
      catalogMaterials={catalogMaterials}
      catalogPrestationTypes={catalogPrestationTypes}
      whatsappConfig={whatsappConfig}
      catalogContext={catalogContext}
      currentRoleSlug={membership?.roleSlug ?? null}
      organizationExports={organizationExports}
      modules={modules}
    />
  )
}
