'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { AlertCircle, ArrowRight, Loader2, KeyRound } from 'lucide-react'
import { verifyRecoveryOtp } from './actions'
import { BrandMonogram } from '@/components/brand/BrandMonogram'
import { LegalFooter } from '@/components/legal/LegalFooter'

const initialState = { error: null }

const inputCls =
  'w-full px-4 py-3 bg-white/[0.06] border border-white/[0.08] focus:border-accent/50 focus:ring-1 focus:ring-accent/20 rounded-xl text-white text-sm outline-none transition-all placeholder:text-white/20'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full py-3.5 rounded-pill bg-accent text-black font-bold text-sm hover:opacity-90 active:scale-[0.99] transition-all shadow-glow-accent disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
    >
      {pending ? (
        <><Loader2 className="w-4 h-4 animate-spin" />Vérification...</>
      ) : (
        <>Continuer<ArrowRight className="w-4 h-4" /></>
      )}
    </button>
  )
}

export default function VerifyRecoveryForm({ email }: { email: string }) {
  const [state, formAction] = useFormState(verifyRecoveryOtp, initialState)

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-[#050505] text-white overflow-hidden font-body p-6">
      {/* Glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-accent/[0.08] rounded-full blur-[160px] pointer-events-none" />

      {/* Logo */}
      <div className="relative z-10 mb-10">
        <div className="w-12 h-12 rounded-2xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center backdrop-blur-sm">
          <BrandMonogram background="dark" className="w-8 h-8 object-contain" />
        </div>
      </div>

      <div className="relative z-10 w-full max-w-md">
        <div className="bg-white/[0.04] backdrop-blur-[40px] border border-white/[0.08] rounded-3xl p-8 lg:p-10">

          {/* Icon */}
          <div className="flex justify-center mb-6">
            <div className="w-14 h-14 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
              <KeyRound className="w-7 h-7 text-accent" />
            </div>
          </div>

          <div className="mb-7 text-center">
            <h2 className="text-2xl font-bold font-display">Code de réinitialisation</h2>
            <p className="mt-2 text-sm text-white/40 leading-relaxed">
              Saisissez le code envoyé à<br />
              <span className="text-white/70 font-medium">{email}</span>
            </p>
          </div>

          {state.error && (
            <div className="mb-5 flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-danger/10 border border-danger/25">
              <AlertCircle className="w-4 h-4 text-danger mt-0.5 shrink-0" />
              <p className="text-xs text-danger/90 leading-snug">{state.error}</p>
            </div>
          )}

          <form action={formAction} className="space-y-4">
            <input type="hidden" name="email" value={email} />

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold tracking-widest uppercase text-white/35">
                Code reçu par email
              </label>
              <input
                name="token"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                autoFocus
                placeholder="123456"
                className={`${inputCls} text-center text-2xl tracking-[0.5em] font-mono`}
              />
            </div>

            <div className="pt-2">
              <SubmitButton />
            </div>
          </form>

          <p className="mt-6 text-center text-xs text-white/30">
            Vous n&apos;avez pas reçu le code ?{' '}
            <a href="/forgot-password" className="text-accent font-semibold hover:opacity-75 transition-opacity">
              Renvoyer
            </a>
          </p>
        </div>
      </div>

      <LegalFooter tone="dark" className="relative z-10 mt-8" />
    </div>
  )
}
