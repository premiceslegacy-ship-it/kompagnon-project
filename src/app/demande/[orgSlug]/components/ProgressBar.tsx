'use client'

const STEP_COUNT = 4

/** Avancement du formulaire : quatre traits, puis « Étape n sur 4 ». */
export function ProgressBar({ step }: { step: number }) {
  return (
    <div className="mx-espace-4 mt-espace-4">
      <div className="grid grid-cols-4 gap-[6px]" aria-hidden="true">
        {Array.from({ length: STEP_COUNT }, (_, i) => (
          <span key={i} className={`h-1 rounded-[2px] ${i < step ? 'bg-[var(--at-accent)]' : 'bg-remplissage'}`} />
        ))}
      </div>
      <p className="mb-0 mt-[6px] text-note font-atelier-medium text-encre-2">Étape {step} sur {STEP_COUNT}</p>
    </div>
  )
}
