'use client'
// @atelier-migrated

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { UserProfile } from '@/lib/data/queries/user'
import type { NotificationsSummary } from '@/lib/data/queries/notifications'
import { buildNavigationModel, type NavigationAccess, type NavigationModel } from './navigation'

export type NavigationAccessValue = {
  readonly model: NavigationModel
  readonly profile: UserProfile | null
  readonly orgName: string | null
  readonly notifications: NotificationsSummary
}

const NavigationContext = createContext<NavigationAccessValue | null>(null)

export function NavigationAccessProvider({
  permissionKeys, currentRoleSlug, modules, profile, orgName, notifications, children,
}: NavigationAccess & {
  profile: UserProfile | null
  orgName: string | null
  notifications: NotificationsSummary
  children: ReactNode
}) {
  const model = useMemo(
    () => buildNavigationModel({ permissionKeys, currentRoleSlug, modules }),
    [permissionKeys, currentRoleSlug, modules],
  )
  const value = useMemo(
    () => ({ model, profile, orgName, notifications }),
    [model, profile, orgName, notifications],
  )
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>
}

export function useNavigationAccess(): NavigationAccessValue {
  const context = useContext(NavigationContext)
  if (!context) throw new Error('NavigationAccessProvider is required for the application navigation.')
  return context
}
