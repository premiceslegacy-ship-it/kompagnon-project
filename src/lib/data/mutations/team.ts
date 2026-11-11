'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { canManageLaborRates, hasPermission } from '@/lib/data/queries/membership'
import { canAssignRoleToCurrentUser } from '@/lib/data/queries/roles'
import { sendEmail } from '@/lib/email'
import { buildInviteEmail } from '@/lib/email/templates'
import { logAuditEvent } from '@/lib/audit-log'
import { authUserExistsByEmail, buildInvitationCallbackUrl } from '@/lib/auth/invitation-link'

/**
 * Change le rôle d'un membre de l'équipe.
 * Réservé aux owners et admins - vérifié côté serveur.
 */
export async function updateMemberRole(membershipId: string, newRoleId: string): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }
  if (!(await hasPermission('team.edit_roles'))) return { error: 'Permission refusée.' }

  const { data: target } = await supabase
    .from('memberships')
    .select('id, user_id, roles ( slug )')
    .eq('id', membershipId)
    .eq('organization_id', orgId)
    .single()

  if (!target) return { error: 'Membre introuvable.' }
  if (target.user_id === user.id) return { error: 'Vous ne pouvez pas modifier votre propre rôle.' }

  const roles = target.roles as { slug: string } | { slug: string }[] | null
  const targetRole = Array.isArray(roles) ? roles[0] : roles
  if (targetRole?.slug === 'owner') {
    return { error: 'Le rôle du dirigeant ne peut pas être modifié.' }
  }
  if (!(await canAssignRoleToCurrentUser(orgId, newRoleId))) {
    return { error: 'Rôle invalide ou droits insuffisants.' }
  }

  const { error } = await supabase
    .from('memberships')
    .update({ role_id: newRoleId })
    .eq('id', membershipId)
    .eq('organization_id', orgId)

  if (error) {
    console.error('[updateMemberRole]', error.message)
    return { error: 'Impossible de modifier le rôle. Veuillez réessayer.' }
  }

  logAuditEvent({
    organizationId: orgId,
    actorId: user.id,
    action: 'audit.member.role_changed',
    entityType: 'membership',
    entityId: membershipId,
    metadata: { previous_role_slug: targetRole?.slug ?? null, new_role_id: newRoleId },
  }).catch(() => {})

  revalidatePath('/settings')
  return { error: null }
}

/**
 * Envoie une invitation email à un collaborateur.
 * 1. Insère l'invitation en DB.
 * 2. Génère le lien magique via Supabase Auth Admin (sans envoyer d'email Supabase).
 * 3. Envoie un email brandé via Resend.
 */
export async function sendTeamInvite(email: string, roleId: string): Promise<{ error: string | null }> {
  if (!(await hasPermission('team.invite'))) return { error: 'Permission refusée.' }

  const normalizedEmail = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return { error: 'Adresse email invalide.' }

  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) return { error: 'Organisation introuvable.' }
  if (!(await canAssignRoleToCurrentUser(organizationId, roleId))) {
    return { error: 'Rôle invalide ou droits insuffisants.' }
  }

  let userExists: boolean
  try {
    userExists = await authUserExistsByEmail(admin, normalizedEmail)
  } catch (error) {
    console.error('[sendTeamInvite] user lookup failed:', error)
    return { error: "Impossible de vérifier le compte invité. Veuillez réessayer." }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .single()

  const { data: org } = await admin
    .from('organizations')
    .select('name, logo_url')
    .eq('id', organizationId)
    .single()

  if (!org) return { error: 'Organisation introuvable.' }

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data: invitation, error: insertError } = await supabase
    .from('invitations')
    .insert({
      organization_id: organizationId,
      invited_by: user.id,
      email: normalizedEmail,
      role_id: roleId,
      password_setup_required: !userExists,
      expires_at: expiresAt,
    })
    .select('id')
    .single()

  if (insertError || !invitation) {
    console.error('[sendTeamInvite] insert error:', insertError?.message)
    return { error: "Impossible de créer l'invitation. Veuillez réessayer." }
  }

  const verificationType = userExists ? 'magiclink' : 'invite'
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: verificationType,
    email: normalizedEmail,
  })

  if (linkError || !linkData?.properties?.hashed_token) {
    console.error('[sendTeamInvite] generateLink error:', linkError?.message)
    await admin.from('invitations').delete().eq('id', invitation.id).eq('organization_id', organizationId)
    return { error: "Impossible de générer le lien d'invitation. Veuillez réessayer." }
  }

  let inviteUrl: string
  try {
    inviteUrl = buildInvitationCallbackUrl({
      tokenHash: linkData.properties.hashed_token,
      verificationType,
      invitationId: invitation.id,
    })
  } catch (error) {
    console.error('[sendTeamInvite] callback URL error:', error)
    await admin.from('invitations').delete().eq('id', invitation.id).eq('organization_id', organizationId)
    return { error: "Impossible de générer le lien d'invitation. Veuillez réessayer." }
  }

  const { subject, html } = buildInviteEmail({
    orgName: org.name,
    logoUrl: org.logo_url,
    inviterName: profile?.full_name || user.email || 'Votre responsable',
    inviteUrl,
  })

  const { error: sendError } = await sendEmail({
    organizationId,
    to: normalizedEmail,
    subject,
    html,
    allowAtelierReplyTo: true,
  })

  if (sendError) {
    console.error('[sendTeamInvite] sendEmail error:', sendError)
    await admin.from('invitations').delete().eq('id', invitation.id).eq('organization_id', organizationId)
    return { error: sendError }
  }

  revalidatePath('/settings')
  return { error: null }
}

