'use client'

import { useState } from 'react'
import { useFormStatus } from 'react-dom'
import { useSearchParams } from 'next/navigation'
import { ArrowRight, Loader2, AlertCircle, Eye, EyeOff } from 'lucide-react'
import { completeInviteSetup } from './actions'
import { BrandMonogram } from '@/components/brand/BrandMonogram'
import { LegalFooter } from '@/components/legal/LegalFooter'

const inputCls =
  'w-full px-4 py-3 bg-white/[0.06] border border-white/[0.08] focus:border-accent/50 focus:ring-1 focus:ring-accent/20 rounded-xl text-white text-sm outline-none transition-all placeholder:text-white/20'

const JOB_TITLES = [
  { value: 'Commercial',          label: 'Commercial' },
  { value: 'Administratif',       label: 'Administratif' },
  { value: 'Chef de chantier',    label: 'Chef de chantier' },
  { value: 'Technicien',          label: 'Technicien' },
  { value: 'Autre',               label: 'Autre' },
]

const ERROR_MESSAGES: Record<string, string> = {
  missing_name:    'Veuillez saisir votre nom.',
  missing_password:'Le mot de passe doit contenir au moins 8 caractères.',
  password_failed: 'Impossible de définir le mot de passe. Veuillez réessayer.',
  update_failed:   'Une erreur est survenue. Veuillez réessayer.',
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full py-3.5 rounded-pill bg-accent text-black font-bold text-sm hover:opacity-90 active:scale-[0.99] transition-all shadow-glow-accent disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
    >
      {pending ? (
        <><Loader2 className="w-4 h-4 animate-spin" />Chargement…</>
      ) : (
        <>Accéder à mon espace<ArrowRight className="w-4 h-4" /></>
      )}
    </button>
  )
}

type Props = {
  orgName: string
  initialFullName: string | null
}

export default function InviteSetupClient({ orgName, initialFullName }: Props) {
  const [selectedJobTitle, setSelectedJobTitle] = useState('')
  const [customJobTitle, setCustomJobTitle] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const searchParams = useSearchParams()
  const errorKey = searchParams.get('error')
  const errorMsg = errorKey ? ERROR_MESSAGES[errorKey] : null

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-[#050505] text-white overflow-hidden font-body p-6">
      {/* Glows */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-accent/[0.08] rounded-full blur-[160px] pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-accent/[0.04] rounded-full blur-[120px] pointer-events-none" />

      {/* Logo */}
      <div className="relative z-10 mb-10">
        <div className="w-12 h-12 rounded-2xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center backdrop-blur-sm">
          <BrandMonogram background="dark" className="w-8 h-8 object-contain" />
        </div>
      </div>

      {/* Card */}
      <div className="relative z-10 w-full max-w-lg">
        <div className="bg-white/[0.04] backdrop-blur-[40px] border border-white/[0.08] rounded-3xl p-8 lg:p-10">

          {/* En-tête */}
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold font-display mb-2">Bienvenue dans l&apos;équipe&nbsp;!</h1>
            <p className="text-sm text-white/45 leading-relaxed">
              Vous avez rejoint <span className="text-white font-semibold">{orgName}</span>.<br />
              Complétez votre profil pour commencer.
            </p>
          </div>

          {errorMsg && (
            <div className="mb-5 flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-danger/10 border border-danger/25">
              <AlertCircle className="w-4 h-4 text-danger mt-0.5 shrink-0" />
              <p className="text-xs text-danger/90 leading-snug">{errorMsg}</p>
            </div>
          )}

          <form action={completeInviteSetup} className="space-y-5">

            {/* Nom complet */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold tracking-widest uppercase text-white/35">
                Nom complet <span className="text-accent">*</span>
              </label>
              <input
                type="text"
                name="full_name"
                required
                autoComplete="name"
                placeholder="Jean Dupont"
                defaultValue={initialFullName ?? ''}
                className={inputCls}
              />
            </div>

            {/* Poste */}
            <div className="space-y-2">
              <label className="text-[11px] font-semibold tracking-widest uppercase text-white/35">
                Votre poste <span className="text-white/25 normal-case tracking-normal font-normal">(optionnel)</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {JOB_TITLES.map((j) => (
                  <button
                    key={j.value}
                    type="button"
                    onClick={() => setSelectedJobTitle(j.value)}
                    className={`px-3 py-2.5 rounded-xl text-xs font-semibold text-left transition-all border ${
                      selectedJobTitle === j.value
                        ? 'bg-accent/15 border-accent/40 text-accent'
                        : 'bg-white/[0.04] border-white/[0.08] text-white/50 hover:bg-white/[0.07] hover:text-white/70'
                    }`}
                  >
                    {j.label}
                  </button>
                ))}
              </div>

              {/* Champ libre si "Autre" */}
              {selectedJobTitle === 'Autre' && (
                <input
                  type="text"
                  placeholder="Ex: Conducteur de travaux"
                  value={customJobTitle}
                  onChange={(e) => setCustomJobTitle(e.target.value)}
                  className={`${inputCls} mt-2`}
                  autoFocus
                />
              )}

              <input
                type="hidden"
                name="job_title"
                value={
                  selectedJobTitle === 'Autre'
                    ? customJobTitle
                    : selectedJobTitle
                }
              />
            </div>

            {/* Mot de passe */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold tracking-widest uppercase text-white/35">
                Mot de passe <span className="text-accent">*</span>
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  required
                  autoComplete="new-password"
                  placeholder="••••••••"
                  minLength={8}
                  className={`${inputCls} pr-12`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[11px] text-white/25">
                Minimum 8 caractères. Vous en aurez besoin pour vous reconnecter.
              </p>
            </div>

            <div className="pt-2">
              <SubmitButton />
            </div>
          </form>
        </div>
      </div>

      <LegalFooter tone="dark" className="relative z-10 mt-8" />
    </div>
  )
}
