// @atelier-migrated
import Link from 'next/link'
import type { MyPlanningSlot } from '@/lib/data/queries/dashboard-collaborateur'
import styles from '@/components/layout/Screen.module.css'

const fmtTime = (t: string | null) => (t ? t.slice(0, 5) : '')

function parisNow(): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Paris' }).format(new Date())
}

/** Planning du jour en frise, comme la maquette : les créneaux passés sont pleins. */
export default function PlanningDigestWidget({ slots }: { slots: MyPlanningSlot[] }) {
  const now = parisNow()
  return (
    <section className={styles.group} aria-labelledby="today-planning">
      <h2 className={styles.groupTitle} id="today-planning">
        Aujourd&apos;hui{' '}
        <Link href="/chantiers/planning" className={styles.link}>Planning complet</Link>
      </h2>
      {slots.length === 0 ? (
        <div className={styles.empty}>Aucun créneau planifié aujourd&apos;hui.</div>
      ) : (
        <ul className={styles.timeline}>
          {slots.map(slot => {
            const end = slot.end_time ? fmtTime(slot.end_time) : null
            const past = end !== null && end <= now
            const sub = [slot.label, slot.chantier_address].filter(Boolean).join(' · ')
            return (
              <li key={slot.id}>
                <Link
                  href={slot.source === 'maintenance' ? '/chantiers/entretien' : `/chantiers/${slot.chantier_id}`}
                  className={styles.slot}
                  data-past={past ? 'true' : 'false'}
                >
                  <span className={styles.slotTime}>{fmtTime(slot.start_time) || 'Jour'}</span>
                  <span className={styles.rail}><i /></span>
                  <span className={styles.slotText}>
                    <span className={styles.slotTitle}>{slot.chantier_title}</span>
                    {sub ? <span className={styles.slotSub}>{end ? `Jusqu'à ${end} · ` : ''}{sub}</span> : null}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
