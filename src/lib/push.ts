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
  await Promise.allSettled(
    subs.map((sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
      )
    )
  )
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

export async function getPlanningRecipientUserIds(
  orgId: string,
  opts: { memberId?: string | null; equipeId?: string | null },
): Promise<string[]> {
  const admin = createAdminClient()
  const userIds = new Set<string>()

  if (opts.memberId) {
    const { data: member } = await admin
      .from('chantier_equipe_membres')
      .select('profile_id')
      .eq('id', opts.memberId)
      .eq('organization_id', orgId)
      .maybeSingle()
    if (member?.profile_id) userIds.add(member.profile_id)
  }

  if (opts.equipeId) {
    const { data: members } = await admin
      .from('chantier_equipe_membres')
      .select('profile_id')
      .eq('equipe_id', opts.equipeId)
      .eq('organization_id', orgId)

    for (const member of members ?? []) {
      if (member.profile_id) userIds.add(member.profile_id)
    }
  }

  return [...userIds]
}
