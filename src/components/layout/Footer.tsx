'use client'
// @atelier-migrated

import { usePathname } from 'next/navigation'
import { APP_SIGNATURE } from '@/lib/brand'
import { LegalLinks } from '@/components/legal/LegalLinks'
import styles from './Footer.module.css'

/** Pied de page discret : signature du logiciel et liens légaux. Absent des éditeurs plein écran. */
export const Footer = ({ orgName: _orgName }: { orgName: string | null }) => {
  const pathname = usePathname()
  if (pathname?.startsWith('/finances/quote-editor') || pathname?.startsWith('/atelier-ia')) return null

  return (
    <footer className={`${styles.footer}${pathname?.startsWith('/orsayn') ? ' cockpit-footer' : ''}`}>
      <p className={styles.signature}>{APP_SIGNATURE}</p>
      <LegalLinks />
    </footer>
  )
}
