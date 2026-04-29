'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { useState } from 'react'
import { AlertCircle, ArrowRight, Loader2, CheckCircle2 } from 'lucide-react'
import { login, signup, type AuthState } from '../actions'
import { BrandWordmark } from '@/components/brand/BrandMonogram'
import { LegalFooter } from '@/components/legal/LegalFooter'
import { APP_SIGNATURE } from '@/lib/brand'

const initialState: AuthState = { error: null }

const inputCls =
  'w-full px-4 py-3 bg-white/[0.06] border border-white/[0.08] focus:border-accent/50 focus:ring-1 focus:ring-accent/20 rounded-xl text-white text-sm outline-none transition-all placeholder:text-white/20'

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full py-3.5 rounded-pill bg-accent text-black font-bold text-sm hover:opacity-90 active:scale-[0.99] transition-all shadow-glow-accent disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
    >
      {pending ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          Chargement...
        </>
      ) : (
        <>
          {label}
          <ArrowRight className="w-4 h-4" />
        </>
      )}
    </button>
  )
}

export default function AuthPage() {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [loginState, loginAction] = useFormState(login, initialState)
  const [signupState, signupAction] = useFormState(signup, initialState)

  const error = mode === 'login' ? loginState.error : signupState.error
  const message = mode === 'signup' ? signupState.message : undefined

  return (
    <div className="fixed inset-0 flex bg-[#050505] text-white overflow-y-auto font-body">

      {/* ── LEFT PANEL — Branding ── */}
      <div className="relative hidden lg:flex flex-col justify-between flex-1 p-16 xl:p-24 overflow-hidden">
        {/* Ambient glows */}
        <div className="absolute -top-1/3 -left-1/4 w-[700px] h-[700px] bg-accent/[0.12] rounded-full blur-[180px] pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-accent/[0.05] rounded-full blur-[140px] pointer-events-none" />

        {/* Logo */}
        <div className="relative z-10 -ml-2 lg:-ml-3">
          <BrandWordmark background="dark" className="h-9 w-auto object-contain" />
        </div>

        {/* Headline */}
        <div className="relative z-10 max-w-lg">
          <h1 className="text-5xl xl:text-[4rem] font-bold leading-[1.1] tracking-tight font-display">
            L&apos;ERP qui<br />comprend<br />votre métier.
          </h1>
          <p className="mt-6 text-base text-white/40 leading-relaxed">
            Gérez vos chantiers, vos finances et vos clients avec une intelligence artificielle intégrée.
          </p>
        </div>

        <p className="relative z-10 text-xs text-white/20">
          &copy; {new Date().getFullYear()} {APP_SIGNATURE}. Tous droits réservés.
        </p>
      </div>

      {/* Divider */}
      <div className="hidden lg:block w-px bg-white/[0.05] self-stretch" />

      {/* ── RIGHT PANEL — Form ── */}
      <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6 lg:p-16 min-h-screen lg:min-h-0">

        {/* Mobile logo */}
        <div className="lg:hidden flex mb-8 self-center">
          <BrandWordmark background="dark" className="h-8 w-auto object-contain" />
        </div>

        <div className="w-full max-w-md">
          {/* Glass card */}
          <div className="bg-white/[0.04] backdrop-blur-[40px] border border-white/[0.08] rounded-2xl sm:rounded-3xl p-6 sm:p-8 lg:p-10">

            {/* Header */}
            <div className="mb-7">
              <h2 className="text-2xl font-bold font-display">
                {mode === 'login' ? 'Bon retour !' : 'Bienvenue !'}
              </h2>
              <p className="mt-1.5 text-sm text-white/40">
                {mode === 'login'
                  ? 'Connectez-vous à votre espace de travail.'
                  : `Accédez à votre écosystème métier intelligent.`}
              </p>
            </div>

            {/* Success message (inscription confirmée par email) */}
            {message && (
              <div className="mb-5 flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-success/10 border border-success/25">
                <CheckCircle2 className="w-4 h-4 text-success mt-0.5 shrink-0" />
                <p className="text-xs text-success/90 leading-snug">{message}</p>
              </div>
            )}

            {/* Error message */}
            {error && (
              <div className="mb-5 flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-danger/10 border border-danger/25">
                <AlertCircle className="w-4 h-4 text-danger mt-0.5 shrink-0" />
                <p className="text-xs text-danger/90 leading-snug">{error}</p>
              </div>
            )}

            {/* ── LOGIN FORM ── */}
            {mode === 'login' && (
              <form action={loginAction} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold tracking-widest uppercase text-white/35">
                    Email
                  </label>
                  <input
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="vous@entreprise.fr"
                    className={inputCls}
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-semibold tracking-widest uppercase text-white/35">
                      Mot de passe
                    </label>
                    <a href="/forgot-password" className="text-xs text-white/30 hover:text-accent transition-colors">
                      Mot de passe oublié ?
                    </a>
                  </div>
                  <input
                    name="password"
                    type="password"
                    required
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className={inputCls}
                  />
                </div>

                <div className="pt-2">
                  <SubmitButton label="Se connecter" />
                </div>
              </form>
            )}

            {/* ── SIGNUP FORM ── */}
            {mode === 'signup' && (
              <form action={signupAction} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold tracking-widest uppercase text-white/35">
                    Nom complet
                  </label>
                  <input
                    name="full_name"
                    type="text"
                    required
                    autoComplete="name"
                    placeholder="Jean Dupont"
                    className={inputCls}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold tracking-widest uppercase text-white/35">
                    Email
                  </label>
                  <input
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="vous@entreprise.fr"
                    className={inputCls}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold tracking-widest uppercase text-white/35">
                    Mot de passe
                  </label>
                  <input
                    name="password"
                    type="password"
                    required
                    autoComplete="new-password"
                    placeholder="Minimum 8 caractères"
                    className={inputCls}
                  />
                </div>

                <div className="pt-2">
                  <SubmitButton label="Créer mon compte" />
                </div>
              </form>
            )}

            {/* Toggle mode */}
            <p className="mt-7 text-center text-xs text-white/30">
              {mode === 'login' ? (
                <>
                  Vous n&apos;avez pas de compte ?{' '}
                  <button
                    onClick={() => setMode('signup')}
                    className="text-accent font-semibold hover:opacity-75 transition-opacity"
                  >
                    S&apos;inscrire
                  </button>
                </>
              ) : (
                <>
                  Déjà un compte ?{' '}
                  <button
                    onClick={() => setMode('login')}
                    className="text-accent font-semibold hover:opacity-75 transition-opacity"
                  >
                    Se connecter
                  </button>
                </>
              )}
            </p>
          </div>
        </div>

        <LegalFooter tone="dark" className="mt-8" />
      </div>
    </div>
  )
}
