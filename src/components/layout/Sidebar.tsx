'use client'
// @atelier-migrated

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useNavigationAccess } from './NavigationAccess'
import { NavigationCommands } from './NavigationCommands'
import { NavigationIcon } from './NavigationIcon'
import { activeNavigationPlace, navigationPathMatches } from './navigation'
import styles from './Sidebar.module.css'

export function Sidebar() {
  const { model } = useNavigationAccess()
  const pathname = usePathname() || '/dashboard'
  const activePlace = activeNavigationPlace(pathname)
  const primary = model.primary.filter((entry) => entry.place !== 'company')
  const company = model.primary.find((entry) => entry.place === 'company')

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <img className={styles.logoLight} src="/brand/atelier/logo-atelier-noir.svg" width={135} height={16} alt="Atelier" />
        <img className={styles.logoDark} src="/brand/atelier/logo-atelier-blanc.svg" width={135} height={16} alt="Atelier" />
      </div>
      <div className={styles.search}>
        <NavigationCommands variant="search" />
      </div>
      <nav className={styles.navigation} aria-label="Navigation principale">
        <div className={styles.primaryLinks}>
          {primary.map((entry) => {
            const active = activePlace === entry.place
            return (
              <Link
                key={entry.id}
                href={entry.href}
                className={`${styles.navLink}${active ? ` ${styles.active}` : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                <span className={styles.icon}><NavigationIcon name={entry.icon} size={20} /></span>
                <span className={styles.label}>{entry.label}</span>
              </Link>
            )
          })}
        </div>
        {company && (
          <>
            <Link
              href={company.href}
              className={`${styles.navLink} ${styles.companyHeader}`}
              aria-current={pathname === company.href ? 'page' : undefined}
            >
              <span className={styles.label}>{company.label}</span>
            </Link>
            <div className={styles.companyGroups}>
              {model.companyGroups.map((group) => (
                <div className={styles.companyGroup} key={group[0].id}>
                  {group.map((entry) => {
                    const active = navigationPathMatches(pathname, entry.href)
                    return (
                      <Link
                        key={entry.id}
                        href={entry.href}
                        className={`${styles.navLink}${active ? ` ${styles.active}` : ''}`}
                        aria-current={active ? 'page' : undefined}
                      >
                        <span className={styles.icon}><NavigationIcon name={entry.icon} size={20} /></span>
                        <span className={styles.label}>{entry.label}</span>
                      </Link>
                    )
                  })}
                </div>
              ))}
            </div>
          </>
        )}
      </nav>
      <footer className={styles.footer}>
        <NavigationCommands variant="sidebar" />
      </footer>
    </aside>
  )
}
