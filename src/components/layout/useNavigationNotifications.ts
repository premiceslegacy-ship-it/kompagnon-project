'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import type { NotificationsSummary } from '@/lib/data/queries/notifications'

export type NavigationNotificationsData = Partial<NotificationsSummary> & {
  overdueInvoices: number
  expiringQuotes: number
}

type PushPermission = 'default' | 'granted' | 'denied'

type UseNavigationNotificationsOptions = {
  open: boolean
  onNavigate?: (href: string) => void
}

const NOTIFICATIONS_SEEN_SIGNATURE_KEY = 'notifications_seen_signature'

const routeKey = (href: string) => href.split(/[?#]/)[0] || '/'

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map((character) => character.charCodeAt(0)))
}

export function useNavigationNotifications(
  notifications: NavigationNotificationsData,
  { open, onNavigate }: UseNavigationNotificationsOptions,
) {
  const [seenSignature, setSeenSignature] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const [pushPermission, setPushPermission] = useState<PushPermission>('granted')
  const [pendingRoute, setPendingRoute] = useState<string | null>(null)
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    setMounted(true)
    setSeenSignature(localStorage.getItem(NOTIFICATIONS_SEEN_SIGNATURE_KEY))
    if ('Notification' in window) setPushPermission(Notification.permission as PushPermission)
  }, [])

  useEffect(() => {
    setPendingRoute(null)
  }, [pathname])

  const total = notifications.total ?? (
    notifications.overdueInvoices +
    (notifications.invoiceFollowups ?? 0) +
    (notifications.pendingQuotes ?? 0) +
    (notifications.pendingRecurring ?? 0) +
    (notifications.recurringReady ?? 0) +
    (notifications.chantierPeriodDrafts ?? 0) +
    (notifications.dueTasks ?? 0) +
    (notifications.planningToday ?? 0) +
    (notifications.missingPointages ?? 0) +
    (notifications.newRequests ?? 0) +
    (notifications.chantiersAtRisk ?? 0) +
    (notifications.maintenanceDue ?? 0) +
    (notifications.maintenanceBillingPending ?? 0)
  )
  const notificationSignature = [
    total,
    notifications.overdueInvoices,
    notifications.invoiceFollowups ?? 0,
    notifications.pendingQuotes ?? 0,
    notifications.pendingRecurring ?? 0,
    notifications.recurringReady ?? 0,
    notifications.chantierPeriodDrafts ?? 0,
    notifications.recentAutoReminders ?? 0,
    notifications.dueTasks ?? 0,
    notifications.planningToday ?? 0,
    notifications.missingPointages ?? 0,
    notifications.completedTasks ?? 0,
    notifications.newRequests ?? 0,
    notifications.chantiersAtRisk ?? 0,
    notifications.maintenanceDue ?? 0,
    notifications.maintenanceBillingPending ?? 0,
  ].join(':')
  const badgeTotal = seenSignature === notificationSignature ? 0 : total
  const notificationRoutes = useMemo(() => {
    const routes = new Set<string>()
    if (notifications.overdueInvoices > 0) routes.add('/finances')
    if ((notifications.invoiceFollowups ?? 0) > 0) routes.add('/finances')
    if ((notifications.pendingRecurring ?? 0) > 0) routes.add('/finances/recurring')
    if ((notifications.recurringReady ?? 0) > 0) routes.add('/finances/recurring')
    if ((notifications.chantierPeriodDrafts ?? 0) > 0) routes.add('/finances')
    if (notifications.expiringQuotes > 0) routes.add('/finances')
    if ((notifications.pendingQuotes ?? 0) > 0) routes.add('/finances')
    if ((notifications.recentAutoReminders ?? 0) > 0) routes.add('/dashboard')
    if ((notifications.dueTasks ?? 0) > 0) routes.add('/dashboard')
    if ((notifications.planningToday ?? 0) > 0) routes.add('/chantiers/planning')
    if ((notifications.missingPointages ?? 0) > 0) routes.add('/chantiers/heures')
    if ((notifications.maintenanceDue ?? 0) > 0) routes.add('/chantiers/entretien')
    if ((notifications.maintenanceBillingPending ?? 0) > 0) routes.add('/chantiers/entretien')
    if ((notifications.completedTasks ?? 0) > 0) routes.add('/dashboard')
    if ((notifications.chantiersAtRisk ?? 0) > 0) routes.add('/chantiers')
    if ((notifications.newRequests ?? 0) > 0) routes.add('/requests')
    return Array.from(routes)
  }, [
    notifications.overdueInvoices,
    notifications.invoiceFollowups,
    notifications.pendingRecurring,
    notifications.recurringReady,
    notifications.chantierPeriodDrafts,
    notifications.expiringQuotes,
    notifications.pendingQuotes,
    notifications.recentAutoReminders,
    notifications.dueTasks,
    notifications.planningToday,
    notifications.missingPointages,
    notifications.maintenanceDue,
    notifications.maintenanceBillingPending,
    notifications.completedTasks,
    notifications.chantiersAtRisk,
    notifications.newRequests,
  ])

  useEffect(() => {
    if (!open) return
    notificationRoutes.forEach((href) => router.prefetch(href))
  }, [open, notificationRoutes, router])

  const markSeen = useCallback(() => {
    setSeenSignature(notificationSignature)
    localStorage.setItem(NOTIFICATIONS_SEEN_SIGNATURE_KEY, notificationSignature)
  }, [notificationSignature])

  const navigate = useCallback((href: string, closeOverlay?: () => void) => {
    setPendingRoute(routeKey(href))
    closeOverlay?.()
    onNavigate?.(href)
    router.prefetch(href)
    router.push(href)
  }, [onNavigate, router])

  const enablePush = useCallback(async () => {
    // Tout échec (souscription refusée, SW indisponible, réseau) doit rester
    // silencieux : un rejet non géré ici part en erreur Sentry côté client.
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      if (!vapidKey) return

      const permission = await Notification.requestPermission()
      setPushPermission(permission as PushPermission)
      if (permission !== 'granted') return

      const registration = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready
      const existing = await registration.pushManager.getSubscription()
      const subscription = existing ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      })
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      })
    } catch (error) {
      console.error('[push] activation impossible :', error)
    }
  }, [])

  return useMemo(() => ({
    total,
    badgeTotal,
    mounted,
    pushPermission,
    pendingRoute,
    markSeen,
    navigate,
    enablePush,
  }), [
    total,
    badgeTotal,
    mounted,
    pushPermission,
    pendingRoute,
    markSeen,
    navigate,
    enablePush,
  ])
}
