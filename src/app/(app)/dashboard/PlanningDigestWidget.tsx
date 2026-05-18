import React from 'react'
import Link from 'next/link'
import { CalendarDays, MapPin, Clock } from 'lucide-react'
import type { MyPlanningSlot } from '@/lib/data/queries/dashboard-collaborateur'

function fmtTime(t: string | null): string {
  if (!t) return ''
  return t.slice(0, 5)
}

export default function PlanningDigestWidget({ slots }: { slots: MyPlanningSlot[] }) {
  const today = new Date().toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
  })
  // Capitalise le premier caractère
  const todayLabel = today.charAt(0).toUpperCase() + today.slice(1)

  return (
    <div className="rounded-3xl p-6 card transition-all duration-300 ease-out">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-bold text-primary flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-accent" />
            Planning du jour
          </h3>
          <p className="text-xs text-secondary mt-0.5">{todayLabel}</p>
        </div>
        <Link
          href="/chantiers/planning"
          className="text-xs font-semibold text-accent hover:underline flex-shrink-0"
        >
          Tout voir
        </Link>
      </div>

      {slots.length === 0 ? (
        <div className="flex flex-col items-center py-6 gap-2 text-center">
          <CalendarDays className="w-7 h-7 text-secondary opacity-20" />
          <p className="text-sm text-secondary">Aucun créneau planifié aujourd'hui.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {slots.map(slot => (
            <Link
              key={slot.id}
              href={`/chantiers/${slot.chantier_id}`}
              className="flex items-start gap-3 p-3 rounded-2xl hover:bg-black/3 dark:hover:bg-white/5 transition-colors group"
            >
              {/* Heure */}
              <div className="flex-shrink-0 w-10 text-right">
                {slot.start_time ? (
                  <span className="text-xs font-bold text-accent tabular-nums">
                    {fmtTime(slot.start_time)}
                  </span>
                ) : (
                  <Clock className="w-3.5 h-3.5 text-secondary ml-auto" />
                )}
              </div>

              {/* Contenu */}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-primary truncate group-hover:text-accent transition-colors">
                  {slot.chantier_title}
                </p>
                <p className="text-xs text-secondary truncate">{slot.label}</p>
                {slot.chantier_address && (
                  <p className="text-xs text-secondary flex items-center gap-1 mt-0.5">
                    <MapPin className="w-3 h-3 flex-shrink-0" />
                    {slot.chantier_address}
                  </p>
                )}
              </div>

              {/* Fin */}
              {slot.end_time && (
                <span className="flex-shrink-0 text-xs text-secondary tabular-nums">
                  -{fmtTime(slot.end_time)}
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
