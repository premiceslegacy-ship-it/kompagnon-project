'use client'
// @atelier-migrated

import {
  AlertCircle,
  Bell,
  BellOff,
  Building2,
  CalendarCheck,
  CheckSquare,
  FileText,
  Inbox,
  Loader2,
  LogOut,
  MailWarning,
  MessageCircle,
  Moon,
  Plus,
  Repeat,
  Search,
  Sun,
  User,
  Wrench,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTheme } from '@/components/theme-provider'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { SearchField } from '@/components/ui/SearchField'
import { Sheet } from '@/components/ui/Sheet'
import { Hud } from '@/components/ui/Hud'
import { createClient } from '@/lib/supabase/client'
import sheetStyles from '@/components/ui/Sheet.module.css'
import { useNavigationAccess } from './NavigationAccess'
import { NavigationIcon } from './NavigationIcon'
import { NavigationMenu, type NavigationMenuSelect } from './NavigationMenu'
import type { NavigationEntry } from './navigation'
import { useNavigationNotifications } from './useNavigationNotifications'
import styles from './NavigationCommands.module.css'

type MenuKind = 'create' | 'notifications' | 'profile'
type ActiveOverlay = { kind: MenuKind; triggerId: string; desktop: boolean } | { kind: 'search' } | null
type PendingNavigation = { route: string; source: MenuKind | 'search' }

type RouteSearchTarget = { kind: 'route'; id: string; entry: NavigationEntry; searchText: string }
type SearchTarget = RouteSearchTarget | { kind: 'assistant'; id: 'sarah' }

const ASSISTANT_TARGET: SearchTarget = { kind: 'assistant', id: 'sarah' }

function routeSearchTarget(entry: NavigationEntry): RouteSearchTarget {
  return {
    kind: 'route',
    id: entry.id,
    entry,
    searchText: `${entry.label} ${entry.description ?? ''} ${entry.href}`.toLocaleLowerCase('fr-FR'),
  }
}

type NavigationCommandsContextValue = {
  model: ReturnType<typeof useNavigationAccess>['model']
  profile: ReturnType<typeof useNavigationAccess>['profile']
  orgName: string | null
  notifications: ReturnType<typeof useNavigationNotifications>
  notificationData: ReturnType<typeof useNavigationAccess>['notifications']
  activeOverlay: ActiveOverlay
  pendingNavigation: PendingNavigation | null
  desktop: boolean
  theme: 'light' | 'dark'
  setTheme(theme: 'light' | 'dark'): void
  openMenu(kind: MenuKind, triggerId: string): void
  closeMenu(kind: MenuKind, triggerId: string): void
  openSearch(): void
  navigate(href: string, source: PendingNavigation['source']): void
  prefetch(href: string): void
  signingOut: boolean
  signOut(): Promise<void>
}

const NavigationCommandsContext = createContext<NavigationCommandsContextValue | null>(null)

function routeKey(href: string): string {
  const query = href.indexOf('?')
  const fragment = href.indexOf('#')
  const end = query < 0 ? fragment : fragment < 0 ? query : Math.min(query, fragment)
  return (end < 0 ? href : href.slice(0, end)) || '/'
}

function isDesktopViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth >= 900
}

function subscribeViewport(onChange: () => void) {
  window.addEventListener('resize', onChange)
  return () => window.removeEventListener('resize', onChange)
}

function serverDesktopViewport() {
  return false
}

function useCommands(): NavigationCommandsContextValue {
  const context = useContext(NavigationCommandsContext)
  if (!context) throw new Error('NavigationCommandsProvider is required for navigation commands.')
  return context
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return target.closest('input, textarea, select, [role="textbox"], [data-editor]') !== null
}

