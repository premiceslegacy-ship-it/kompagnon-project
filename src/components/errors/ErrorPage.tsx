// @atelier-migrated
import Link from 'next/link'
import type { ReactNode } from 'react'
import { APP_NAME } from '@/lib/brand'
import styles from './ErrorPage.module.css'

export type ErrorSymbol = 'doc' | 'alert' | 'wifi' | 'chain' | 'lock' | 'clock'

/** Un symbole évident par situation : trait fin, un seul détail en couleur d'accent. */
const SYMBOLS: Record<ErrorSymbol, { label: string; body: ReactNode }> = {
  doc: {
    label: 'Une page avec un point d’interrogation',
    body: (
      <>
        <path d="M12 6h17l9 9v27H12z" />
        <path d="M29 6v9h9" />
        <path className={styles.accent} d="M20.5 26.5a3.5 3.5 0 1 1 5 3.2c-1 .6-1.5 1.2-1.5 2.3" />
        <path className={styles.accent} d="M24 37v.01" />
      </>
    ),
  },
  alert: {
    label: 'Un triangle d’avertissement',
    body: (
      <>
        <path d="M24 7.5 43 40.5H5z" />
        <path className={styles.accent} d="M24 19v11" />
        <path className={styles.accent} d="M24 35v.01" />
      </>
    ),
  },
  wifi: {
    label: 'Un symbole de réseau barré',
    body: (
      <>
        <path d="M6 19a26 26 0 0 1 36 0" />
        <path d="M12 26.5a17 17 0 0 1 24 0" />
        <path d="M18.5 34a8 8 0 0 1 11 0" />
        <path d="M24 40v.01" />
        <path className={styles.accent} d="M8 8l32 32" />
      </>
    ),
  },
  chain: {
    label: 'Un maillon de chaîne brisé',
    body: (
      <g transform="rotate(-45 24 24)">
        <rect x="2" y="17" width="19" height="14" rx="7" />
        <rect x="27" y="17" width="19" height="14" rx="7" />
        <path className={styles.accent} d="M24 8.5v6M24 33.5v6" />
      </g>
    ),
  },
  lock: {
    label: 'Un cadenas',
    body: (
      <>
        <rect x="11" y="21" width="26" height="20" rx="5" />
        <path d="M17 21v-5a7 7 0 0 1 14 0v5" />
        <path className={styles.accent} d="M24 28.5v5" />
      </>
    ),
  },
  clock: {
    label: 'Une horloge',
    body: (
      <>
        <circle cx="24" cy="24" r="17" />
        <path className={styles.accent} d="M24 14v10l7 4" />
      </>
    ),
  },
}

type ErrorPageProps = {
  symbol: ErrorSymbol
  /** Petite ligne au-dessus du titre (« Erreur 404 »…). */
  code: string
  title: string
  description?: ReactNode
  /** Contenu entre le texte et les actions (formulaire, message). */
  children?: ReactNode
  /** Une action pleine, puis éventuellement une action en texte. */
  actions?: ReactNode
  /** Sous les actions : référence à donner au support. */
  footer?: ReactNode
  /** Page entière avec logo (hors de l'app), sinon contenu de page dans l'app. */
  full?: boolean
}

export function ErrorPage({ symbol, code, title, description, children, actions, footer, full = false }: ErrorPageProps) {
  const art = SYMBOLS[symbol]
  return (
    <main className={styles.page} data-full={full || undefined}>
      <div className={styles.inner}>
        {full && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={`${styles.logo} ${styles.logoLight}`} src="/brand/atelier/logo-atelier-noir.svg" alt={APP_NAME} draggable={false} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={`${styles.logo} ${styles.logoDark}`} src="/brand/atelier/logo-atelier-blanc.svg" alt="" aria-hidden="true" draggable={false} />
          </>
        )}
        <svg className={styles.symbol} viewBox="0 0 48 48" role="img" aria-label={art.label}>
          {art.body}
        </svg>
        <p className={styles.code}>{code}</p>
        <h1 className={styles.title}>{title}</h1>
        {description && <p className={styles.description}>{description}</p>}
        {children && <div className={styles.extra}>{children}</div>}
        {actions && <div className={styles.actions}>{actions}</div>}
        {footer}
      </div>
    </main>
  )
}

/** Action pleine qui est un lien (retour à l'accueil…). */
export function ErrorPrimaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={styles.primary}>
      {children}
    </Link>
  )
}

export function ErrorTextLink({ href, children }: { href: string; children: ReactNode }) {
  const external = href.startsWith('mailto:') || href.startsWith('tel:')
  return external ? (
    <a href={href} className={styles.link}>
      {children}
    </a>
  ) : (
    <Link href={href} className={styles.link}>
      {children}
    </Link>
  )
}

export const errorPageStyles = styles
