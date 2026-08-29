import Image from 'next/image'
import { redirect } from 'next/navigation'
import {
  ArrowRight,
  Check,
  FileText,
  LockKeyhole,
  MessageCircle,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getCurrentMembershipContext } from '@/lib/data/queries/membership'
import { getOrganization } from '@/lib/data/queries/organization'
import { getOrganizationEntitlement } from '@/lib/data/queries/subscription-access'
import { getDisplayAccessStatus, hasActiveAccess } from '@/lib/subscription-access'
import { LegalFooter } from '@/components/legal/LegalFooter'
import { wordmarkForTheme } from '@/lib/brand'
import { checkoutAction, exportDataAction, startTrialAction } from './actions'

const ERROR_MESSAGES: Record<string, string> = {
  trial_already_used: 'L’essai gratuit a déjà été utilisé pour cet email ou ce SIRET.',
  trial_activation_failed: 'Ton espace est prêt, mais son activation n’a pas abouti. Réessaie dans un instant.',
  checkout_failed: 'Le paiement sécurisé est momentanément indisponible. Aucun débit n’a été effectué.',
  invalid_tier: 'Cette formule n’est pas disponible.',
}

function PlanCard({ tier, price, featured = false }: { tier: 'pro' | 'expert'; price: number; featured?: boolean }) {
  return (
    <div className={`rounded-3xl border p-5 ${featured ? 'border-accent/50 bg-accent/[0.08]' : 'border-white/10 bg-white/[0.04]'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-xl font-bold capitalize">{tier}</p>
          <p className="mt-1 text-sm text-white/50">{featured ? 'Tout Atelier, sans compromis' : 'L’essentiel pour reprendre le contrôle'}</p>
        </div>
        {featured && <span className="rounded-full bg-accent px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-black">Recommandé</span>}
      </div>
      <p className="mt-5"><span className="font-display text-3xl font-extrabold">{price} €</span><span className="text-sm text-white/45"> HT / mois</span></p>
      <ul className="mt-5 space-y-2 text-sm text-white/70">
        {(tier === 'expert'
          ? ['Tous les assistants métier', 'Pilotage complet de la marge', 'Automatisations avancées']
          : ['Devis, factures et relances', 'Chantiers et planning', 'Marge visible en temps réel']
        ).map((benefit) => <li key={benefit} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />{benefit}</li>)}
      </ul>
      <form action={checkoutAction} className="mt-5">
        <input type="hidden" name="tier" value={tier} />
        <button className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition ${featured ? 'bg-accent text-black hover:brightness-110' : 'bg-white text-black hover:bg-white/90'}`}>
          Choisir {tier === 'pro' ? 'Pro' : 'Expert'} <ArrowRight className="h-4 w-4" />
        </button>
      </form>
    </div>
  )
}

function buildSetupWhatsappUrl(baseUrl: string | undefined, companyName: string): string | null {
  if (!baseUrl?.trim()) return null
  try {
    const url = new URL(baseUrl.trim())
    url.searchParams.set('text', `Bonjour, je souhaite en savoir plus sur l’installation d’Atelier pour ${companyName}.`)
    return url.toString()
  } catch {
    return null
  }
}

