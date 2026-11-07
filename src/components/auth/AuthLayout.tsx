// @atelier-migrated
import type { ReactNode } from 'react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { APP_NAME } from '@/lib/brand'
import { LEGAL_PATHS } from '@/lib/legal'
import styles from './Auth.module.css'

type AuthLayoutProps = {
  title: ReactNode
  subtitle?: ReactNode
  /** Retour : un lien (page voisine) ou une action (étape précédente d'un parcours). */
  backHref?: string
  onBack?: () => void
  backLabel?: string
  /** Avancement d'un parcours en quelques points. */
  steps?: { current: number; total: number }
  hideLogo?: boolean
  size?: 'narrow' | 'wide'
  children: ReactNode
}

/** Page d'entrée : fond du thème, logo, titre, contenu, mentions légales. */
export function AuthLayout({
  title,
  subtitle,
  backHref,
  onBack,
  backLabel = 'Retour',
  steps,
  hideLogo = false,
  size = 'narrow',
  children,
}: AuthLayoutProps) {
  return (
    <main className={styles.page}>
      <div className={styles.inner} data-size={size}>
        {backHref ? (
          <Link href={backHref} className={styles.back}>
            <ChevronLeft size={20} aria-hidden="true" />
            {backLabel}
          </Link>
        ) : onBack ? (
          <button type="button" className={styles.back} onClick={onBack}>
            <ChevronLeft size={20} aria-hidden="true" />
            {backLabel}
          </button>
        ) : null}
        {!hideLogo && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={`${styles.logo} ${styles.logoLight}`} src="/brand/atelier/logo-atelier-noir.svg" alt={APP_NAME} draggable={false} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={`${styles.logo} ${styles.logoDark}`} src="/brand/atelier/logo-atelier-blanc.svg" alt="" aria-hidden="true" draggable={false} />
          </>
        )}
        {steps && (
          <div className={styles.dots} role="img" aria-label={`Étape ${steps.current + 1} sur ${steps.total}`}>
            {Array.from({ length: steps.total }, (_, index) => (
              <i key={index} data-state={index === steps.current ? 'on' : index < steps.current ? 'past' : undefined} />
            ))}
          </div>
        )}
        <h1 className={styles.title}>{title}</h1>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        {children}
        <nav className={styles.legal} aria-label="Liens légaux">
          <Link href={LEGAL_PATHS.terms}>Conditions</Link> · <Link href={LEGAL_PATHS.privacy}>Confidentialité</Link> ·{' '}
          <Link href={LEGAL_PATHS.legal}>Mentions légales</Link>
        </nav>
      </div>
    </main>
  )
}
