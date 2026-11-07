'use client'
// @atelier-migrated

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { errorPageStyles as styles } from './ErrorPage'

/** Action pleine de nouvel essai (erreurs React : `reset`). */
export function ErrorRetryButton({ onRetry, children = 'Réessayer' }: { onRetry: () => void; children?: ReactNode }) {
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      className={styles.primary}
      disabled={busy}
      aria-busy={busy || undefined}
      onClick={() => {
        setBusy(true)
        onRetry()
        // Si l'erreur persiste la page se re-rend en erreur : on rend la main au bout d'un instant.
        window.setTimeout(() => setBusy(false), 1500)
      }}
    >
      {busy ? 'Nouvel essai…' : children}
    </button>
  )
}

/** « Référence 7f3a-91c2 · Copier » : à donner au support. */
export function ErrorReference({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      return
    }
    setCopied(true)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <p className={styles.reference}>
      <span>
        Référence <b>{value}</b>
      </span>
      <button type="button" className={styles.link} onClick={() => void copy()}>
        {copied ? 'Copiée' : 'Copier'}
      </button>
    </p>
  )
}