export default async function ActivationPage({ searchParams }: { searchParams?: { error?: string; checkout?: string; export?: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [membership, organization, entitlement] = await Promise.all([
    getCurrentMembershipContext(),
    getOrganization(),
    getOrganizationEntitlement(),
  ])
  if (!membership) redirect('/onboarding')
  if (hasActiveAccess(entitlement)) redirect('/dashboard')

  const status = entitlement ? getDisplayAccessStatus(entitlement) : 'locked'
  const canStartTrial = membership.roleSlug === 'owner' && status === 'locked' && !entitlement?.trialStartedAt
  const companyName = organization?.name || 'ton entreprise'
  const errorMessage = searchParams?.error ? ERROR_MESSAGES[searchParams.error] : null
  const setupWhatsappUrl = buildSetupWhatsappUrl(process.env.NEXT_PUBLIC_SETUP_WHATSAPP, companyName)

  return (
    <main className="min-h-screen bg-[#070707] text-white">
      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
        <header className="flex items-center justify-between">
          <Image src={wordmarkForTheme('dark')} alt="Atelier" width={132} height={32} priority />
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/55">
            <ShieldCheck className="h-4 w-4 text-accent" /> Espace sécurisé
          </div>
        </header>

        <section className="mx-auto max-w-3xl py-14 text-center sm:py-20">
          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-accent/25 bg-accent/10">
            <LockKeyhole className="h-6 w-6 text-accent" />
          </div>
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.25em] text-accent">Ton atelier est prêt</p>
          <h1 className="font-display text-4xl font-extrabold tracking-tight sm:text-6xl">
            {companyName}, tes soirées peuvent redevenir les tiennes.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-white/55 sm:text-lg">
            Découvre ce qu’Atelier va prendre en charge. Active ton accès pour transformer ces aperçus en vrais gains de temps.
          </p>
          {errorMessage && <p className="mx-auto mt-6 max-w-xl rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-100">{errorMessage}</p>}
          {searchParams?.export && <p className="mx-auto mt-6 max-w-xl rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/65">{searchParams.export === 'failed' ? 'L’export n’a pas pu être lancé.' : 'Ton export est en préparation. Tu recevras le lien sécurisé par email.'}</p>}

          {canStartTrial && (
            <form action={startTrialAction} className="mt-8">
              <button className="inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-4 font-bold text-black shadow-[0_0_35px_rgba(255,159,28,.18)] transition hover:brightness-110">
                Essaie Expert gratuitement pendant 14 jours <ArrowRight className="h-5 w-5" />
              </button>
              <p className="mt-3 text-xs text-white/35">Sans carte bancaire. Aucun prélèvement à la fin de l’essai.</p>
            </form>
          )}
          {membership.roleSlug !== 'owner' && <p className="mt-7 text-sm text-white/50">Le dirigeant de ton compte peut activer l’accès pour toute l’équipe.</p>}
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
            <div className="flex items-center gap-3"><MessageCircle className="h-5 w-5 text-accent" /><h2 className="font-display font-bold">Sarah suit tes relances</h2></div>
            <div className="mt-5 space-y-3 text-sm">
              <div className="mr-7 rounded-2xl rounded-tl-sm bg-white/[0.07] p-3 text-white/65">Le devis Martin de 8 420 € attend une réponse depuis 6 jours.</div>
              <div className="ml-7 rounded-2xl rounded-tr-sm bg-accent/15 p-3 text-white/80">Je prépare une relance claire et professionnelle ?</div>
            </div>
          </div>
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] p-5">
            <div className="flex items-center gap-3"><FileText className="h-5 w-5 text-accent" /><h2 className="font-display font-bold">Ton devis, prêt plus vite</h2></div>
            <div className="mt-5 rounded-2xl bg-white p-4 text-slate-900">
              <p className="text-xs font-bold uppercase text-slate-400">Devis · Rénovation cuisine</p>
              <div className="mt-4 space-y-2 text-xs"><p className="flex justify-between"><span>Préparation & protection</span><b>680 €</b></p><p className="flex justify-between"><span>Pose & finitions</span><b>4 260 €</b></p><p className="border-t pt-2 text-base font-bold flex justify-between"><span>Total HT</span><span>4 940 €</span></p></div>
            </div>
            <div className="absolute inset-x-0 bottom-0 flex h-20 items-end justify-center bg-gradient-to-t from-[#111] to-transparent pb-4"><span className="flex items-center gap-1.5 rounded-full bg-black/80 px-3 py-1.5 text-xs"><LockKeyhole className="h-3.5 w-3.5" /> Aperçu</span></div>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
            <div className="flex items-center gap-3"><TrendingUp className="h-5 w-5 text-accent" /><h2 className="font-display font-bold">Ta marge, enfin visible</h2></div>
            <p className="mt-7 text-4xl font-extrabold text-emerald-300">28,4 %</p>
            <p className="mt-1 text-sm text-white/40">Marge estimée sur le chantier</p>
            <div className="mt-6 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full w-[71%] rounded-full bg-gradient-to-r from-accent to-emerald-300" /></div>
            <p className="mt-4 text-xs leading-relaxed text-white/45">Repérez ce qui grignote votre rentabilité avant qu’il ne soit trop tard.</p>
          </div>
        </section>

        {membership.roleSlug === 'owner' && (
          <section className="mx-auto mt-20 max-w-4xl">
            <div className="mb-8 text-center"><p className="text-xs font-bold uppercase tracking-[0.22em] text-accent">Accès immédiat pour toute l’équipe</p><h2 className="mt-3 font-display text-3xl font-extrabold">Choisissez votre rythme</h2><p className="mt-3 text-sm text-white/45">Choisis l’accompagnement ou le niveau d’accès adapté à ton entreprise.</p></div>
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="font-display text-xl font-bold">Installation</p><p className="mt-1 text-sm text-white/50">On s’occupe de tout pour démarrer sereinement.</p></div>
                  <MessageCircle className="h-5 w-5 shrink-0 text-accent" />
                </div>
                <p className="mt-5"><span className="font-display text-3xl font-extrabold">3 000 €</span><span className="text-sm text-white/45"> forfait unique</span></p>
                <ul className="mt-5 space-y-2 text-sm text-white/70">
                  {['Installation et configuration complète', 'Accompagnement au démarrage', 'L’IA à l’usage avec ta propre clé'].map((benefit) => <li key={benefit} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />{benefit}</li>)}
                </ul>
                {setupWhatsappUrl && <a href={setupWhatsappUrl} target="_blank" rel="noreferrer" className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-white/25 px-4 py-3 text-sm font-bold transition hover:border-white hover:bg-white/[0.06]">Parler à Orsayn sur WhatsApp <ArrowRight className="h-4 w-4" /></a>}
              </div>
              <PlanCard tier="pro" price={69} />
              <PlanCard tier="expert" price={169} featured />
            </div>
          </section>
        )}

        <div className="mt-14 flex flex-col items-center gap-4 border-t border-white/10 pt-8">
          {membership.roleSlug === 'owner' && <form action={exportDataAction}><button className="text-xs text-white/35 underline decoration-white/20 underline-offset-4 hover:text-white/60">Exporter toutes mes données</button></form>}
          <LegalFooter tone="dark" />
        </div>
      </div>
    </main>
  )
}
