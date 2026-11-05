'use client'
// @atelier-migrated

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useNavigationAccess } from './NavigationAccess'
import { NavigationIcon } from './NavigationIcon'
import { activeNavigationPlace } from './navigation'
import styles from './TabBar.module.css'

export function TabBar() {
  const { model } = useNavigationAccess()
  const pathname = usePathname() || '/dashboard'
  const activePlace = activeNavigationPlace(pathname)

  return (
    <nav className={styles.tabs} aria-label="Navigation principale mobile">
      <div className={styles.items} style={{ gridTemplateColumns: `repeat(${model.primary.length}, minmax(max-content, 1fr))` }}>
        {model.primary.map((entry) => {
          const active = activePlace === entry.place
          return (
            <Link
              key={entry.id}
              href={entry.href}
              className={`${styles.tab}${active ? ` ${styles.active}` : ''}`}
              aria-current={active ? 'page' : undefined}
              data-navigation-profile-entry={entry.place === 'company' ? 'true' : undefined}
            >
              <NavigationIcon className={styles.icon} name={entry.icon} size={26} />
              <span className={styles.label}>{entry.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
