import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

type InvitationAcceptance = {
  status: string
  password_setup_required?: boolean
}

function readAcceptance(value: unknown): InvitationAcceptance | null {
  if (typeof value !== 'object' || value === null || !('status' in value) || typeof value.status !== 'string') {
    return null
  }
  return {
    status: value.status,
    password_setup_required: 'password_setup_required' in value && value.password_setup_required === true,
  }
}

export default async function InviteAcceptPage({
  searchParams,
}: {
  searchParams: Promise<{ invitation_id?: string }>
}) {
  const { invitation_id: invitationId } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  if (!invitationId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(invitationId)) {
    return <InvitationAcceptanceError message="Ce lien d’invitation est invalide ou incomplet." />
  }

  const { data, error } = await supabase.rpc('accept_team_invitation', {
    p_invitation_id: invitationId,
  })
  if (error) {
    console.error('[InviteAcceptPage] invitation acceptance failed:', error.message)
    return <InvitationAcceptanceError message="Impossible d’accepter cette invitation pour le moment. Réessayez ou demandez un nouveau lien." />
  }

  const acceptance = readAcceptance(data)
  if (acceptance?.status === 'accepted') {
    redirect(`/invite/setup?invitation_id=${encodeURIComponent(invitationId)}`)
  }
  if (acceptance?.status === 'already_member') redirect('/dashboard')

  const message = acceptance?.status === 'already_member_elsewhere'
    ? 'Ce compte est déjà rattaché à une autre organisation. L’invitation n’a pas modifié cet accès. Demandez au responsable de l’organisation de vous inviter avec le compte approprié.'
    : acceptance?.status === 'expired'
      ? 'Cette invitation a expiré. Demandez au responsable de l’organisation de vous en envoyer une nouvelle.'
      : 'Cette invitation est invalide, déjà utilisée ou ne correspond pas au compte connecté.'

  return <InvitationAcceptanceError message={message} />
}

function InvitationAcceptanceError({ message }: { message: string }) {
  return (
    <main style={{ maxWidth: 520, margin: '10vh auto', padding: 24 }}>
      <h1>Invitation non acceptée</h1>
      <p>{message}</p>
      <a href="/dashboard">Continuer vers Atelier</a>
    </main>
  )
}
