'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { sendEmail } from '@/lib/email'
import { buildInviteEmail } from '@/lib/email/templates'

/**
 * Change le rôle d'un membre de l'équipe.
 */
export async function updateMemberRole(membershipId: string, newRoleId: string): Promise<{ error: string | null }> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('memberships')
    .update({ role_id: newRoleId })
    .eq('id', membershipId)

  if (error) {
    console.error('[updateMemberRole]', error.message)
    return { error: 'Impossible de modifier le rôle. Veuillez réessayer.' }
  }

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
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) return { error: 'Organisation introuvable.' }

  // Récupérer les infos de l'invitant et de l'organisation
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .single()

  const { data: org } = await admin
    .from('organizations')
    .select('name, email_from_address')
    .eq('id', organizationId)
    .single()

  if (!org?.email_from_address) {
    return {
      error:
        "L'adresse email expéditeur n'est pas configurée. Rendez-vous dans Paramètres > Email.",
    }
  }

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  // Insérer l'invitation en DB
  const { error: insertError } = await supabase
    .from('invitations')
    .insert({
      organization_id: organizationId,
      invited_by: user.id,
      email,
      role_id: roleId,
      expires_at: expiresAt,
    })

  if (insertError) {
    console.error('[sendTeamInvite] insert error:', insertError.message)
    return { error: "Impossible de créer l'invitation. Veuillez réessayer." }
  }

  // Générer le lien d'invitation sans envoyer l'email Supabase
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'invite',
    email,
    options: {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/invite/accept`,
    },
  })

  if (linkError || !linkData?.properties?.action_link) {
    console.error('[sendTeamInvite] generateLink error:', linkError?.message)
    await supabase
      .from('invitations')
      .delete()
      .eq('email', email)
      .eq('organization_id', organizationId)
      .is('accepted_at', null)
    return { error: "Impossible de générer le lien d'invitation. Veuillez réessayer." }
  }

  const inviteUrl = linkData.properties.action_link

  // Envoyer l'email brandé via Resend
  const { subject, html } = buildInviteEmail({
    orgName: org.name,
    inviterName: profile?.full_name || user.email || 'Votre responsable',
    inviteUrl,
  })

  const { error: sendError } = await sendEmail({
    organizationId,
    to: email,
    subject,
    html,
  })

  if (sendError) {
    console.error('[sendTeamInvite] sendEmail error:', sendError)
    // Nettoyer l'invitation si l'envoi échoue
    await supabase
      .from('invitations')
      .delete()
      .eq('email', email)
      .eq('organization_id', organizationId)
      .is('accepted_at', null)
    return { error: sendError }
  }

  revalidatePath('/settings')
  return { error: null }
}

/**
 * Retire un membre de l'organisation (désactivation, pas suppression).
 */
export async function removeMember(membershipId: string): Promise<{ error: string | null }> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('memberships')
    .update({ is_active: false })
    .eq('id', membershipId)

  if (error) {
    console.error('[removeMember]', error.message)
    return { error: "Impossible de retirer ce membre. Veuillez réessayer." }
  }

  revalidatePath('/settings')
  return { error: null }
}
