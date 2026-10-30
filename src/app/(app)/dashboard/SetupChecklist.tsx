'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowRight, Check, Settings2, X } from 'lucide-react'
import type { DashboardSetupReadiness } from '@/lib/data/queries/dashboard'
import { dismissSetupChecklist } from './actions'

type SettingStep = {
  label: string
  done: boolean
}

export default function SetupChecklist({ readiness }: { readiness: DashboardSetupReadiness | null }) {
  const [hidden, setHidden] = useState(false)
  const [, startTransition] = useTransition()

  if (!readiness || readiness.dismissed || hidden) return null

  const steps: SettingStep[] = [
    { label: 'Identité', done: readiness.companyIdentityReady },
    { label: 'Documents', done: readiness.documentDetailsReady },
    { label: 'Paiement', done: readiness.paymentReady },
    { label: 'Signature', done: readiness.signatureReady },
  ]
  const completed = steps.filter((step) => step.done).length
  if (completed === steps.length) return null

  const progress = Math.round((completed / steps.length) * 100)
  const remaining = steps.filter((step) => !step.done).map((step) => step.label.toLocaleLowerCase('fr'))

  function dismiss() {
    setHidden(true)
    startTransition(async () => dismissSetupChecklist())
  }

  return (
    <section className="state-card state-card-warning relative overflow-hidden p-5 sm:p-6">
      <button
        type="button"
        onClick={dismiss}
        className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full text-secondary transition-colors hover:bg-black/5 hover:text-primary dark:hover:bg-white/10"
        aria-label="Masquer ce rappel"
        title="Masquer ce rappel"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex flex-col gap-5 pr-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <span className="status-pill status-pill-accent flex h-11 w-11 shrink-0 items-center justify-center px-0 py-0">
            <Settings2 className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-accent">À compléter plus tard</p>
            <h2 className="mt-1 text-lg font-bold text-primary">Votre espace est déjà opérationnel.</h2>
            <p className="mt-1 text-sm leading-relaxed text-secondary">
              Il reste {remaining.join(', ')} à renseigner pour des documents prêts à envoyer.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {steps.map((step) => (
                <span key={step.label} className={`status-pill ${step.done ? 'status-pill-success' : 'status-pill-muted'} px-2.5 py-1 text-xs font-semibold`}>
                  {step.done && <Check className="h-3 w-3" />}
                  {step.label}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="shrink-0 lg:w-[390px]">
          <div className="mb-2 flex items-center justify-between text-xs font-semibold text-secondary">
            <span>Configuration</span>
            <span>{progress}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[rgb(var(--bg-interactive))] dark:bg-white/10">
            <div className="h-full rounded-full bg-accent" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 sm:flex-nowrap">
            <Link href="/settings?tab=entreprise" className="btn-secondary inline-flex min-h-10 flex-1 items-center justify-center gap-2 whitespace-nowrap px-4 text-sm">
              Compléter mes infos
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/settings?tab=facturation" className="inline-flex min-h-10 flex-1 items-center justify-center whitespace-nowrap rounded-full border border-[var(--elevation-border)] px-4 text-xs font-semibold text-secondary transition-colors hover:text-accent">
              E-facturation au choix
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
