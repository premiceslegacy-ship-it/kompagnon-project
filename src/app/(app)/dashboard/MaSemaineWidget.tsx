'use client'
// @atelier-migrated

import { useState } from 'react'
import { getWeeklySummary } from '@/lib/data/mutations/ai-summary'
import { cleanMarkdown } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import styles from './Today.module.css'

/** Résumé de la semaine par Sarah, à la demande. */
export default function MaSemaineWidget() {
  const [summary, setSummary] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)

  async function handleGenerate() {
    if (isPending) return
    setError(null)
    setIsPending(true)
    try {
      const res = await getWeeklySummary()
      if (res.error) setError(res.error)
      else if (!res.summary) setError("Sarah n'a pas renvoyé de résumé. Réessayez dans un instant.")
      else setSummary(res.summary)
    } catch (err) {
      console.error('[MaSemaineWidget.handleGenerate]', err)
      setError('Impossible de préparer le résumé pour le moment.')
    } finally {
      setIsPending(false)
    }
  }

  return (
    <section className={styles.card} aria-labelledby="today-week">
      <div className={styles.label}>
        <span id="today-week">Ma semaine</span>
        <Button variant="secondary" size="sm" onClick={handleGenerate} loading={isPending} loadingText="Préparation">
          {summary ? 'Actualiser' : error ? 'Réessayer' : 'Résumé'}
        </Button>
      </div>
      <p className={styles.summary} data-ready={summary ? 'true' : 'false'} aria-live="polite">
        {isPending && !summary
          ? 'Je prépare votre semaine…'
          : error
            ? error
            : summary
              ? cleanMarkdown(summary)
              : 'Chantiers, devis, factures : un résumé en quelques secondes.'}
      </p>
    </section>
  )
}
