'use client'

import { useEffect, useState } from 'react'
import { Bell, X } from 'lucide-react'

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
// Re-proposer après 14 jours si l'utilisateur a fermé la bannière sans choisir.
const DISMISS_KEY = 'push_banner_dismissed_at'
const DISMISS_TTL_MS = 14 * 24 * 60 * 60 * 1000

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)))
}

/**
 * Bannière d'activation des notifications push, affichée sur chaque appareil
 * tant que la permission n'a pas été accordée. L'abonnement est par appareil :
 * un utilisateur qui active sur son téléphone doit aussi activer sur son
 * ordinateur pour y recevoir les alertes, d'où la relance périodique.
 */
export function PushEnableBanner() {
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return
    if (!VAPID_PUBLIC_KEY) return
    if (Notification.permission !== 'default') return

    const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) ?? 0)
    if (dismissedAt && Date.now() - dismissedAt < DISMISS_TTL_MS) return

    setVisible(true)
  }, [])

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()))
    setVisible(false)
  }

  const enable = async () => {
    setBusy(true)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') { setVisible(false); return }

      const reg = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready
      const existing = await reg.pushManager.getSubscription()
      const sub = existing ?? await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!),
      })
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      })
      setVisible(false)
    } catch (err) {
      console.error('[push] activation impossible :', err)
      setVisible(false)
    } finally {
      setBusy(false)
    }
  }

  if (!visible) return null

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-md">
      <div className="flex items-center gap-3 rounded-2xl border border-[var(--elevation-border)] bg-surface/95 backdrop-blur px-4 py-3 shadow-xl">
        <div className="shrink-0 w-9 h-9 rounded-xl bg-accent/15 flex items-center justify-center">
          <Bell className="w-5 h-5 text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-primary">Restez informé en temps réel</p>
          <p className="text-xs text-secondary">Nouvelles demandes de devis, signatures, paiements : recevez les alertes sur cet appareil.</p>
        </div>
        <button
          onClick={enable}
          disabled={busy}
          className="shrink-0 px-3 py-2 rounded-xl bg-accent text-white text-xs font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {busy ? '...' : 'Activer'}
        </button>
        <button onClick={dismiss} aria-label="Fermer" className="shrink-0 p-1 text-secondary hover:text-primary transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
