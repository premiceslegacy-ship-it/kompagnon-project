import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import InviteSetupClient from './InviteSetupClient'

/**
 * Page de configuration du profil pour les utilisateurs invités.
 * Accessible uniquement après acceptation d'une invitation (/invite/accept).
 */
export default async function InviteSetupPage() {
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Récupérer le profil de l'utilisateur
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, onboarding_done')
    .eq('id', user.id)
    .single()

  // Si pas encore passé par /invite/accept, rediriger
  if (!profile || profile.onboarding_done === false) {
    // Vérifier s'il a bien un membership (invitation acceptée)
    const { data: membership } = await admin
      .from('memberships')
      .select('organization_id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single()

    if (!membership) redirect('/login')
  }

  // Récupérer le nom de l'organisation
  const { data: membership } = await admin
    .from('memberships')
    .select('organization_id, organizations(name)')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single()

  const orgName =
    (membership?.organizations as { name?: string } | null)?.name ?? 'votre entreprise'

  return (
    <Suspense>
      <InviteSetupClient
        orgName={orgName}
        initialFullName={profile?.full_name ?? null}
      />
    </Suspense>
  )
}
