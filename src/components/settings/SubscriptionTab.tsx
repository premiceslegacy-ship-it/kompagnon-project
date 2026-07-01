'use client'

import { useState, useTransition } from 'react'
import { Check, ArrowRight, Zap, Star, Crown, ChevronDown, ChevronUp, AlertTriangle, Loader2 } from 'lucide-react'
import type { OrganizationModules } from '@/lib/organization-modules'
import type { SubscriptionTier } from '@/lib/quota-catalog'
import { createStripePortalSession } from '@/lib/data/mutations/stripe-portal'

// ── Données statiques des tiers ──────────────────────────────────────────────

type TierInfo = {
  tier: SubscriptionTier
  label: string
  price: string
  description: string
  stripeEnvKey: 'NEXT_PUBLIC_STRIPE_LINK_STARTER' | 'NEXT_PUBLIC_STRIPE_LINK_PRO' | 'NEXT_PUBLIC_STRIPE_LINK_EXPERT'
  features: string[]
  highlight?: string
}

const TIER_INFO: TierInfo[] = [
  {
    tier: 'starter',
    label: 'Starter',
    price: '39',
    description: 'L\'essentiel de l\'IA pour votre activité.',
    stripeEnvKey: 'NEXT_PUBLIC_STRIPE_LINK_STARTER',
    features: [
      'Analyse et génération de devis IA',
      'Relances automatiques rédigées par IA',
      'Planning IA',
      'Assistant chantier IA',
      'OCR tickets de caisse',
      'Import documents IA',
      'Rapport chantier IA',
      'Saisie vocale (20 min/mois)',
    ],
  },
  {
    tier: 'pro',
    label: 'Pro',
    price: '69',
    description: 'Sarah, votre secrétaire métier disponible 24h/24.',
    stripeEnvKey: 'NEXT_PUBLIC_STRIPE_LINK_PRO',
    highlight: 'Le plus choisi',
    features: [
      'Tout Starter, sans limites',
      'Sarah — secrétaire métier IA (120 appels/mois)',
      'Sarah vocale ElevenLabs (60 min/mois)',
      'Planning IA illimité',
      'Catalogue IA, import documents illimité',
    ],
  },
  {
    tier: 'expert',
    label: 'Expert',
    price: '139',
    description: 'Tout illimité. Pour les structures qui vont vite.',
    stripeEnvKey: 'NEXT_PUBLIC_STRIPE_LINK_EXPERT',
    features: [
      'Tout Pro, sans aucune limite',
      'Sarah illimitée — texte et vocale (300 min/mois)',
      'Toutes les IA illimitées',
      'Support prioritaire',
    ],
  },
]

