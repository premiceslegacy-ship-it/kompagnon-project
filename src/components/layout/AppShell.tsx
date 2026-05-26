'use client'

import { useState, useEffect } from 'react'
import { Topbar } from '@/components/layout/Topbar'
import type { UserProfile } from '@/lib/data/queries/user'
import type { OrganizationModules } from '@/lib/organization-modules'
import type { NotificationsSummary } from '@/lib/data/queries/notifications'
import { usePushNotifications } from '@/lib/hooks/use-push-notifications'

const EMPTY: NotificationsSummary = {
  total: 0,
  overdueInvoices: 0,
  invoiceFollowups: 0,
  expiringQuotes: 0,
  pendingQuotes: 0,
  pendingRecurring: 0,
  recentAutoReminders: 0,
  dueTasks: 0,
  planningToday: 0,
  missingPointages: 0,
  completedTasks: 0,
  newRequests: 0,
  decennaleExpiringDays: null,
  chantiersAtRisk: 0,
}

export function AppShell({
  profile,
  orgName,
  logoUrl,
  modules,
  permissionKeys,
  children,
}: {
  profile: UserProfile | null
  orgName: string | null
  logoUrl: string | null
  modules: OrganizationModules
  permissionKeys: string[]
  children: React.ReactNode
}) {
  const [notifications, setNotifications] = useState<NotificationsSummary>(EMPTY)

  function refreshNotifications() {
    fetch('/api/notifications')
      .then(r => r.json())
      .then(setNotifications)
      .catch(() => {})
  }

  useEffect(() => { refreshNotifications() }, [])

  usePushNotifications(() => refreshNotifications())

  const { decennaleExpiringDays } = notifications

  return (
    <>
      <Topbar
        profile={profile}
        orgName={orgName}
        logoUrl={logoUrl}
        notifications={notifications}
        modules={modules}
        permissionKeys={permissionKeys}
      />
      {decennaleExpiringDays !== null && (
        <div
          className={`w-full px-6 py-2.5 text-center text-sm font-semibold ${
            decennaleExpiringDays < 0 ? 'bg-red-500 text-white' : 'bg-orange-500 text-white'
          }`}
        >
          {decennaleExpiringDays < 0
            ? `⚠ Votre garantie décennale a expiré il y a ${Math.abs(decennaleExpiringDays)} jour${Math.abs(decennaleExpiringDays) > 1 ? 's' : ''} - renouvelez-la d'urgence dans les Réglages.`
            : `⚠ Votre garantie décennale expire dans ${decennaleExpiringDays} jour${decennaleExpiringDays > 1 ? 's' : ''} - pensez au renouvellement (Réglages).`}
        </div>
      )}
      <div className="grow">{children}</div>
    </>
  )
}
