// @atelier-migrated
import Link from 'next/link'
import { LEGAL_PATHS } from '@/lib/legal'
import styles from './LegalLinks.module.css'

/** Liens vers les pages légales, centrés. */
export function LegalLinks({ className }: { className?: string }) {
  return (
    <nav aria-label="Liens légaux" className={className ? `${styles.links} ${className}` : styles.links}>
      <Link href={LEGAL_PATHS.privacy} className={styles.link}>Confidentialité</Link>
      <Link href={LEGAL_PATHS.terms} className={styles.link}>Conditions</Link>
      <Link href={LEGAL_PATHS.legal} className={styles.link}>Mentions légales</Link>
    </nav>
  )
}
