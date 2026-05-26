'use client'

import { useEffect, useRef } from 'react'

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!
const POLL_INTERVAL_MS = 5_000

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)))
}

async function subscribeToPush() {
  if (!('serviceWorker' in navigator)) { console.warn('[push] serviceWorker non supporté'); return }
  if (!('PushManager' in window)) { console.warn('[push] PushManager non supporté'); return }
  if (!VAPID_PUBLIC_KEY) { console.error('[push] NEXT_PUBLIC_VAPID_PUBLIC_KEY manquante'); return }

  console.log('[push] enregistrement SW...')
  const reg = await navigator.serviceWorker.register('/sw.js')
  await navigator.serviceWorker.ready
  console.log('[push] SW prêt')

  const existing = await reg.pushManager.getSubscription()
  if (existing) {
    console.log('[push] abonnement existant, sauvegarde...')
    await saveSub(existing)
    return
  }

  console.log('[push] demande permission...')
  const permission = await Notification.requestPermission()
  console.log('[push] permission:', permission)
  if (permission !== 'granted') return

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  })
  console.log('[push] abonné, sauvegarde...')
  await saveSub(sub)
  console.log('[push] OK')
}

async function saveSub(sub: PushSubscription) {
  await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sub.toJSON()),
  })
}

export function usePushNotifications(onPoll?: () => void) {
  const onPollRef = useRef(onPoll)
  onPollRef.current = onPoll

  // Enregistre le SW et sauvegarde l'abonnement existant si déjà accordé,
  // sans jamais déclencher le prompt (le clic utilisateur s'en charge)
  useEffect(() => {
    if (typeof window !== 'undefined' && Notification.permission === 'granted') {
      subscribeToPush().catch((err) => console.error('[push] erreur:', err))
    }
  }, [])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>

    function schedule() {
      timer = setTimeout(() => {
        if (document.visibilityState === 'visible') {
          onPollRef.current?.()
        }
        schedule()
      }, POLL_INTERVAL_MS)
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        onPollRef.current?.()
      }
    }

    schedule()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])
}
