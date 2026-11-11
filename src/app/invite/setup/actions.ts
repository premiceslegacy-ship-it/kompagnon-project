'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function completeInviteSetup(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) redirect('/login')

  const fullName = (formData.get('full_name') as string | null)?.trim() ?? ''
  const jobTitle = (formData.get('job_title') as string | null)?.trim() || null
  const password = (formData.get('password') as string | null) ?? ''
  const invitationId = (formData.get('invitation_id') as string | null) ?? ''
  if (!fullName) redirect('/invite/setup?error=missing_name')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(invitationId)) {
    redirect('/invite/setup?error=invalid_invitation')
  }

  const admin = createAdminClient()
  const { data: invitation } = await admin
    .from('invitations')
    .select('organization_id, role_id, password_setup_required')
    .eq('id', invitationId)
    .eq('email', user.email.trim().toLowerCase())
    .not('accepted_at', 'is', null)
    .maybeSingle()

  if (!invitation) redirect('/invite/setup?error=invalid_invitation')

  const { data: membership } = await admin
    .from('memberships')
    .select('id')
    .eq('user_id', user.id)
    .eq('organization_id', invitation.organization_id)
    .eq('role_id', invitation.role_id)
    .eq('is_active', true)
    .maybeSingle()
  if (!membership) redirect('/invite/setup?error=invalid_invitation')

  if (invitation.password_setup_required && password.length < 8) {
    redirect('/invite/setup?error=missing_password')
  }

  const { error: profileError } = await supabase
    .from('profiles')
    .update({ full_name: fullName, job_title: jobTitle })
    .eq('id', user.id)

  if (profileError) {
    console.error('[completeInviteSetup] profile error:', profileError.message)
    redirect('/invite/setup?error=update_failed')
  }

  if (invitation.password_setup_required) {
    const { error: passwordError } = await supabase.auth.updateUser({ password })
    if (passwordError) {
      console.error('[completeInviteSetup] password error:', passwordError.message)
      redirect('/invite/setup?error=password_failed')
    }
    await supabase.auth.signOut({ scope: 'others' })
  }

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}
