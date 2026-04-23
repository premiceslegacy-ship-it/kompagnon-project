'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { sendEmail } from '@/lib/email'
import { buildInviteEmail } from '@/lib/email/templates'
import { resolveBusinessSelection, type BusinessActivityId, type BusinessProfileConfig } from '@/lib/catalog-context'

/** Génère un slug URL-safe unique depuis un nom d'entreprise. */
function buildSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) +
    '-' +
    Date.now().toString(36)
  )
}

function buildOrganizationCatalogDefaults(activityId: BusinessActivityId) {
  const { activity, profileConfig: config } = resolveBusinessSelection({ activityId })
  return {
    business_activity_id: activity.id,
    business_profile: config.businessProfile,
    label_set: config.labelSet,
    unit_set: config.unitSet,
    default_categories: config.defaultCategories,
    starter_presets: config.starterPresets,
  }
}

async function seedStarterPresetsIfNeeded(params: {
  admin: ReturnType<typeof createAdminClient>
  organizationId: string
  createdBy: string
  config: BusinessProfileConfig
}) {
  const { admin, organizationId, createdBy, config } = params

  const { count, error: countError } = await admin
    .from('prestation_types')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)

  if (countError) {
    console.error('[seedStarterPresetsIfNeeded] count error:', countError.message)
    return
  }

  if ((count ?? 0) > 0 || config.starterPresets.length === 0) return

  const templatePayload = config.starterPresets.map((preset) => ({
    organization_id: organizationId,
    name: preset.name,
    description: preset.description,
    unit: preset.unit,
    category: preset.category,
    profile_kind: preset.profile_kind,
    vat_rate: preset.vat_rate,
    created_by: createdBy,
  }))

  const { data: insertedTemplates, error: templateError } = await admin
    .from('prestation_types')
    .insert(templatePayload)
    .select('id, name')

  if (templateError) {
    console.error('[seedStarterPresetsIfNeeded] insert templates error:', templateError.message)
    return
  }

  const itemPayload = config.starterPresets.flatMap((preset) => {
    const template = insertedTemplates?.find((entry) => entry.name === preset.name)
    if (!template) return []

    return preset.lines.map((line, index) => ({
      prestation_type_id: template.id,
      organization_id: organizationId,
      position: index,
      item_type: line.item_type,
      designation: line.designation,
      quantity: line.quantity,
      unit: line.unit,
      unit_price_ht: line.unit_price_ht ?? 0,
      unit_cost_ht: line.unit_cost_ht ?? 0,
      is_internal: false,
    }))
  })

  if (itemPayload.length === 0) return

  const { error: itemError } = await admin
    .from('prestation_type_items')
    .insert(itemPayload)

  if (itemError) {
    console.error('[seedStarterPresetsIfNeeded] insert items error:', itemError.message)
  }
}

/**
 * Finalise l'onboarding :
 * 1. Met à jour l'organisation créée auto lors du signup (trigger SQL).
 * 2. Envoie les invitations email (optionnel).
 * 3. Marque profiles.onboarding_done = true.
 * Redirige vers /dashboard en cas de succès.
 */
