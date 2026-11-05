'use client'
// @atelier-migrated

import { useCallback, useRef, type FocusEvent, type MouseEvent, type PointerEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createLucideIcon } from 'lucide-react'
import { NavigationCommands } from '@/components/layout/NavigationCommands'
import { NavigationIcon } from '@/components/layout/NavigationIcon'
import { useNavigationAccess } from '@/components/layout/NavigationAccess'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import styles from './Entreprise.module.css'

const ChevronRight = createLucideIcon('AtelierChevronRight', [
  ['path', { d: 'M8.800 4.500l7.500 7.500-7.500 7.500', key: 'chevron' }],
])

function internalLink(target: EventTarget | null, root: HTMLElement): HTMLAnchorElement | null {
  if (!(target instanceof Element)) return null
  const link = target.closest<HTMLAnchorElement>('a[href]')
  if (!link || !root.contains(link) || (link.target && link.target !== '_self')
    || link.hasAttribute('download') || link.origin !== window.location.origin) return null
  return link
}

export default function EntreprisePage() {
  const { model } = useNavigationAccess()
  const router = useRouter()
  const prefetchedRoutes = useRef<Set<string> | null>(null)

  const navigate = useCallback((event: MouseEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const link = internalLink(event.target, event.currentTarget)
    if (!link) return
    event.preventDefault()
    router.push(link.pathname + link.search + link.hash)
  }, [router])

  const prefetch = useCallback((event: FocusEvent<HTMLElement> | PointerEvent<HTMLElement>) => {
    const link = internalLink(event.target, event.currentTarget)
    if (!link || (event.relatedTarget instanceof Node && link.contains(event.relatedTarget))) return
    const href = link.pathname + link.search + link.hash
    const prefetched = prefetchedRoutes.current ??= new Set<string>()
    if (prefetched.has(href)) return
    prefetched.add(href)
    router.prefetch(href)
  }, [router])

  return (
    <main className={styles.root} aria-labelledby="entreprise-title">
      <div className={styles.page}>
        <header className={styles.header}>
          <h1 className={styles.title} id="entreprise-title">Entreprise</h1>
          <div className={styles.headerCommands}><NavigationCommands variant="mobile" /></div>
        </header>
        <div className={styles.profile}><NavigationCommands variant="profile" /></div>
        <nav className={styles.destinations} aria-label="Destinations de l’entreprise" onClick={navigate} onPointerOver={prefetch} onFocus={prefetch}>
          {model.companyGroups.map((group) => (
            <ListGroup key={group[0].id} className={styles.destinationGroup}>
              {group.map((entry) => (
                <ListRow
                  key={entry.id}
                  href={entry.href}
                  title={entry.label}
                  leading={<span className={styles.leading}><NavigationIcon name={entry.icon} size={18} /></span>}
                  trailing={<ChevronRight className={styles.chevron} size={14} aria-hidden="true" />}
                  className={styles.destinationRow}
                />
              ))}
            </ListGroup>
          ))}
        </nav>
      </div>
    </main>
  )
}