export function NavigationCommandsProvider({ children }: { children: ReactNode }) {
  const access = useNavigationAccess()
  const pathname = usePathname() || '/'
  const searchParams = useSearchParams()
  const router = useRouter()
  const desktop = useSyncExternalStore(subscribeViewport, isDesktopViewport, serverDesktopViewport)
  const { theme, setTheme } = useTheme()
  const [activeOverlay, setActiveOverlay] = useState<ActiveOverlay>(null)
  // Fermer avant le commit si le déclencheur change de présentation.
  if (activeOverlay && activeOverlay.kind !== 'search' && activeOverlay.desktop !== desktop) setActiveOverlay(null)
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [signingOut, setSigningOut] = useState(false)
  const [signOutFailed, setSignOutFailed] = useState(false)
  const signOutLock = useRef(false)
  const searchPanelRef = useRef<HTMLDivElement>(null)
  const pendingSearchActionRef = useRef<(() => void) | null>(null)
  const isCockpit = pathname.startsWith('/orsayn')
  const searchOpen = activeOverlay?.kind === 'search'

  useEffect(() => {
    setPendingNavigation(null)
  }, [pathname, searchParams])

  const openMenu = useCallback((kind: MenuKind, triggerId: string) => {
    setActiveOverlay({ kind, triggerId, desktop })
  }, [desktop])

  const closeMenu = useCallback((kind: MenuKind, triggerId: string) => {
    setActiveOverlay((current) => current?.kind === kind && current.triggerId === triggerId ? null : current)
  }, [])

  const openSearch = useCallback(() => {
    if (!isCockpit) setActiveOverlay({ kind: 'search' })
  }, [isCockpit])
  const prefetch = useCallback((href: string) => router.prefetch(href), [router])

  const navigate = useCallback((href: string, source: PendingNavigation['source']) => {
    const fragment = href.indexOf('#')
    const locationKey = fragment < 0 ? href : href.slice(0, fragment)
    setPendingNavigation(locationKey === window.location.pathname + window.location.search ? null : { route: routeKey(href), source })
    prefetch(href)
    router.push(href)
  }, [prefetch, router])

  const signOut = useCallback(async () => {
    if (signOutLock.current) return
    signOutLock.current = true
    setSigningOut(true)
    setSignOutFailed(false)
    try {
      const { error } = await createClient().auth.signOut({ scope: 'local' })
      if (error) throw error
      router.replace('/login')
      router.refresh()
    } catch {
      signOutLock.current = false
      setSigningOut(false)
      setSignOutFailed(true)
    }
  }, [router])

  const navigationNotifications = useNavigationNotifications(access.notifications, {
    open: activeOverlay?.kind === 'notifications',
  })

  useEffect(() => {
    if (isCockpit) return
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || (!event.metaKey && !event.ctrlKey) || event.altKey || event.shiftKey) return
      if (event.key.toLocaleLowerCase('en-US') !== 'k') return
      if (searchOpen) {
        event.preventDefault()
        setActiveOverlay(null)
        return
      }
      if (isEditableTarget(event.target)) return
      event.preventDefault()
      openSearch()
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [isCockpit, openSearch, searchOpen])

  useEffect(() => {
    if (!searchOpen) return
    setSearchQuery('')
    const frame = window.requestAnimationFrame(() => {
      searchPanelRef.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [searchOpen])

  const searchIndex = useMemo(() => {
    const index = new Array<RouteSearchTarget>(access.model.allLinks.length + access.model.creations.length)
    let position = 0
    for (const entry of access.model.allLinks) index[position++] = routeSearchTarget(entry)
    for (const entry of access.model.creations) index[position++] = routeSearchTarget(entry)
    return index
  }, [access.model])

  const searchTargets = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase('fr-FR')
    if (!query) return searchIndex
    const results: RouteSearchTarget[] = []
    for (const target of searchIndex) if (target.searchText.includes(query)) results.push(target)
    return results
  }, [searchIndex, searchQuery])

  const chooseSearchTarget = useCallback((target: SearchTarget) => {
    if (pendingSearchActionRef.current) return
    const initialText = searchQuery.trim() ? searchQuery : undefined
    pendingSearchActionRef.current = () => {
      if (target.kind === 'assistant') {
        window.dispatchEvent(new CustomEvent('sarah-open', { detail: initialText === undefined ? undefined : { initialText } }))
      } else {
        navigate(target.entry.href, 'search')
      }
    }
    setActiveOverlay(null)
  }, [navigate, searchQuery])

  const consumeSearchSelection = useCallback(() => {
    for (const trigger of document.querySelectorAll<HTMLButtonElement>('[data-navigation-search]')) {
      if (trigger.getClientRects().length > 0) {
        trigger.focus({ preventScroll: true })
        break
      }
    }
    const action = pendingSearchActionRef.current
    pendingSearchActionRef.current = null
    action?.()
  }, [])

  const handleSearchOpenChange = useCallback((open: boolean) => {
    if (open) openSearch()
    else setActiveOverlay((current) => current?.kind === 'search' ? null : current)
  }, [openSearch])

  const handleSearchKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target
    if (target instanceof HTMLInputElement && event.key === 'Enter') {
      const selection = searchTargets[0] ?? (access.model.canUseAssistant ? ASSISTANT_TARGET : undefined)
      if (selection) {
        event.preventDefault()
        chooseSearchTarget(selection)
      }
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const buttons = searchPanelRef.current?.querySelectorAll<HTMLButtonElement>('ul button:not(:disabled)')
    if (!buttons?.length) return
    let next: number
    if (target instanceof HTMLInputElement) {
      next = event.key === 'ArrowDown' ? 0 : buttons.length - 1
    } else {
      let current = 0
      while (current < buttons.length && buttons[current] !== target) current += 1
      if (current === buttons.length) return
      next = (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
    }
    event.preventDefault()
    buttons[next].focus()
  }, [access.model.canUseAssistant, chooseSearchTarget, searchTargets])

  const contextValue = useMemo<NavigationCommandsContextValue>(() => ({
    model: access.model,
    profile: access.profile,
    orgName: access.orgName,
    notifications: navigationNotifications,
    notificationData: access.notifications,
    activeOverlay,
    desktop,
    pendingNavigation,
    theme,
    setTheme,
    openMenu,
    closeMenu,
    openSearch,
    navigate,
    prefetch,
    signingOut,
    signOut,
  }), [
    access.model,
    access.profile,
    access.orgName,
    access.notifications,
    navigationNotifications,
    activeOverlay,
    pendingNavigation,
    desktop,
    theme,
    setTheme,
    openMenu,
    closeMenu,
    openSearch,
    navigate,
    prefetch,
    signingOut,
    signOut,
  ])

  return (
    <NavigationCommandsContext.Provider value={contextValue}>
      {children}
      {!isCockpit && (
        <Sheet open={searchOpen} onOpenChange={handleSearchOpenChange} title="Aller à" onAfterClose={consumeSearchSelection}>
          <div className={`${sheetStyles.body} ${styles.searchBody}`}>
            <div ref={searchPanelRef} onKeyDown={handleSearchKeyDown}>
              <SearchField
                value={searchQuery}
                onChange={setSearchQuery}
                label="Aller à"
                placeholder={access.model.canUseAssistant ? 'Demander ou rechercher' : 'Rechercher un écran'}
              />
              {access.model.canUseAssistant && (
                <ListGroup title="Assistante" headingLevel={3} className={styles.searchResults}>
                  <ListRow
                    title="Demander à Sarah"
                    description={searchQuery.trim() ? 'Avec le texte saisi' : undefined}
                    leading={<MessageCircle className={styles.searchIcon} size={20} aria-hidden="true" />}
                    onClick={() => chooseSearchTarget(ASSISTANT_TARGET)}
                  />
                </ListGroup>
              )}
              {searchTargets.length > 0 ? (
                <ListGroup title="Résultats" headingLevel={3} className={styles.searchResults}>
                  {searchTargets.map((target) => (
                    <ListRow
                      key={target.id}
                      title={target.entry.label}
                      description={target.entry.description}
                      leading={<NavigationIcon name={target.entry.icon} />}
                      onClick={() => chooseSearchTarget(target)}
                    />
                  ))}
                </ListGroup>
              ) : (
                <EmptyState
                  className={styles.searchEmpty}
                  title="Aucun écran correspondant"
                  headingLevel={3}
                  description="Modifiez votre recherche."
                />
              )}
            </div>
          </div>
        </Sheet>
      )}
      <Hud
        open={signOutFailed}
        onOpenChange={setSignOutFailed}
        variant="error"
        message="Déconnexion impossible. Réessayez."
        onRetry={() => { void signOut() }}
        retrying={signingOut}
      />
    </NavigationCommandsContext.Provider>
  )
}

export type NavigationCommandsProps = {
  variant: 'search' | 'sidebar' | 'mobile' | 'profile'
  className?: string
}

export function NavigationCommands({ variant, className }: NavigationCommandsProps) {
  const commands = useCommands()
  const id = useId()
  const classNames = (base: string) => className ? `${base} ${className}` : base

  if (variant === 'search') {
    return (
      <button type="button" className={classNames(styles.searchTrigger)} onClick={commands.openSearch} data-navigation-search="true">
        {commands.pendingNavigation?.source === 'search' ? <Loader2 className={styles.pendingIcon} size={18} aria-hidden="true" /> : <Search size={18} aria-hidden="true" />}
        <span>Aller à</span>
        <kbd aria-hidden="true">⌘K / Ctrl K</kbd>
      </button>
    )
  }

  if (variant === 'sidebar') {
    return (
      <div className={classNames(styles.sidebarCommands)}>
        {commands.model.creations.length > 0 && <CreateCommand id={`${id}-create`} />}
        <NotificationCommand id={`${id}-notifications`} />
        <ProfileCommand id={`${id}-profile`} />
      </div>
    )
  }

  if (variant === 'mobile') {
    return (
      <div className={classNames(styles.mobileCommands)}>
        {commands.model.creations.length > 0 && <CreateCommand id={`${id}-create`} compact />}
        <button
          type="button"
          className={styles.iconTrigger}
          onClick={commands.openSearch}
          data-navigation-search="true"
          aria-label={commands.model.canUseAssistant ? 'Demander ou rechercher' : 'Rechercher un écran'}
          title={commands.model.canUseAssistant ? 'Demander ou rechercher' : 'Rechercher un écran'}
        >
          {commands.pendingNavigation?.source === 'search' ? <Loader2 className={styles.pendingIcon} size={21} aria-hidden="true" /> : <Search size={21} aria-hidden="true" />}
        </button>
        <NotificationCommand id={`${id}-notifications`} compact />
      </div>
    )
  }

  return <ProfileCommand id={`${id}-profile`} className={className} />
}

function CreateCommand({ id, compact = false }: { id: string; compact?: boolean }) {
  const commands = useCommands()
  const open = commands.activeOverlay?.kind === 'create' && commands.activeOverlay.triggerId === id
  const creationPending = commands.pendingNavigation?.source === 'create'
  const trigger = compact ? (
    <button type="button" className={styles.iconTrigger} aria-label="Créer" title="Créer">
      {creationPending ? <Loader2 className={styles.pendingIcon} size={21} aria-hidden="true" /> : <Plus size={21} aria-hidden="true" />}
    </button>
  ) : (
    <Button type="button" variant="text" size="md" className={styles.createTrigger}>
      {creationPending ? <Loader2 className={styles.pendingIcon} size={19} aria-hidden="true" /> : <Plus size={19} aria-hidden="true" />}
      <span>Créer</span>
    </Button>
  )

  return (
    <NavigationMenu
      desktop={commands.desktop}
      trigger={trigger}
      open={open}
      onOpenChange={(nextOpen) => nextOpen ? commands.openMenu('create', id) : commands.closeMenu('create', id)}
      title="Créer"
    >
      {(select) => (
        <div
          onPointerOverCapture={(event) => {
            const row = event.target instanceof Element ? event.target.closest('li') : null
            const related = event.relatedTarget
            if (!row || (related instanceof Node && row.contains(related))) return
            let index = 0
            for (let sibling = row.parentElement?.firstElementChild; sibling && sibling !== row; sibling = sibling.nextElementSibling) index += 1
            const entry = commands.model.creations[index]
            if (entry) commands.prefetch(entry.href)
          }}
        >
          {commands.desktop ? (
            <ListGroup className={styles.menuGroup}>
              {commands.model.creations.map((entry) => (
                <ListRow
                  key={entry.id}
                  title={entry.label}
                  description={entry.description}
                  leading={<NavigationIcon name={entry.icon} />}
                  trailing={commands.pendingNavigation?.source === 'create' && commands.pendingNavigation.route === routeKey(entry.href) ? <Loader2 className={styles.pendingIcon} size={18} aria-hidden="true" /> : undefined}
                  onClick={() => select(() => commands.navigate(entry.href, 'create'))}
                />
              ))}
            </ListGroup>
          ) : (
            <ul className={styles.createTiles}>
              {commands.model.creations.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    className={styles.createTile}
                    onClick={() => select(() => commands.navigate(entry.href, 'create'))}
                  >
                    <span className={styles.createTileIcon}>
                      <NavigationIcon name={entry.icon} size={26} />
                      {commands.pendingNavigation?.source === 'create' && commands.pendingNavigation.route === routeKey(entry.href) ? <Loader2 className={styles.pendingIcon} size={18} aria-hidden="true" /> : null}
                    </span>
                    <span className={styles.createTileText}>
                      {entry.label}
                      {entry.description ? <small>{entry.description}</small> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </NavigationMenu>
  )
}

function NotificationCommand({ id, compact = false }: { id: string; compact?: boolean }) {
  const commands = useCommands()
  const open = commands.activeOverlay?.kind === 'notifications' && commands.activeOverlay.triggerId === id
  const { badgeTotal, markSeen } = commands.notifications
  const notificationPending = commands.pendingNavigation?.source === 'notifications'
  const trigger = (
    <button
      type="button"
      className={compact ? styles.iconTrigger : styles.notificationTrigger}
      onClick={() => { if (!open) markSeen() }}
      aria-label={badgeTotal > 0 ? `Notifications, ${badgeTotal} en attente` : 'Notifications'}
      aria-busy={notificationPending}
      title="Notifications"
    >
      {notificationPending ? <Loader2 className={styles.pendingIcon} size={20} aria-hidden="true" /> : <Bell size={20} aria-hidden="true" />}
      {compact ? null : <span>Notifications</span>}
      {badgeTotal > 0 && <span className={styles.badge}>{badgeTotal > 9 ? '9+' : badgeTotal}</span>}
    </button>
  )

  return (
    <NavigationMenu
      desktop={commands.desktop}
      trigger={trigger}
      open={open}
      onOpenChange={(nextOpen) => nextOpen ? commands.openMenu('notifications', id) : commands.closeMenu('notifications', id)}
      title="Notifications"
    >
      {(select) => <NotificationPanel select={select} />}
    </NavigationMenu>
  )
}

function NotificationPanel({ select }: { select: NavigationMenuSelect }) {
  const commands = useCommands()
  const notifications = commands.notifications
  const data = commands.notificationData
  const icon = (Icon: LucideIcon, tone: 'danger' | 'warning' | 'accent' | 'positive' | 'blue' | 'violet') => (
    <Icon className={`${styles.notificationIcon} ${styles[`tone${tone[0].toUpperCase()}${tone.slice(1)}`]}`} size={18} aria-hidden="true" />
  )
  const dot = (tone: 'danger' | 'warning' | 'accent') => <span className={`${styles.notificationDot} ${styles[`tone${tone[0].toUpperCase()}${tone.slice(1)}`]}`} aria-hidden="true" />
  const row = (title: string, description: string, href: string, leading: ReactNode) => (
    <ListRow
      title={title}
      description={description}
      leading={leading}
      onClick={() => select(() => commands.navigate(href, 'notifications'))}
    />
  )
  const pushAction = notifications.pushPermission === 'default' ? (
    <Button variant="text" size="sm" className={styles.pushButton} onClick={() => notifications.enablePush()}>
      Activer les pushs
    </Button>
  ) : notifications.pushPermission === 'denied' ? (
    <span className={styles.pushStatus}><BellOff size={14} aria-hidden="true" />Pushs bloqués</span>
  ) : undefined

  if (notifications.total === 0) {
    return (
      <ListGroup className={styles.menuGroup} action={pushAction}>
        <li>
          <EmptyState title="Aucune action requise" headingLevel={4} description="Aucune notification à traiter pour le moment." className={styles.notificationEmpty} />
        </li>
      </ListGroup>
    )
  }

  return (
    <ListGroup className={styles.menuGroup} action={pushAction}>
      {data.overdueInvoices > 0 && row(
        `${data.overdueInvoices} facture${data.overdueInvoices > 1 ? 's' : ''} en retard`,
        'Échéance dépassée, paiement en attente',
        '/finances',
        dot('danger'),
      )}
      {(data.invoiceFollowups ?? 0) > 0 && row(
        `${data.invoiceFollowups} facture${(data.invoiceFollowups ?? 0) > 1 ? 's' : ''} à vérifier`,
        'Demander si le paiement est reçu ou relancer',
        '/finances',
        dot('warning'),
      )}
      {(data.pendingRecurring ?? 0) > 0 && row(
        `${data.pendingRecurring} facture${(data.pendingRecurring ?? 0) > 1 ? 's' : ''} récurrente${(data.pendingRecurring ?? 0) > 1 ? 's' : ''}`,
        'Brouillon disponible, à envoyer ou modifier',
        '/finances/recurring',
        icon(Repeat, 'violet'),
      )}
      {(data.recurringReady ?? 0) > 0 && row(
        `${data.recurringReady} facture${(data.recurringReady ?? 0) > 1 ? 's' : ''} à préparer`,
        "Modèle récurrent dans sa fenêtre d'envoi",
        '/finances/recurring',
        icon(Repeat, 'accent'),
      )}
      {(data.chantierPeriodDrafts ?? 0) > 0 && row(
        `${data.chantierPeriodDrafts} facture${(data.chantierPeriodDrafts ?? 0) > 1 ? 's' : ''} de chantier à valider`,
        'Brouillon périodique généré, à contrôler puis envoyer',
        '/finances',
        icon(FileText, 'blue'),
      )}
      {data.expiringQuotes > 0 && row(
        `${data.expiringQuotes} devis expirant bientôt`,
        'Validité inférieure à 3 jours',
        '/finances',
        dot('accent'),
      )}
      {(data.pendingQuotes ?? 0) > 0 && row(
        `${data.pendingQuotes} devis à relancer`,
        'Sans réponse depuis plusieurs jours',
        '/finances',
        icon(MailWarning, 'accent'),
      )}
      {(data.signatureLinkRequests ?? 0) > 0 && row(
        `${data.signatureLinkRequests} nouveau${(data.signatureLinkRequests ?? 0) > 1 ? 'x' : ''} lien${(data.signatureLinkRequests ?? 0) > 1 ? 's' : ''} de signature demandé${(data.signatureLinkRequests ?? 0) > 1 ? 's' : ''}`,
        'Renvoyez le devis pour envoyer un lien neuf',
        '/finances',
        icon(MailWarning, 'accent'),
      )}
      {(data.recentAutoReminders ?? 0) > 0 && row(
        `${data.recentAutoReminders} relance${(data.recentAutoReminders ?? 0) > 1 ? 's' : ''} auto envoyée${(data.recentAutoReminders ?? 0) > 1 ? 's' : ''}`,
        'Factures ou devis relancés automatiquement',
        '/dashboard',
        icon(CheckSquare, 'positive'),
      )}
      {(data.dueTasks ?? 0) > 0 && row(
        `${data.dueTasks} tâche${(data.dueTasks ?? 0) > 1 ? 's' : ''} à échéance`,
        "À faire aujourd'hui ou en retard",
        '/dashboard',
        icon(CheckSquare, 'blue'),
      )}
      {(data.planningToday ?? 0) > 0 && row(
        `${data.planningToday} créneau${(data.planningToday ?? 0) > 1 ? 'x' : ''} aujourd'hui`,
        'Planning chantier du jour',
        '/chantiers/planning',
        icon(CalendarCheck, 'blue'),
      )}
      {(data.missingPointages ?? 0) > 0 && row(
        `${data.missingPointages} pointage${(data.missingPointages ?? 0) > 1 ? 's' : ''} à vérifier`,
        'Créneau passé sans heure pointée',
        '/chantiers/heures',
        icon(AlertCircle, 'danger'),
      )}
      {(data.maintenanceDue ?? 0) > 0 && row(
        `${data.maintenanceDue} entretien${(data.maintenanceDue ?? 0) > 1 ? 's' : ''} à réaliser`,
        "Intervention planifiée aujourd'hui ou en retard",
        '/chantiers/entretien',
        icon(Wrench, 'blue'),
      )}
      {(data.maintenanceBillingPending ?? 0) > 0 && row(
        `${data.maintenanceBillingPending} entretien${(data.maintenanceBillingPending ?? 0) > 1 ? 's' : ''} à facturer`,
        'Intervention réalisée avec montant facturable',
        '/chantiers/entretien',
        icon(FileText, 'accent'),
      )}
      {(data.completedTasks ?? 0) > 0 && row(
        `${data.completedTasks} tâche${(data.completedTasks ?? 0) > 1 ? 's' : ''} terminée${(data.completedTasks ?? 0) > 1 ? 's' : ''}`,
        'Un membre a clôturé une tâche chantier',
        '/dashboard',
        icon(CheckSquare, 'positive'),
      )}
      {(data.chantiersAtRisk ?? 0) > 0 && row(
        `${data.chantiersAtRisk} chantier${(data.chantiersAtRisk ?? 0) > 1 ? 's' : ''} en alerte budget`,
        'Coûts au-delà de 90\u00a0% du budget prévu',
        '/chantiers',
        dot('warning'),
      )}
      {(data.newRequests ?? 0) > 0 && row(
        `${data.newRequests} demande${(data.newRequests ?? 0) > 1 ? 's' : ''} de devis à traiter`,
        'Reçues via le formulaire public',
        '/requests',
        icon(Inbox, 'accent'),
      )}
    </ListGroup>
  )
}

function ProfileCommand({ id, className }: { id: string; className?: string }) {
  const commands = useCommands()
  const open = commands.activeOverlay?.kind === 'profile' && commands.activeOverlay.triggerId === id
  const displayName = commands.profile?.full_name?.trim() || commands.profile?.email || null
  const trigger = (
    <button
      type="button"
      className={`${styles.profileTrigger}${className ? ` ${className}` : ''}`}
      aria-label={commands.orgName ? `${displayName ?? 'Profil'}, ${commands.orgName}` : displayName ?? 'Profil'}
      title={commands.orgName ? `${displayName ?? 'Profil'}, ${commands.orgName}` : displayName ?? 'Profil'}
    >
      {commands.profile?.avatar_url || displayName ? (
        <Avatar name={displayName ?? ''} alt={displayName ?? 'Profil'} src={commands.profile?.avatar_url ?? undefined} size={34} />
      ) : (
        <User size={20} aria-hidden="true" />
      )}
      <span className={styles.profileDetails}>
        {displayName ? <span className={styles.profileName}>{displayName}</span> : null}
        {commands.orgName ? <span className={styles.profileOrganization}>{commands.orgName}</span> : null}
      </span>
      {commands.pendingNavigation?.source === 'profile' || commands.signingOut ? <Loader2 className={styles.pendingIcon} size={18} aria-hidden="true" /> : null}
    </button>
  )

  return (
    <NavigationMenu
      desktop={commands.desktop}
      trigger={trigger}
      open={open}
      onOpenChange={(nextOpen) => nextOpen ? commands.openMenu('profile', id) : commands.closeMenu('profile', id)}
      title="Profil"
    >
      {(select) => (
        <ListGroup className={styles.menuGroup}>
          {displayName ? (
            <ListRow
              title={displayName}
              description={commands.profile?.email && commands.profile.email !== displayName ? commands.profile.email : undefined}
              leading={<Avatar name={displayName} src={commands.profile?.avatar_url ?? undefined} size={40} />}
            />
          ) : null}
          {commands.orgName ? <ListRow title={commands.orgName} leading={<Building2 size={20} aria-hidden="true" />} /> : null}
          <ListRow
            title="Mon profil"
            leading={<User size={20} aria-hidden="true" />}
            trailing={commands.pendingNavigation?.source === 'profile' && commands.pendingNavigation.route === '/settings' ? <Loader2 className={styles.pendingIcon} size={18} aria-hidden="true" /> : undefined}
            onClick={() => select(() => commands.navigate('/settings', 'profile'))}
          />
          <ListRow
            title={commands.theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'}
            leading={commands.theme === 'dark' ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}
            onClick={() => select(() => commands.setTheme(commands.theme === 'dark' ? 'light' : 'dark'))}
          />
          <ListRow
            title="Se déconnecter"
            leading={<LogOut size={20} aria-hidden="true" />}
            trailing={commands.signingOut ? <Loader2 className={styles.pendingIcon} size={18} aria-hidden="true" /> : undefined}
            disabled={commands.signingOut}
            onClick={() => select(() => { void commands.signOut() })}
          />
        </ListGroup>
      )}
    </NavigationMenu>
  )
}