/**
 * Met à jour le coût horaire interne d'un membre (s'applique à tous les chantiers).
 * Réservé aux owners et admins.
 */
export async function updateMemberLaborRate(
  membershipId: string,
  ratePerHour: number | null,
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  const { data: callerMembership } = await supabase
    .from('memberships')
    .select('roles ( slug )')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .single()

  const callerSlug = (callerMembership as any)?.roles?.slug ?? ''
  if (!['owner', 'admin'].includes(callerSlug)) {
    return { error: 'Action réservée aux administrateurs.' }
  }

  const { data: target } = await supabase
    .from('memberships')
    .select('id')
    .eq('id', membershipId)
    .eq('organization_id', orgId)
    .single()

  if (!target) return { error: 'Membre introuvable.' }

  const { error } = await supabase
    .from('memberships')
    .update({ labor_cost_per_hour: ratePerHour })
    .eq('id', membershipId)

  if (error) {
    console.error('[updateMemberLaborRate]', error.message)
    return { error: 'Impossible de mettre à jour le taux.' }
  }

  revalidatePath('/settings')
  revalidatePath('/chantiers', 'layout')
  return { error: null }
}

/**
 * Retire un membre de l'organisation (désactivation, pas suppression).
 */
export async function removeMember(membershipId: string): Promise<{ error: string | null }> {
  if (!(await hasPermission('team.remove_members'))) return { error: 'Permission refusée.' }

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  // Vérifier que l'appelant est owner ou admin
  const { data: callerMembership } = await supabase
    .from('memberships')
    .select('roles ( slug )')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .single()

  const callerSlug = (callerMembership as any)?.roles?.slug ?? ''
  if (!['owner', 'admin'].includes(callerSlug)) {
    return { error: 'Action réservée aux administrateurs.' }
  }

  // Vérifier que la cible est dans l'org et n'est pas owner
  const { data: target } = await supabase
    .from('memberships')
    .select('id, roles ( slug )')
    .eq('id', membershipId)
    .eq('organization_id', orgId)
    .single()

  if (!target) return { error: 'Membre introuvable.' }
  if ((target as any).roles?.slug === 'owner') {
    return { error: 'Le dirigeant ne peut pas être retiré.' }
  }

  const { data: targetRow } = await supabase
    .from('memberships')
    .select('user_id')
    .eq('id', membershipId)
    .single()

  const { error } = await supabase
    .from('memberships')
    .update({ is_active: false })
    .eq('id', membershipId)

  if (error) {
    console.error('[removeMember]', error.message)
    return { error: "Impossible de retirer ce membre. Veuillez réessayer." }
  }

  // Un accès retiré doit le être réellement : sans cela le refresh token
  // survivait, les notifications financières continuaient d'arriver, et les
  // liens magiques déjà émis restaient valides.
  const targetUserId = (targetRow as { user_id?: string } | null)?.user_id
  if (targetUserId) {
    const admin = createAdminClient()
    await admin.from('push_subscriptions').delete().eq('user_id', targetUserId)
    await admin.auth.admin.signOut(targetUserId, 'global').catch(() => null)
  }

  logAuditEvent({
    organizationId: orgId,
    actorId: user.id,
    action: 'audit.member.removed',
    entityType: 'membership',
    entityId: membershipId,
    metadata: { previous_role_slug: (target as any).roles?.slug ?? null },
  }).catch(() => {})

  revalidatePath('/settings')
  return { error: null }
}