const CURRENT_TIER_BENEFITS: Record<SubscriptionTier, string[]> = {
  setup_only: [],
  starter: [
    'Vos devis sont analysés et générés par IA en quelques secondes',
    'Les relances partent automatiquement, rédigées dans votre ton',
    'L\'OCR transforme vos tickets en dépenses sans saisie manuelle',
    'Le planning IA réorganise votre semaine en un clic',
  ],
  pro: [
    'Sarah répond à vos questions métier à tout moment',
    'Sarah vocale gère vos urgences les mains dans le cambouis',
    'Toutes les fonctions Starter sans compteur qui stresse',
    '120 appels Sarah/mois — de quoi couvrir une semaine chargée chaque semaine',
  ],
  expert: [
    'Aucune limite sur Sarah, ni sur aucun autre outil IA',
    'Sarah vocale 300 min/mois — 10 minutes par jour ouvré',
    'La totalité de la plateforme déverrouillée, sans compromis',
    'Vous allez plus vite que vos concurrents, chaque jour',
  ],
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function tierRank(tier: SubscriptionTier): number {
  return { setup_only: 0, starter: 1, pro: 2, expert: 3 }[tier]
}

function detectCurrentTier(modules: OrganizationModules): SubscriptionTier {
  if (modules.sarah_assistant && modules.voice_live) {
    // Pro ou Expert — on distingue par les quotas infinis (pas disponibles ici sans quota_config)
    // Convention : on affiche "Pro" par défaut si sarah_assistant actif; l'upgrade Expert reste visible
    return 'pro'
  }
  if (modules.relances_ai || modules.quote_ai) return 'starter'
  return 'setup_only'
}

// ── Parcours résiliation — 3 étapes ─────────────────────────────────────────

type CancelStep = 'benefits' | 'confirm' | 'prenotice'

const CANCEL_REASONS = [
  'Je n\'utilise pas assez l\'application',
  'Le prix est trop élevé pour mon activité',
  'Je passe à un autre outil',
  'Je ferme ou mets en pause mon activité',
  'Autre',
]

function CancellationFlow({
  tier,
  onClose,
}: {
  tier: SubscriptionTier
  onClose: () => void
}) {
  const [step, setStep] = useState<CancelStep>('benefits')
  const [reason, setReason] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [portalError, setPortalError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const benefits = CURRENT_TIER_BENEFITS[tier] ?? []
  const tierLabel = TIER_INFO.find(t => t.tier === tier)?.label ?? tier

  if (step === 'benefits') {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <p className="text-sm font-semibold text-secondary uppercase tracking-wide">Avant de continuer</p>
          <h3 className="text-xl font-bold text-primary">Voici ce que vous perdez avec l&apos;offre {tierLabel}</h3>
        </div>
        <ul className="space-y-3">
          {benefits.map((b, i) => (
            <li key={i} className="flex items-start gap-3 p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl">
              <span className="mt-0.5 text-amber-500 flex-shrink-0"><AlertTriangle className="w-4 h-4" /></span>
              <span className="text-sm text-primary">{b}</span>
            </li>
          ))}
        </ul>
        <p className="text-sm text-secondary">
          Votre abonnement est sans engagement. Si vous résiliez, l&apos;accès aux fonctions IA sera coupé à l&apos;issue du préavis de 30 jours. Vos données restent accessibles et exportables.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-3 bg-accent text-black font-semibold rounded-xl hover:bg-accent/90 transition-colors"
          >
            Garder mon abonnement
          </button>
          <button
            onClick={() => setStep('confirm')}
            className="px-4 py-3 text-secondary hover:text-primary text-sm transition-colors"
          >
            Continuer vers la résiliation
          </button>
        </div>
      </div>
    )
  }

  if (step === 'confirm') {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <h3 className="text-xl font-bold text-primary">Pourquoi souhaitez-vous résilier ?</h3>
          <p className="text-sm text-secondary">Cette information nous aide à améliorer le service.</p>
        </div>
        <div className="space-y-2">
          {CANCEL_REASONS.map((r) => (
            <button
              key={r}
              onClick={() => setReason(r)}
              className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition-all ${
                reason === r
                  ? 'border-accent bg-accent/10 text-primary font-semibold'
                  : 'border-[var(--elevation-border)] text-secondary hover:text-primary hover:border-accent/50'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <button
            onClick={() => setStep('benefits')}
            className="px-4 py-3 text-secondary hover:text-primary text-sm transition-colors"
          >
            Retour
          </button>
          <button
            onClick={() => setStep('prenotice')}
            disabled={!reason}
            className="flex-1 px-4 py-3 border border-red-300 dark:border-red-500/40 text-red-600 dark:text-red-400 font-semibold rounded-xl hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Continuer
          </button>
        </div>
      </div>
    )
  }

  // step === 'prenotice'
  const expected = 'RÉSILIER'
  const confirmed = confirmText.trim().toUpperCase() === expected

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-xl font-bold text-primary">Confirmer la résiliation</h3>
        <p className="text-sm text-secondary">
          Votre abonnement {tierLabel} sera actif pendant encore 30 jours à compter d&apos;aujourd&apos;hui (préavis contractuel). Passé ce délai, votre accès aux fonctions IA sera suspendu.
        </p>
      </div>
      <div className="p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl space-y-1">
        <p className="text-sm font-semibold text-red-700 dark:text-red-400">Ce que vous perdez définitivement</p>
        <ul className="text-sm text-red-600 dark:text-red-400 space-y-0.5 list-disc list-inside">
          <li>Toutes les fonctions IA ({tierLabel})</li>
          <li>L&apos;historique des analyses et relances IA</li>
          <li>L&apos;accès à Sarah et aux assistants</li>
        </ul>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-semibold text-primary">
          Tapez <span className="font-mono bg-base px-1.5 py-0.5 rounded text-red-600 dark:text-red-400">RÉSILIER</span> pour confirmer
        </label>
        <input
          type="text"
          value={confirmText}
          onChange={e => setConfirmText(e.target.value)}
          placeholder="RÉSILIER"
          className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-[var(--elevation-border)] focus:border-red-400 focus:ring-1 focus:ring-red-400 rounded-xl text-primary outline-none transition-all font-mono"
          autoComplete="off"
        />
      </div>
      {portalError && (
        <p className="text-sm text-red-500 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl px-4 py-3">
          {portalError}
        </p>
      )}
      <div className="flex flex-col sm:flex-row gap-3 pt-2">
        <button
          onClick={() => setStep('confirm')}
          className="px-4 py-3 text-secondary hover:text-primary text-sm transition-colors"
        >
          Retour
        </button>
        <button
          disabled={!confirmed || isPending}
          onClick={() => {
            setPortalError(null)
            startTransition(async () => {
              const returnUrl = `${window.location.origin}/settings?tab=abonnement`
              const result = await createStripePortalSession(returnUrl)
              if ('error' in result) {
                setPortalError(result.error)
              } else {
                window.location.href = result.url
              }
            })
          }}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 font-semibold rounded-xl transition-colors ${
            confirmed && !isPending
              ? 'bg-red-600 text-white hover:bg-red-700'
              : 'bg-red-200 dark:bg-red-500/20 text-red-400 cursor-not-allowed'
          }`}
        >
          {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          {isPending ? 'Redirection...' : 'Valider la résiliation'}
        </button>
      </div>
      <p className="text-xs text-secondary text-center">
        La résiliation est traitée via le portail Stripe sécurisé. Vous recevrez une confirmation par email.
      </p>
    </div>
  )
}

// ── Composant principal ───────────────────────────────────────────────────────

type Props = {
  modules: OrganizationModules
  stripeLinkStarter: string | null
  stripeLinkPro: string | null
  stripeLinkExpert: string | null
  currentTierOverride?: SubscriptionTier | null
}

export default function SubscriptionTab({
  modules,
  stripeLinkStarter,
  stripeLinkPro,
  stripeLinkExpert,
  currentTierOverride,
}: Props) {
  const stripeLinks: Record<string, string | null> = {
    NEXT_PUBLIC_STRIPE_LINK_STARTER: stripeLinkStarter,
    NEXT_PUBLIC_STRIPE_LINK_PRO: stripeLinkPro,
    NEXT_PUBLIC_STRIPE_LINK_EXPERT: stripeLinkExpert,
  }

  const currentTier: SubscriptionTier = currentTierOverride ?? detectCurrentTier(modules)
  const [showCancelFlow, setShowCancelFlow] = useState(false)
  const [showDetails, setShowDetails] = useState(false)

  const tierLabel = currentTier === 'setup_only'
    ? 'Sans abonnement IA'
    : (TIER_INFO.find(t => t.tier === currentTier)?.label ?? currentTier)

  const tierPrice = TIER_INFO.find(t => t.tier === currentTier)?.price ?? null
  const benefits = CURRENT_TIER_BENEFITS[currentTier] ?? []

  return (
    <div className="space-y-10 max-w-2xl">
      {/* ── Abonnement actuel ── */}
      <section className="space-y-4">
        <div>
          <h2 className="text-2xl font-bold text-primary">Abonnement</h2>
          <p className="text-secondary text-sm mt-1">Sans engagement. Résiliable avec 30 jours de préavis.</p>
        </div>

        <div className="p-5 bg-surface dark:bg-white/5 border border-[var(--elevation-border)] rounded-2xl space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-secondary uppercase tracking-wide">Offre actuelle</p>
              <p className="text-2xl font-bold text-primary mt-0.5">{tierLabel}</p>
              {tierPrice && (
                <p className="text-sm text-secondary">{tierPrice} € HT / mois</p>
              )}
            </div>
            {currentTier !== 'setup_only' && (
              <span className="px-3 py-1 bg-accent/15 text-accent text-xs font-bold rounded-full uppercase tracking-wide">Actif</span>
            )}
          </div>

          {benefits.length > 0 && (
            <div>
              <button
                onClick={() => setShowDetails(v => !v)}
                className="flex items-center gap-1.5 text-xs font-semibold text-secondary hover:text-primary transition-colors"
              >
                {showDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                Ce que vous avez avec cette offre
              </button>
              {showDetails && (
                <ul className="mt-3 space-y-2">
                  {benefits.map((b, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm text-secondary">
                      <Check className="w-4 h-4 text-accent mt-0.5 flex-shrink-0" />
                      {b}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <p className="text-xs text-secondary">
            Tarifs HT. TVA non applicable, article 293 B du CGI.{' '}
            <a href="/legal/terms" target="_blank" className="underline hover:text-primary transition-colors">CGV</a>
          </p>
        </div>
      </section>

      {/* ── Tiers disponibles ── */}
      {currentTier !== 'expert' && (
        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-bold text-primary">Passer à une offre supérieure</h2>
            <p className="text-secondary text-sm mt-1">Changement immédiat, au prorata de votre période en cours.</p>
          </div>

          <div className="space-y-3">
            {TIER_INFO.filter(t => tierRank(t.tier) > tierRank(currentTier)).map((t) => {
              const link = stripeLinks[t.stripeEnvKey]
              return (
                <div
                  key={t.tier}
                  className={`p-5 border rounded-2xl space-y-3 transition-all ${
                    t.highlight
                      ? 'border-accent bg-accent/5'
                      : 'border-[var(--elevation-border)] bg-surface dark:bg-white/5'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        {t.tier === 'starter' && <Zap className="w-4 h-4 text-blue-500" />}
                        {t.tier === 'pro' && <Star className="w-4 h-4 text-accent" />}
                        {t.tier === 'expert' && <Crown className="w-4 h-4 text-purple-500" />}
                        <span className="font-bold text-primary">{t.label}</span>
                        {t.highlight && (
                          <span className="px-2 py-0.5 bg-accent text-black text-xs font-bold rounded-full">{t.highlight}</span>
                        )}
                      </div>
                      <p className="text-sm text-secondary mt-0.5">{t.description}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xl font-bold text-primary">{t.price} €</p>
                      <p className="text-xs text-secondary">HT / mois</p>
                    </div>
                  </div>

                  <ul className="space-y-1.5">
                    {t.features.map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-secondary">
                        <Check className="w-3.5 h-3.5 text-accent mt-0.5 flex-shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>

                  {link ? (
                    <a
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`flex items-center justify-center gap-2 w-full px-4 py-3 font-semibold rounded-xl transition-colors ${
                        t.highlight
                          ? 'bg-accent text-black hover:bg-accent/90'
                          : 'bg-surface dark:bg-white/10 border border-[var(--elevation-border)] text-primary hover:border-accent hover:text-accent'
                      }`}
                    >
                      Passer à {t.label}
                      <ArrowRight className="w-4 h-4" />
                    </a>
                  ) : (
                    <div className="w-full px-4 py-3 text-center text-secondary text-sm bg-base rounded-xl">
                      Lien d&apos;abonnement non configuré
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ── Résiliation ── */}
      {currentTier !== 'setup_only' && (
        <section className="space-y-4 border-t border-[var(--elevation-border)] pt-8">
          {!showCancelFlow ? (
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-semibold text-primary">Résilier mon abonnement</h3>
                <p className="text-sm text-secondary mt-0.5">
                  Sans engagement. Un préavis de 30 jours est requis. Vos données restent exportables à tout moment.
                </p>
              </div>
              <button
                onClick={() => setShowCancelFlow(true)}
                className="flex-shrink-0 px-4 py-2 text-sm text-secondary border border-[var(--elevation-border)] rounded-xl hover:border-red-300 hover:text-red-500 transition-colors"
              >
                Résilier
              </button>
            </div>
          ) : (
            <CancellationFlow tier={currentTier} onClose={() => setShowCancelFlow(false)} />
          )}
        </section>
      )}
    </div>
  )
}
