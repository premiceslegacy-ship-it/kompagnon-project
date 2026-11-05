'use client'
// @atelier-migrated

import Link from 'next/link'
import { ChevronRight, Mic, ShieldAlert } from 'lucide-react'
import { useNavigationAccess } from '@/components/layout/NavigationAccess'
import styles from '@/components/layout/Screen.module.css'

const NB = ' '

/** En-tête d'Aujourd'hui : date, état du jour, accès à Sarah et rappel de la décennale. */
export default function TodayHeader({ kicker, title }: { kicker: string; title: string }) {
  const { model, notifications } = useNavigationAccess()
  const days = notifications.decennaleExpiringDays
  const canSettings = model.companyGroups.some(group => group.some(entry => entry.id === 'settings'))

  const decennaleText = days === null
    ? null
    : days < 0
      ? `Assurance décennale${NB}: elle a expiré il y a ${Math.abs(days)}${NB}jour${Math.abs(days) > 1 ? 's' : ''}. Renouvelez-la dans les Réglages.`
      : `Assurance décennale${NB}: elle expire dans ${days}${NB}jour${days > 1 ? 's' : ''}. Pensez au renouvellement.`

  const decennaleContent = decennaleText ? (
    <>
      <ShieldAlert className={styles.alertIcon} size={20} aria-hidden="true" />
      <span>{decennaleText}</span>
      {canSettings ? <ChevronRight className={styles.chevron} size={16} aria-hidden="true" /> : null}
    </>
  ) : null

  return (
    <>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>{kicker}</p>
          <h1 className={styles.title}>{title}</h1>
        </div>
      </header>
      {model.canUseAssistant ? (
        <button
          type="button"
          className={styles.ask}
          onClick={() => window.dispatchEvent(new CustomEvent('sarah-open'))}
        >
          <Mic size={18} aria-hidden="true" />
          <span>Demander ou rechercher</span>
          <kbd aria-hidden="true">⌘K</kbd>
        </button>
      ) : null}
      {decennaleContent && days !== null ? (
        canSettings ? (
          <Link href="/settings?tab=entreprise" className={styles.alert} data-expired={days < 0 ? 'true' : 'false'}>
            {decennaleContent}
          </Link>
        ) : (
          <p className={styles.alert} data-expired={days < 0 ? 'true' : 'false'}>{decennaleContent}</p>
        )
      ) : null}
    </>
  )
}