export async function completeOnboarding(formData: FormData) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const companyName = (formData.get('company_name') as string)?.trim()
  const selection = resolveBusinessSelection({
    activityId: (formData.get('business_activity') as string | null) ?? null,
    businessProfile: (formData.get('business_profile') as string | null) ?? null,
    sector: (formData.get('sector') as string | null) ?? null,
  })
  const siret = (formData.get('siret') as string)?.trim() || null
  const logoUrl = (formData.get('logo_url') as string)?.trim() || null

  if (!companyName) redirect('/onboarding?error=missing_fields')

  // L'organisation est créée automatiquement par le trigger on_auth_user_created_init_org
  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) redirect('/onboarding?error=org_not_found')

  // Mettre à jour l'organisation avec les infos saisies
  const { error: orgError } = await supabase
    .from('organizations')
    .update({
      name: companyName,
      slug: buildSlug(companyName),
      sector: selection.sectorLabel,
      siret,
      logo_url: logoUrl,
      ...buildOrganizationCatalogDefaults(selection.activity.id),
    })
    .eq('id', organizationId)

  if (orgError) {
    console.error('[completeOnboarding] org update error:', orgError?.message)
    redirect('/onboarding?error=org_update_failed')
  }

  // Traiter les invitations (champs invite_email_0, invite_role_0, invite_email_1, …)
  const admin = createAdminClient()
  await seedStarterPresetsIfNeeded({
    admin,
    organizationId,
    createdBy: user.id,
    config: selection.profileConfig,
  })
  const inviteErrors: string[] = []

  // Récupérer le profil de l'invitant et les infos org pour les emails
  const [{ data: profile }, { data: org }] = await Promise.all([
    supabase.from('profiles').select('full_name').eq('id', user.id).single(),
    admin.from('organizations').select('name, email_from_address').eq('id', organizationId!).single(),
  ])

  let i = 0
  while (true) {
    const email = (formData.get(`invite_email_${i}`) as string | null)?.trim()
    const roleId = (formData.get(`invite_role_${i}`) as string | null)?.trim()
    if (!email) break

    if (!roleId) { i++; continue }

    // Insérer dans la table invitations
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const { error: inviteInsertError } = await supabase
      .from('invitations')
      .insert({
        organization_id: organizationId,
        invited_by: user.id,
        email,
        role_id: roleId,
        expires_at: expiresAt,
      })

    if (inviteInsertError) {
      console.error('[completeOnboarding] invite insert error:', inviteInsertError.message)
      inviteErrors.push(email)
      i++
      continue
    }

    // Si email expéditeur pas encore configuré, on skip l'envoi silencieusement
    // (l'owner peut renvoyer les invitations depuis Settings une fois l'email configuré)
    if (!org?.email_from_address) {
      i++
      continue
    }

    // Générer le lien magique sans envoyer l'email Supabase
    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: 'invite',
      email,
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/invite/accept`,
      },
    })

    if (linkError || !linkData?.properties?.action_link) {
      console.error('[completeOnboarding] generateLink error:', linkError?.message)
      inviteErrors.push(email)
      i++
      continue
    }

    // Envoyer l'email brandé via Resend
    const { subject, html } = buildInviteEmail({
      orgName: org.name,
      inviterName: profile?.full_name || user.email || 'Votre responsable',
      inviteUrl: linkData.properties.action_link,
    })

    const { error: sendError } = await sendEmail({
      organizationId: organizationId!,
      to: email,
      subject,
      html,
    })

    if (sendError) {
      console.error('[completeOnboarding] sendEmail error:', sendError)
      inviteErrors.push(email)
    }

    i++
  }

  // Marquer onboarding_done = true
  await supabase
    .from('profiles')
    .update({ onboarding_done: true })
    .eq('id', user.id)

  revalidatePath('/', 'layout')

  if (inviteErrors.length > 0) {
    redirect(`/dashboard?invite_errors=${encodeURIComponent(inviteErrors.join(','))}`)
  }

  redirect('/dashboard')
}

/**
 * Finalise l'onboarding sans envoyer d'invitations.
 * Utilisé par le bouton "Passer cette étape".
 */
export async function skipInvites(formData: FormData) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const companyName = (formData.get('company_name') as string)?.trim()
  const selection = resolveBusinessSelection({
    activityId: (formData.get('business_activity') as string | null) ?? null,
    businessProfile: (formData.get('business_profile') as string | null) ?? null,
    sector: (formData.get('sector') as string | null) ?? null,
  })
  const siret = (formData.get('siret') as string)?.trim() || null

  if (!companyName) redirect('/onboarding?error=missing_fields')

  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) redirect('/onboarding?error=org_not_found')

  const { error: orgError } = await supabase
    .from('organizations')
    .update({
      name: companyName,
      slug: buildSlug(companyName),
      sector: selection.sectorLabel,
      siret,
      ...buildOrganizationCatalogDefaults(selection.activity.id),
    })
    .eq('id', organizationId)

  if (orgError) {
    console.error('[skipInvites] org update error:', orgError?.message)
    redirect('/onboarding?error=org_update_failed')
  }

  await seedStarterPresetsIfNeeded({
    admin: createAdminClient(),
    organizationId,
    createdBy: user.id,
    config: selection.profileConfig,
  })

  await supabase
    .from('profiles')
    .update({ onboarding_done: true })
    .eq('id', user.id)

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}

/**
 * Permet à un salarié de rejoindre une organisation via son code d'invitation.
 * 1. Trouve l'org cible par join_code (admin client, bypass RLS).
 * 2. Réaffecte le membership orphelin (auto-créé au signup) vers l'org cible.
 * 3. Supprime l'org orpheline.
 * 4. Enregistre le poste et marque onboarding_done = true.
 */
export async function joinViaCode(formData: FormData) {
  const supabase = await createClient()
  const admin = createAdminClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const rawCode = (formData.get('join_code') as string | null)?.trim().toUpperCase()
  const jobTitle = (formData.get('job_title') as string | null)?.trim() || null

  if (!rawCode) redirect('/onboarding?error=invalid_code')

  // Trouver l'org cible par join_code
  const { data: targetOrg, error: orgLookupError } = await admin
    .from('organizations')
    .select('id')
    .eq('join_code', rawCode)
    .single()

  if (orgLookupError || !targetOrg) redirect('/onboarding?error=invalid_code')

  // Trouver le rôle Collaborateur dans l'org cible
  const { data: collabRole } = await admin
    .from('roles')
    .select('id')
    .eq('organization_id', targetOrg.id)
    .eq('slug', 'collaborateur')
    .single()

  if (!collabRole) redirect('/onboarding?error=join_failed')

  // Récupérer l'org orpheline (auto-créée au signup)
  const orphanOrgId = await getCurrentOrganizationId()

  // Réaffecter le membership existant vers l'org cible
  const { error: membershipError } = await admin
    .from('memberships')
    .update({
      organization_id: targetOrg.id,
      role_id: collabRole.id,
      accepted_at: new Date().toISOString(),
    })
    .eq('user_id', user.id)
    .eq('is_active', true)

  if (membershipError) {
    console.error('[joinViaCode] membership update error:', membershipError.message)
    redirect('/onboarding?error=join_failed')
  }

  // Supprimer l'org orpheline si différente de l'org cible
  if (orphanOrgId && orphanOrgId !== targetOrg.id) {
    await admin.from('organizations').delete().eq('id', orphanOrgId)
  }

  // Sauvegarder le poste + marquer onboarding terminé
  await supabase
    .from('profiles')
    .update({ job_title: jobTitle, onboarding_done: true })
    .eq('id', user.id)

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}
