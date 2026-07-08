import webpush from 'web-push'
import { createAdminClient } from '@/lib/supabase/admin'

let vapidConfigured = false
let vapidWarningLogged = false

function ensureVapidConfigured(): boolean {
  if (vapidConfigured) return true

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY

  if (!publicKey || !privateKey) {
    if (!vapidWarningLogged) {
      console.warn('[push] VAPID keys missing, push notifications disabled.')
      vapidWarningLogged = true
    }
    return false
  }

  webpush.setVapidDetails(
    'mailto:' + (process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? 'contact@atelierbyorsayn.fr'),
    publicKey,
    privateKey
  )
  vapidConfigured = true
  return true
}

export type PushPayload = {
  title: string
  body: string
  url?: string
}

function absolutePayload(payload: PushPayload) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  return JSON.stringify({
    ...payload,
    icon: `${appUrl}/icon-192.png`,
    url: payload.url ? `${appUrl}${payload.url}` : appUrl,
  })
}

async function sendToSubscriptions(subs: Array<{ endpoint: string; p256dh: string; auth: string }>, payload: PushPayload) {
  if (!subs || subs.length === 0) return
  const body = absolutePayload(payload)
  const results = await Promise.allSettled(
    subs.map((sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
      )
    )
  )

  // Nettoyage : un abonnement expiré/révoqué répond 404 ou 410 (Gone) — sans
  // suppression, la table s'accumule d'endpoints morts et chaque envoi futur
  // retente pour rien indéfiniment.
  const deadEndpoints: string[] = []
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      const statusCode = (result.reason as { statusCode?: number } | undefined)?.statusCode
      if (statusCode === 404 || statusCode === 410) deadEndpoints.push(subs[i].endpoint)
    }
  })
  if (deadEndpoints.length > 0) {
    const admin = createAdminClient()
    await admin.from('push_subscriptions').delete().in('endpoint', deadEndpoints)
  }
}

export async function sendPushToUser(userId: string, payload: PushPayload) {
  if (!ensureVapidConfigured()) return

  const admin = createAdminClient()
  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId)

  if (!subs || subs.length === 0) return

  await sendToSubscriptions(subs, payload)
}

export async function sendPushToUsers(userIds: string[], payload: PushPayload, excludeUserId?: string | null) {
  if (!ensureVapidConfigured()) return

  const uniqueUserIds = [...new Set(userIds.filter(Boolean))]
    .filter(userId => !excludeUserId || userId !== excludeUserId)
  if (uniqueUserIds.length === 0) return

  const admin = createAdminClient()
  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .in('user_id', uniqueUserIds)

  await sendToSubscriptions(subs ?? [], payload)
}

/** Membres sans compte auth (espace /mon-espace) abonnés via member_id. */
export async function sendPushToMembers(memberIds: string[], payload: PushPayload) {
  if (!ensureVapidConfigured()) return

  const uniqueMemberIds = [...new Set(memberIds.filter(Boolean))]
  if (uniqueMemberIds.length === 0) return

  const admin = createAdminClient()
  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .in('member_id', uniqueMemberIds)

  await sendToSubscriptions(subs ?? [], payload)
}

/**
 * Envoie aux destinataires d'un événement planning, qu'ils aient un compte auth
 * (user_id) ou non (member_id, intervenants terrain via /mon-espace).
 */
export async function sendPushToPlanningRecipients(
  recipients: { userIds: string[]; memberIds: string[] },
  payload: PushPayload,
  excludeUserId?: string | null,
) {
  await Promise.all([
    sendPushToUsers(recipients.userIds, payload, excludeUserId),
    sendPushToMembers(recipients.memberIds, payload),
  ])
}

export async function sendPushToOrgPermission(
  orgId: string,
  permissionKey: string,
  payload: PushPayload,
  excludeUserId?: string | null,
) {
  if (!ensureVapidConfigured()) return

  const admin = createAdminClient()
  const { data: memberships } = await admin
    .from('memberships')
    .select('user_id, roles(id, slug)')
    .eq('organization_id', orgId)
    .eq('is_active', true)

  const roleIds = [...new Set((memberships ?? [])
    .map((m: any) => {
      const role = Array.isArray(m.roles) ? m.roles[0] : m.roles
      return role?.id as string | undefined
    })
    .filter(Boolean))]

  const { data: rolePerms } = roleIds.length > 0
    ? await admin
        .from('role_permissions')
        .select('role_id')
        .eq('permission_key', permissionKey)
        .eq('is_allowed', true)
        .in('role_id', roleIds)
    : { data: [] as any[] }

  const allowedRoleIds = new Set((rolePerms ?? []).map((rp: any) => rp.role_id))
  const userIds = (memberships ?? [])
    .filter((m: any) => {
      const role = Array.isArray(m.roles) ? m.roles[0] : m.roles
      return role?.slug === 'owner' || allowedRoleIds.has(role?.id)
    })
    .map((m: any) => m.user_id)

  await sendPushToUsers(userIds, payload, excludeUserId)
}

export async function sendPushToOrg(orgId: string, payload: PushPayload, excludeUserId?: string) {
  if (!ensureVapidConfigured()) return

  const admin = createAdminClient()
  let query = admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('organization_id', orgId)

  if (excludeUserId) query = query.neq('user_id', excludeUserId)

  const { data: subs } = await query
  if (!subs || subs.length === 0) return

  await sendToSubscriptions(subs, payload)
}

export type PlanningRecipients = { userIds: string[]; memberIds: string[] }

/**
 * Résout les destinataires d'un événement planning. Un membre de
 * chantier_equipe_membres a un profile_id (compte auth) OU non (intervenant
 * terrain sans compte, notifié via member_id sur push_subscriptions) — les deux
 * cas sont couverts pour que personne ne soit silencieusement ignoré.
 */
export async function getPlanningRecipientUserIds(
  orgId: string,
  opts: { memberId?: string | null; equipeId?: string | null },
): Promise<PlanningRecipients> {
  const admin = createAdminClient()
  const userIds = new Set<string>()
  const memberIds = new Set<string>()

  const collect = (member: { id: string; profile_id: string | null } | null | undefined) => {
    if (!member) return
    if (member.profile_id) userIds.add(member.profile_id)
    else memberIds.add(member.id)
  }

  if (opts.memberId) {
    const { data: member } = await admin
      .from('chantier_equipe_membres')
      .select('id, profile_id')
      .eq('id', opts.memberId)
      .eq('organization_id', orgId)
      .maybeSingle()
    collect(member)
  }

  if (opts.equipeId) {
    const { data: members } = await admin
      .from('chantier_equipe_membres')
      .select('id, profile_id')
      .eq('equipe_id', opts.equipeId)
      .eq('organization_id', orgId)

    for (const member of members ?? []) collect(member)
  }

  return { userIds: [...userIds], memberIds: [...memberIds] }
}
