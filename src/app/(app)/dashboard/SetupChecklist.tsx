'use client'
// @atelier-migrated

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check } from 'lucide-react'
import type { DashboardSetupReadiness } from '@/lib/data/queries/dashboard'
import { Button } from '@/components/ui/Button'
import { dismissSetupChecklist } from './actions'
import styles from '@/components/layout/Screen.module.css'

const NB = ' '

/** Carte « Mise en route » du propriétaire : 4 étapes, puis disparaît. */
export default function SetupChecklist({ readiness }: { readiness: DashboardSetupReadiness | null }) {
  const router = useRouter()
  const [hidden, setHidden] = useState(false)
  const [, startTransition] = useTransition()

  if (!readiness || readiness.dismissed || hidden) return null

  const steps = [
    { label: 'Identité', done: readiness.companyIdentityReady },
    { label: 'Documents', done: readiness.documentDetailsReady },
    { label: 'Paiement', done: readiness.paymentReady },
    { label: 'Signature', done: readiness.signatureReady },
  ]
  const completed = steps.filter(step => step.done).length
  if (completed === steps.length) return null

  const progress = Math.round((completed / steps.length) * 100)
  const remaining = steps.filter(step => !step.done).map(step => step.label.toLocaleLowerCase('fr'))

  function dismiss() {
    setHidden(true)
    startTransition(async () => dismissSetupChecklist())
  }

  return (
    <section className={styles.card} aria-labelledby="today-setup">
      <div className={styles.setupText}>
        <div className={styles.label}>
          <span>Mise en route</span>
          <span className={styles.amount}>{progress}{NB}%</span>
        </div>
        <div className={styles.progress} role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Mise en route">
          <i style={{ width: `${progress}%` }} />
        </div>
        <h2 className={styles.setupTitle} id="today-setup">Votre espace est déjà opérationnel.</h2>
        <p className={styles.sub}>Il reste {remaining.join(', ')} à renseigner pour des documents prêts à envoyer.</p>
        <ul className={styles.chips}>
          {steps.map(step => (
            <li key={step.label} data-done={step.done ? 'true' : 'false'}>
              {step.done ? <Check size={13} aria-hidden="true" /> : null}
              {step.label}
              {step.done ? <span className="sr-only">, fait</span> : null}
            </li>
          ))}
        </ul>
      </div>
      <div className={styles.setupFoot}>
        <div className={styles.setupActions}>
          <Button size="md" onClick={() => router.push('/settings?tab=entreprise')}>Compléter mes infos</Button>
          <button type="button" className={styles.link} onClick={dismiss}>Plus tard</button>
          <Link href="/settings?tab=facturation" className={styles.link}>E-facturation au choix</Link>
        </div>
      </div>
    </section>
  )
}
