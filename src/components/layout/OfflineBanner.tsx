'use client'
// @atelier-migrated

import { useSyncExternalStore } from 'react'
import styles from './OfflineBanner.module.css'

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

/** Prévient quand le réseau tombe : rien n'est enregistré tant qu'on est hors ligne. */
export function OfflineBanner() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true)
  if (online) return null
  return (
    <div className={styles.banner} role="status">
      Vous êtes hors ligne. Reconnectez-vous pour enregistrer vos changements.
    </div>
  )
}
