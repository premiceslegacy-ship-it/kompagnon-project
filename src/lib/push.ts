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

export async function sendPushToUser(userId: string, payload: PushPayload) {
  if (!ensureVapidConfigured()) return

  const admin = createAdminClient()
  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId)

  if (!subs || subs.length === 0) return

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  await Promise.allSettled(
    subs.map((sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({
          ...payload,
          icon: `${appUrl}/icon-192.png`,
          url: payload.url ? `${appUrl}${payload.url}` : appUrl,
        })
      )
    )
  )
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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  await Promise.allSettled(
    subs.map((sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({
          ...payload,
          icon: `${appUrl}/icon-192.png`,
          url: payload.url ? `${appUrl}${payload.url}` : appUrl,
        })
      )
    )
  )
}
