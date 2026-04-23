import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Page d'acceptation d'une invitation email.
 *
 * Flow :
 * 1. L'invitant envoie une invitation → invitation insérée en DB + email Supabase
 * 2. L'invité clique le lien → /auth/callback?next=/invite/accept → session créée
 * 3. Cette page trouve l'invitation, crée le membership, marque onboarding_done
 * 4. Redirige vers /dashboard
 */
export default async function InviteAcceptPage() {
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Chercher une invitation non expirée et non acceptée pour cet email
  const { data: invitation } = await admin
    .from('invitations')
    .select('id, organization_id, role_id')
    .eq('email', user.email!)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!invitation) {
    // Pas d'invitation valide → vérifier si l'utilisateur a déjà un membership
    const { data: membership } = await admin
      .from('memberships')
      .select('id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single()

    if (membership) {
      // Deuxième clic sur le lien ou invitation déjà acceptée → dashboard
      await supabase.from('profiles').update({ onboarding_done: true }).eq('id', user.id)
      redirect('/dashboard')
    }

    // Aucune invitation et aucun membership → onboarding normal
    redirect('/onboarding')
  }

  // Vérifier si l'utilisateur a un membership existant (org orpheline créée par le trigger
  // si la migration 011 n'a pas encore été appliquée, ou cas de re-invitation)
  const { data: existingMembership } = await admin
    .from('memberships')
    .select('id, organization_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single()

  if (existingMembership) {
    if (existingMembership.organization_id !== invitation.organization_id) {
      // Déplacer le membership vers l'org de l'invitation
      await admin
        .from('memberships')
        .update({
          organization_id: invitation.organization_id,
          role_id: invitation.role_id,
          accepted_at: new Date().toISOString(),
        })
        .eq('id', existingMembership.id)

      // Supprimer l'org orpheline si elle n'a plus aucun membre actif
      const { count } = await admin
        .from('memberships')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', existingMembership.organization_id)
        .eq('is_active', true)

      if (count === 0) {
        await admin.from('organizations').delete().eq('id', existingMembership.organization_id)
      }
    }
  } else {
    // Aucun membership (trigger patché ou cas normal) → créer directement
    await admin.from('memberships').insert({
      organization_id: invitation.organization_id,
      user_id: user.id,
      role_id: invitation.role_id,
      accepted_at: new Date().toISOString(),
      is_active: true,
    })
  }

  // Marquer l'invitation comme acceptée
  // onboarding_done reste false jusqu'à /invite/setup pour forcer le remplissage du profil
  await Promise.all([
    admin
      .from('invitations')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', invitation.id),
    supabase
      .from('profiles')
      .update({ onboarding_done: true })
      .eq('id', user.id),
  ])

  redirect('/invite/setup')
}
