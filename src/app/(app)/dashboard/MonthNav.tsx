'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const MONTHS_FR = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.']

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
    const next = offsetMonth(currentMonth, delta)
    router.push(`/dashboard?mois=${next}`)
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => navigate(-1)}
        className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-base transition-colors text-secondary hover:text-primary"
        title="Mois précédent"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <span className="text-sm font-semibold text-primary min-w-[90px] text-center tabular-nums">
        {formatLabel(currentMonth)}
      </span>
      <button
        onClick={() => navigate(1)}
        disabled={isCurrentMonth}
        className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-base transition-colors text-secondary hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed"
        title="Mois suivant"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
      {!isCurrentMonth && (
        <button
          onClick={() => router.push('/dashboard')}
          className="ml-1 text-xs font-semibold text-accent hover:underline"
        >
          Aujourd&apos;hui
        </button>
      )}
    </div>
  )
}
