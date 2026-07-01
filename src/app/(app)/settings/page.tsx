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
import { getMetalPriceGrids } from '@/lib/data/mutations/metal-price-grids'
import { getSuppliers } from '@/lib/data/queries/suppliers'
import { getQuoteClauseTemplates } from '@/lib/data/queries/clause-templates'
import { getOrganizationModules } from '@/lib/data/queries/organization-modules'
import SettingsClient from './SettingsClient'

const SETTINGS_TABS = new Set([
  'profil',
  'entreprise',
  'devis',
  'equipe',
  'roles',
  'emails',
  'integration',
  'formulaire',
  'confidentialite',
  'whatsapp',
  'securite',
  'abonnement',
])

function getAppUrl(): string {
  const host = headers().get('host') ?? 'localhost:3000'
  const proto = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https'
  return `${proto}://${host}`
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: { tab?: string }
}) {
  const requestedTab = searchParams?.tab ?? 'profil'
  const initialTab = SETTINGS_TABS.has(requestedTab) ? requestedTab : 'profil'

  const [profile, members, roles, joinCode, organization, catalogMaterials, catalogLaborRates, catalogPrestationTypes, suppliers, whatsappConfig, membership, organizationExports, emailTemplates, rolesWithPermissions, canInvite, canRemoveMembers, canEditRoles, canEditOrg, initialMetalPriceGrids, initialClauseTemplates, organizationModules] = await Promise.all([
    getCurrentUserProfile(),
    getTeamMembers(),
    getOrgRoles(),
    getOrgJoinCode(),
    getOrganization(),
    getMaterials(),
    getLaborRates(),
    getPrestationTypes(),
    getSuppliers(),
    getWhatsAppConfig(),
    getCurrentMembershipContext(),
    getOrganizationExports(),
    getEmailTemplates(),
    getRolesWithPermissions(),
    hasPermission('team.invite'),
    hasPermission('team.remove_members'),
    hasPermission('team.edit_roles'),
    hasPermission('settings.edit_org'),
    getMetalPriceGrids(),
    getQuoteClauseTemplates(),
    getOrganizationModules(),
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
      suppliers={suppliers}
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
      initialTab={initialTab}
      initialMetalPriceGrids={initialMetalPriceGrids}
      hasMetalPricing={organization?.has_metal_pricing ?? false}
      initialClauseTemplates={initialClauseTemplates}
      organizationModules={organizationModules}
      stripeLinkStarter={process.env.NEXT_PUBLIC_STRIPE_LINK_STARTER ?? null}
      stripeLinkPro={process.env.NEXT_PUBLIC_STRIPE_LINK_PRO ?? null}
      stripeLinkExpert={process.env.NEXT_PUBLIC_STRIPE_LINK_EXPERT ?? null}
    />
  )
}
