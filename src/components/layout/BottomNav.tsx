'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { IconAccueil, IconChantier, IconTresorerie, IconClient, IconMenu, IconCatalogue, IconRapport, IconCalendrier, IconReglages } from '@/components/ui/icons'
import { cn } from '@/lib/utils'

type NavEntry = {
  href: string
  label: string
  icon: (props: { className?: string }) => React.ReactElement
  active: boolean
  permission?: string
}

type MenuEntry = {
  href: string
  label: string
  icon: (props: { className?: string }) => React.ReactElement
  permission?: string
}

/**
 * Barre d'onglets mobile, en remplacement du hamburger sur < lg.
 * Les 4 actions quotidiennes de l'artisan en accès direct, le reste
 * (catalogue, rapports, planning, réglages...) dans l'onglet Menu.
 * z-[9950] : sous le drawer (9990/9991), les modals (9980) et Sarah (9970
 * flotte au-dessus, remonté à bottom-84 pour ne pas la recouvrir).
 */
export function BottomNav({ permissionKeys = [] }: { permissionKeys?: string[] }) {
  const pathname = usePathname() || '/dashboard'
  const [menuOpen, setMenuOpen] = useState(false)
  const permissionSet = new Set(permissionKeys)
  const canView = (key: string) => permissionSet.has('*') || permissionSet.has(key)

  const tabs: NavEntry[] = [
    { href: '/dashboard', label: 'Accueil', icon: IconAccueil, active: pathname === '/dashboard', permission: 'dashboard.view' },
    { href: '/chantiers', label: 'Chantiers', icon: IconChantier, active: pathname.startsWith('/chantiers'), permission: 'chantiers.view' },
    { href: '/finances', label: 'Facturation', icon: IconTresorerie, active: pathname.startsWith('/finances'), permission: 'quotes.view' },
    { href: '/clients', label: 'Clients', icon: IconClient, active: pathname.startsWith('/clients'), permission: 'clients.view' },
  ].filter(t => !t.permission || canView(t.permission))

  const menuEntries: MenuEntry[] = [
    { href: '/catalog', label: 'Catalogue', icon: IconCatalogue, permission: 'catalog.view' },
    { href: '/rapports', label: 'Rapports', icon: IconRapport, permission: 'dashboard.view_ca' },
    { href: '/chantiers/planning', label: 'Planning', icon: IconCalendrier, permission: 'chantiers.view' },
    { href: '/settings', label: 'Réglages', icon: IconReglages, permission: 'settings.view' },
  ].filter(m => !m.permission || canView(m.permission))

  return (
    <>
      <nav
        className="fixed bottom-0 inset-x-0 lg:hidden z-[9950] bg-surface border-t border-black/8 dark:border-white/8"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="grid grid-cols-5 h-16">
          {tabs.map(({ href, label, icon: Icon, active }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 min-w-0',
                active ? 'text-accent' : 'text-secondary'
              )}
            >
              <Icon className="w-6 h-6" />
              <span className={cn('text-[10px] leading-none truncate max-w-full px-1', active && 'font-semibold')}>{label}</span>
            </Link>
          ))}
          {menuEntries.length > 0 && (
            <button
              onClick={() => setMenuOpen(true)}
              className="flex flex-col items-center justify-center gap-0.5 min-w-0 text-secondary"
            >
              <IconMenu className="w-6 h-6" />
              <span className="text-[10px] leading-none">Menu</span>
            </button>
          )}
        </div>
      </nav>

      {menuOpen && menuEntries.length > 0 && createPortal(
        <div className="lg:hidden">
          <div className="fixed inset-0 z-[9960] bg-black/50" onClick={() => setMenuOpen(false)} />
          <div
            className="fixed bottom-0 inset-x-0 z-[9961] modal-panel !rounded-t-2xl !rounded-b-none"
            style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-bold text-primary">Menu</h2>
              <button onClick={() => setMenuOpen(false)} className="btn-icon !w-9 !h-9" aria-label="Fermer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {menuEntries.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMenuOpen(false)}
                  className="flex flex-col items-center justify-center gap-2 py-3 rounded-xl text-secondary hover:bg-black/5 dark:hover:bg-white/8 hover:text-primary transition-colors"
                >
                  <Icon className="w-7 h-7" />
                  <span className="text-xs text-center">{label}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
