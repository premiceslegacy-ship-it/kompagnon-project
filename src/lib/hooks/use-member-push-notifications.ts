'use client'

import { useEffect } from 'react'
import { subscribeMemberToPush } from '@/lib/data/mutations/member-push'

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)))
}

async function subscribeToPush() {
  if (!('serviceWorker' in navigator)) return
  if (!('PushManager' in window)) return
  if (!VAPID_PUBLIC_KEY) { console.error('[member-push] NEXT_PUBLIC_VAPID_PUBLIC_KEY manquante'); return }

  const reg = await navigator.serviceWorker.register('/sw.js')
  await navigator.serviceWorker.ready

  const existing = await reg.pushManager.getSubscription()
  if (existing) {
    await saveSub(existing)
    return
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  })
  await saveSub(sub)
}

async function saveSub(sub: PushSubscription) {
  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return
  await subscribeMemberToPush({
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  })
}

/**
 * Variante de usePushNotifications pour l'espace /mon-espace : les intervenants
 * n'ont pas de compte Supabase Auth, l'abonnement passe par une Server Action
 * qui vérifie la session membre (HMAC), pas par la route API /api/push/subscribe.
 */
export function useMemberPushNotifications() {
  useEffect(() => {
    if (typeof window !== 'undefined' && Notification.permission === 'granted') {
      subscribeToPush().catch((err) => console.error('[member-push] erreur:', err))
    }
  }, [])

  // Ne déclenche jamais le prompt automatiquement — retourne la fonction pour
  // un bouton "Activer les notifications" explicite dans le dashboard membre.
  return { requestSubscription: () => subscribeToPush().catch((err) => console.error('[member-push] erreur:', err)) }
}
