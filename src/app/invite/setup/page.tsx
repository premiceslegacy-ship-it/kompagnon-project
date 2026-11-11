import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import InviteSetupClient from './InviteSetupClient'

export default async function InviteSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ invitation_id?: string }>
}) {
  const { invitation_id: invitationId } = await searchParams
  if (!invitationId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(invitationId)) {
    redirect('/login?error=auth_callback_error')
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) redirect('/login')

  const admin = createAdminClient()
  const normalizedEmail = user.email.trim().toLowerCase()
  const { data: invitation } = await admin
    .from('invitations')
    .select('organization_id, role_id, password_setup_required')
    .eq('id', invitationId)
    .eq('email', normalizedEmail)
    .not('accepted_at', 'is', null)
    .maybeSingle()

  if (!invitation) redirect('/login?error=auth_callback_error')

  const [{ data: membership }, { data: org }, { data: profile }] = await Promise.all([
    admin
      .from('memberships')
      .select('id')
      .eq('user_id', user.id)
      .eq('organization_id', invitation.organization_id)
      .eq('role_id', invitation.role_id)
      .eq('is_active', true)
      .maybeSingle(),
    admin
      .from('organizations')
      .select('name')
      .eq('id', invitation.organization_id)
      .maybeSingle(),
    supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .maybeSingle(),
  ])

  if (!membership) redirect('/login?error=auth_callback_error')

  return (
    <Suspense>
      <InviteSetupClient
        orgName={org?.name ?? 'votre entreprise'}
        initialFullName={profile?.full_name ?? null}
        invitationId={invitationId}
        requiresPasswordSetup={invitation.password_setup_required}
      />
    </Suspense>
  )
}
