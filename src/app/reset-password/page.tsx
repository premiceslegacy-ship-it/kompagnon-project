'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { useState } from 'react'
import { AlertCircle, ArrowRight, Loader2, Eye, EyeOff } from 'lucide-react'
import { resetPassword, type ResetPasswordState } from './actions'
import { BrandMonogram } from '@/components/brand/BrandMonogram'
import { LegalFooter } from '@/components/legal/LegalFooter'

const initialState: ResetPasswordState = { error: null }

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
        <><Loader2 className="w-4 h-4 animate-spin" />Mise à jour…</>
      ) : (
        <>Enregistrer le nouveau mot de passe<ArrowRight className="w-4 h-4" /></>
      )}
    </button>
  )
}

export default function ResetPasswordPage() {
  const [state, action] = useFormState(resetPassword, initialState)
  const [showPw, setShowPw] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

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
          <div className="mb-7">
            <h2 className="text-2xl font-bold font-display">Nouveau mot de passe</h2>
            <p className="mt-1.5 text-sm text-white/40">
              Choisissez un mot de passe sécurisé d'au moins 8 caractères.
            </p>
          </div>

          {state.error && (
            <div className="mb-5 flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-danger/10 border border-danger/25">
              <AlertCircle className="w-4 h-4 text-danger mt-0.5 shrink-0" />
              <p className="text-xs text-danger/90 leading-snug">{state.error}</p>
            </div>
          )}

          <form action={action} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold tracking-widest uppercase text-white/35">
                Nouveau mot de passe
              </label>
              <div className="relative">
                <input
                  name="password"
                  type={showPw ? 'text' : 'password'}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  autoFocus
                  placeholder="Minimum 8 caractères"
                  className={`${inputCls} pr-12`}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                >
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold tracking-widest uppercase text-white/35">
                Confirmer le mot de passe
              </label>
              <div className="relative">
                <input
                  name="confirm"
                  type={showConfirm ? 'text' : 'password'}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  className={`${inputCls} pr-12`}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                >
                  {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
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
