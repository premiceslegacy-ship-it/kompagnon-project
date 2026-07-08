'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { getMemberSession } from '@/lib/auth/member-session'

type Result = { error: string | null }

/**
 * Enregistre l'abonnement push d'un membre sans compte auth (espace /mon-espace).
 * Utilisé pour que les intervenants terrain reçoivent les alertes planning
 * (nouveau créneau, modification, annulation) sans jamais avoir créé de compte.
 */
export async function subscribeMemberToPush(input: {
  endpoint: string
  keys: { p256dh: string; auth: string }
}): Promise<Result> {
  const session = await getMemberSession()
  if (!session) return { error: 'Session expirée. Reconnectez-vous via votre lien.' }
  if (!session.memberId) return { error: 'Session invalide. Reconnectez-vous via votre lien.' }

  if (!input.endpoint || !input.keys?.p256dh || !input.keys?.auth) {
    return { error: 'Abonnement invalide.' }
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('push_subscriptions')
    .upsert(
      {
        organization_id: session.organizationId,
        member_id: session.memberId,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
      },
      { onConflict: 'member_id,endpoint' },
    )

  if (error) {
    console.error('[subscribeMemberToPush]', error.message)
    return { error: 'Impossible d\'activer les notifications.' }
  }
  return { error: null }
}

export async function unsubscribeMemberFromPush(endpoint: string): Promise<Result> {
  const session = await getMemberSession()
  if (!session?.memberId) return { error: 'Session invalide.' }

  const admin = createAdminClient()
  await admin
    .from('push_subscriptions')
    .delete()
    .eq('member_id', session.memberId)
    .eq('endpoint', endpoint)

  return { error: null }
}
