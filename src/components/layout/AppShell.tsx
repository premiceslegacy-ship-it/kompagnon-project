'use client'

import { useState, useEffect, useCallback } from 'react'
import { Topbar } from '@/components/layout/Topbar'
import { BottomNav } from '@/components/layout/BottomNav'
import { SarahWidget } from '@/components/sarah/SarahWidget'
import type { UserProfile } from '@/lib/data/queries/user'
import type { OrganizationModules } from '@/lib/organization-modules'
import type { NotificationsSummary } from '@/lib/data/queries/notifications'
import { usePushNotifications } from '@/lib/hooks/use-push-notifications'
import { usePathname } from 'next/navigation'
import { NavigationCommands, NavigationCommandsProvider } from './NavigationCommands'
import { NavigationAccessProvider, useNavigationAccess } from './NavigationAccess'
import { RouteShortcuts } from './RouteShortcuts'
import { Sidebar } from './Sidebar'
import { TabBar } from './TabBar'
import styles from './AppShell.module.css'

const EMPTY: NotificationsSummary = {
  total: 0,
  overdueInvoices: 0,
  invoiceFollowups: 0,
  expiringQuotes: 0,
  pendingQuotes: 0,
  pendingRecurring: 0,
  recurringReady: 0,
  chantierPeriodDrafts: 0,
  recentAutoReminders: 0,
  dueTasks: 0,
  planningToday: 0,
  missingPointages: 0,
  completedTasks: 0,
  newRequests: 0,
  decennaleExpiringDays: null,
  chantiersAtRisk: 0,
  chantiersHighSubcontract: 0,
  maintenanceDue: 0,
  maintenanceBillingPending: 0,
  dailyBriefPending: false,
  sarahAlertLines: [],
}
function AuthorizedSarahWidget({
  profile,
  notifications,
  currentRoleSlug,
}: {
  profile: UserProfile | null
  notifications: NotificationsSummary
  currentRoleSlug: string | null
}) {
  const { model } = useNavigationAccess()
  if (!model.canUseAssistant) return null
  return (
    <SarahWidget
      userName={profile?.full_name ?? null}
      alertCount={notifications.total}
      alerts={notifications}
      isOwner={currentRoleSlug === 'owner'}
    />
  )
}

export function AppShell({
  profile,
  orgName,
  logoUrl,
  modules,
  permissionKeys,
  currentRoleSlug,
  children,
}: {
  profile: UserProfile | null
  orgName: string | null
  logoUrl: string | null
  modules: OrganizationModules
  permissionKeys: string[]
  currentRoleSlug: string | null
  children: React.ReactNode
}) {
  const [notifications, setNotifications] = useState<NotificationsSummary>(EMPTY)

  const refreshNotifications = useCallback(() => {
    fetch('/api/notifications')
      .then(r => r.json())
      .then(setNotifications)
      .catch(() => {})
  }, [])

  useEffect(() => { refreshNotifications() }, [refreshNotifications])

  usePushNotifications(() => refreshNotifications())
  const pathname = usePathname() || '/dashboard'

  const { decennaleExpiringDays } = notifications

  if (pathname === '/orsayn' || pathname.startsWith('/orsayn/')) {
    return (
      <>
        <Topbar
          profile={profile}
          orgName={orgName}
          logoUrl={logoUrl}
          notifications={notifications}
          modules={modules}
          permissionKeys={permissionKeys}
          currentRoleSlug={currentRoleSlug}
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
        <div className="grow pb-[calc(72px+env(safe-area-inset-bottom))] lg:pb-0">{children}</div>
        <BottomNav permissionKeys={permissionKeys} />
        {modules.sarah_assistant && (
          <SarahWidget
            userName={profile?.full_name ?? null}
            alertCount={notifications.total}
            alerts={notifications}
            isOwner={currentRoleSlug === 'owner'}
          />
        )}
      </>
    )
  }

  return (
    <NavigationAccessProvider
      permissionKeys={permissionKeys}
      currentRoleSlug={currentRoleSlug}
      modules={modules}
      profile={profile}
      orgName={orgName}
      notifications={notifications}
    >
      <NavigationCommandsProvider>
        <>
          <div className={styles.application}>
            {/* Sur Aujourd'hui, le rappel est une ligne de la page (TodayHeader). */}
            {decennaleExpiringDays !== null && pathname !== '/dashboard' && (
              <div
                className={styles.decennale}
                data-expired={decennaleExpiringDays < 0 ? 'true' : 'false'}
              >
                {decennaleExpiringDays < 0
                  ? `Assurance décennale\u00a0: elle a expiré il y a ${Math.abs(decennaleExpiringDays)}\u00a0jour${Math.abs(decennaleExpiringDays) > 1 ? 's' : ''}. Renouvelez-la dans les Réglages.`
                  : `Assurance décennale\u00a0: elle expire dans ${decennaleExpiringDays}\u00a0jour${decennaleExpiringDays > 1 ? 's' : ''}. Pensez au renouvellement.`}
              </div>
            )}
            <div className={styles.layout}>
              <Sidebar />
              <div className={styles.main}>
                {pathname !== '/entreprise' && <NavigationCommands variant="mobile" className={styles.mobileCommands} />}
                <RouteShortcuts />
                {children}
              </div>
              <TabBar />
            </div>
          </div>
          <AuthorizedSarahWidget
            profile={profile}
            notifications={notifications}
            currentRoleSlug={currentRoleSlug}
          />
        </>
      </NavigationCommandsProvider>
    </NavigationAccessProvider>
  )
}
