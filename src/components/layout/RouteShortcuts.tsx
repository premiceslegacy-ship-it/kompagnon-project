'use client'
// @atelier-migrated

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useNavigationAccess } from './NavigationAccess'
import { NavigationIcon } from './NavigationIcon'
import { activeNavigationPlace, navigationPathMatches } from './navigation'
import styles from './RouteShortcuts.module.css'

export function RouteShortcuts() {
  const { model, notifications } = useNavigationAccess()
  const pathname = usePathname() || '/dashboard'
  const place = activeNavigationPlace(pathname)
  const entries = place === 'documents'
    ? model.secondary.documents
    : place === 'clients'
      ? model.secondary.clients
      : place === 'chantiers'
        ? model.secondary.chantiers
        : null
  if (!entries) return null

  let activeHref = ''
  for (const entry of entries) {
    if (entry.href.length > activeHref.length && navigationPathMatches(pathname, entry.href)) activeHref = entry.href
  }

  const showSingleRequestBadge = entries.length === 1 && entries[0].id === 'requests' && notifications.newRequests > 0
  if (entries.length === 0 || (entries.length === 1 && !showSingleRequestBadge)) return null

  return (
    <nav className={styles.shortcuts} aria-label="Navigation secondaire">
      {entries.map((entry) => {
        const active = entry.href === activeHref
        const isRequests = entry.id === 'requests'
        const requestCount = notifications.newRequests
        return (
          <Link
            key={entry.id}
            href={entry.href}
            className={`${styles.shortcut}${active ? ` ${styles.active}` : ''}`}
            aria-current={active ? 'page' : undefined}
            aria-label={isRequests && requestCount > 0 ? `${entry.label}, ${requestCount} nouvelles demandes` : undefined}
          >
            <NavigationIcon name={entry.icon} size={20} />
            <span className={styles.label}>{entry.label}</span>
            {isRequests && requestCount > 0 && <span className={styles.badge}>{requestCount}</span>}
          </Link>
        )
      })}
    </nav>
  )
}
