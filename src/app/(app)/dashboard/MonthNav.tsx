'use client'
// @atelier-migrated

import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import styles from './Today.module.css'

const MONTHS_FR = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']

function offsetMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function formatLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${MONTHS_FR[m - 1]} ${y}`
}

export default function MonthNav({ currentMonth }: { currentMonth: string }) {
  const router = useRouter()
  const now = new Date()
  const currentYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const isCurrentMonth = currentMonth === currentYM

  const navigate = (delta: number) => {
    router.push(`/dashboard?mois=${offsetMonth(currentMonth, delta)}`)
  }

  return (
    <div className={styles.monthNav}>
      <button type="button" className={styles.round} onClick={() => navigate(-1)} aria-label="Mois précédent">
        <ChevronLeft size={18} aria-hidden="true" />
      </button>
      <span className={styles.monthLabel} aria-live="polite">
        {formatLabel(currentMonth)}
        {!isCurrentMonth ? (
          <>
            {' · '}
            <button type="button" className={styles.link} onClick={() => router.push('/dashboard')}>Ce mois-ci</button>
          </>
        ) : null}
      </span>
      <button type="button" className={styles.round} onClick={() => navigate(1)} disabled={isCurrentMonth} aria-label="Mois suivant">
        <ChevronRight size={18} aria-hidden="true" />
      </button>
    </div>
  )
}
