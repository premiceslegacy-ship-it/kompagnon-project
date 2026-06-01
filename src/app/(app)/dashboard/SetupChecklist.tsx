'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowRight,
  Building2,
  Check,
  ClipboardSignature,
  CreditCard,
  FileText,
  Globe,
  PackageCheck,
  Sparkles,
  Trophy,
  UserPlus,
  Users,
} from 'lucide-react'
import type { DashboardSetupReadiness } from '@/lib/data/queries/dashboard'
import { getBusinessActivityById } from '@/lib/catalog-context'
import { dismissSetupChecklist } from './actions'

type SetupItem = {
  title: string
  description: string
  href: string
  done: boolean
  optional?: boolean
  metric?: string
  reward: number
  tag: string
  icon: LucideIcon
}

function StatusBadge({ done, optional, reward }: { done: boolean; optional?: boolean; reward: number }) {
  if (done) {
    return (
      <span className="status-pill status-pill-success px-2.5 py-1 text-xs font-bold">
        <Check className="h-3 w-3" />
        +{reward} pts
      </span>
    )
  }

  return (
    <span className={`status-pill ${optional ? 'status-pill-muted' : 'status-pill-accent'} px-2.5 py-1 text-xs font-bold`}>
      {optional ? `Bonus +${reward}` : `+${reward} pts`}
    </span>
  )
}

function ChecklistItem({ item }: { item: SetupItem }) {
  const Icon = item.icon

  return (
    <Link
      href={item.href}
      className={`state-card ${item.done ? 'state-card-success' : item.optional ? 'state-card-muted' : 'state-card-warning'} group flex min-h-[112px] items-start gap-3 p-4`}
    >
      <span className={`status-pill ${item.done ? 'status-pill-success' : 'status-pill-accent'} mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center px-0 py-0`}>
        {item.done ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-start justify-between gap-2">
          <span>
            <span className="block text-[11px] font-extrabold uppercase tracking-wider text-secondary">{item.tag}</span>
            <span className="block font-bold text-primary">{item.title}</span>
          </span>
          <StatusBadge done={item.done} optional={item.optional} reward={item.reward} />
        </span>
        <span className="mt-1 block text-sm leading-relaxed text-secondary">{item.description}</span>
        {item.metric && <span className="mt-2 block text-xs font-semibold text-accent">{item.metric}</span>}
      </span>
      <ArrowRight className="mt-2 h-4 w-4 shrink-0 text-secondary transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
    </Link>
  )
}

function getCatalogSetupCopy(activityId: DashboardSetupReadiness['businessActivityId']) {
  const activity = getBusinessActivityById(activityId)

  if (!activity) {
    return {
      title: 'Vérifier le catalogue',
      description: "Un catalogue de départ a été préparé selon votre activité. Ajustez les tarifs et les libellés pour qu'ils reflètent votre réalité.",
    }
  }

  const profileCopy = {
    cleaning: {
      title: 'Vérifier les prestations de nettoyage',
      focus: 'produits, prestations, passages et ressources',
    },
    btp: {
      title: 'Vérifier les ouvrages et fournitures',
      focus: "ouvrages, fournitures, main-d'œuvre et modèles de devis",
    },
    industry: {
      title: 'Vérifier les opérations atelier',
      focus: 'matières, opérations, temps machine et modèles de fabrication',
    },
  }[activity.businessProfile]

  return {
    title: profileCopy.title,
    description: `Le catalogue préparé pour l'activité ${activity.label.toLowerCase()} contient déjà des ${profileCopy.focus}. Ajustez les tarifs, unités et libellés pour coller à votre façon de travailler.`,
  }
}

function SetupCompleteCard({ organizationName, earnedPoints }: { organizationName: string; earnedPoints: number }) {
  const [dismissed, setDismissed] = useState(false)
  const router = useRouter()

  if (dismissed) return null

  function handleNav(href: string) {
    setDismissed(true)
    dismissSetupChecklist()
    router.push(href)
  }

  return (
    <section className="card overflow-hidden rounded-3xl border-accent/25">
      <div className="relative p-5 sm:p-6 lg:p-7">
        <div className="absolute inset-x-0 top-0 h-1 bg-accent" />
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <span className="status-pill status-pill-success flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl px-0 py-0">
              <Trophy className="h-7 w-7" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold uppercase tracking-wider text-accent">Quête de lancement terminée</p>
              <h2 className="mt-1 text-2xl font-extrabold tracking-tight text-primary sm:text-3xl">
                {organizationName} est prêt à vendre
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-primary/70 sm:text-[1rem]">
                Votre espace est configuré : identité, documents, paiement, signature, catalogue, client et premier devis.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:min-w-[260px]">
            <div className="state-card state-card-muted p-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-secondary">Score</p>
              <p className="mt-1 text-lg font-extrabold tabular-nums text-primary">{earnedPoints} pts</p>
            </div>
            <div className="state-card state-card-success p-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-accent">Statut</p>
              <p className="mt-1 text-lg font-extrabold text-primary">Prêt à vendre</p>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center">
          <button
            onClick={() => handleNav(`/finances/quote-editor?returnTo=${encodeURIComponent('/dashboard')}`)}
            className="btn-primary inline-flex items-center justify-center gap-2 px-5 py-3 text-sm"
          >
            Créer le prochain devis
            <ArrowRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => { setDismissed(true); dismissSetupChecklist() }}
            className="btn-secondary inline-flex items-center justify-center gap-2 px-5 py-3 text-sm"
          >
            Continuer sur le dashboard
            <Sparkles className="h-4 w-4" />
          </button>
        </div>
      </div>
    </section>
  )
}

export default function SetupChecklist({ readiness }: { readiness: DashboardSetupReadiness | null }) {
  if (!readiness) return null
  const organizationName = readiness.organizationName?.trim() || 'votre entreprise'
  const catalogCopy = getCatalogSetupCopy(readiness.businessActivityId)

  const requiredItems: SetupItem[] = [
    {
      title: "Finaliser l'identité",
      description: "Nom, email et activité métier pour adapter les libellés, unités et modèles.",
      href: '/settings?tab=entreprise#identite',
      done: readiness.companyIdentityReady,
      reward: 120,
      tag: 'Mission 1',
      icon: Building2,
    },
    {
      title: 'Préparer les documents',
      description: "SIRET (section Identité) + adresse complète (section Coordonnées) pour générer des devis et factures prêts à envoyer.",
      href: '/settings?tab=entreprise#identite',
      done: readiness.documentDetailsReady,
      reward: 150,
      tag: 'Mission 2',
      icon: FileText,
    },
    {
      title: 'Ajouter les infos de paiement',
      description: 'RIB et délais pour éviter de les ressaisir sur chaque facture.',
      href: '/settings?tab=entreprise#paiement',
      done: readiness.paymentReady,
      reward: 120,
      tag: 'Mission 3',
      icon: CreditCard,
    },
    {
      title: 'Signer les contrats',
      description: 'Nom, fonction et signature manuscrite pour automatiser la partie signataire.',
      href: '/settings?tab=entreprise#signature',
      done: readiness.signatureReady,
      reward: 110,
      tag: 'Mission 4',
      icon: ClipboardSignature,
    },
    {
      title: catalogCopy.title,
      description: catalogCopy.description,
      href: '/catalog',
      done: readiness.catalogReady,
      metric: readiness.counts.catalogItems > 0 ? `${readiness.counts.catalogItems} élément${readiness.counts.catalogItems > 1 ? 's' : ''} prêt${readiness.counts.catalogItems > 1 ? 's' : ''}` : undefined,
      reward: 140,
      tag: 'Mission 5',
      icon: PackageCheck,
    },
    {
      title: 'Créer le premier client',
      description: 'Une fiche client complète accélère les devis, factures, relances et contrats.',
      href: '/clients',
      done: readiness.firstClientReady,
      metric: readiness.counts.clients > 0 ? `${readiness.counts.clients} client${readiness.counts.clients > 1 ? 's' : ''}` : undefined,
      reward: 160,
      tag: 'Mission 6',
      icon: UserPlus,
    },
    {
      title: 'Faire le premier devis',
      description: 'Le meilleur raccourci pour découvrir clients, catalogue, PDF et signature en ligne.',
      href: `/finances/quote-editor?returnTo=${encodeURIComponent('/dashboard')}`,
      done: readiness.firstQuoteReady,
      metric: readiness.counts.quotes > 0 ? `${readiness.counts.quotes} devis` : undefined,
      reward: 200,
      tag: 'Mission 7',
      icon: Sparkles,
    },
  ]

  const optionalItems: SetupItem[] = [
    {
      title: "Inviter l'équipe",
      description: 'Utile si plusieurs personnes suivent les chantiers, heures, clients ou relances.',
      href: '/settings?tab=equipe',
      done: readiness.teamReady,
      optional: true,
      metric: readiness.counts.teamMembers > 1 ? `${readiness.counts.teamMembers} membres` : undefined,
      reward: 80,
      tag: 'Bonus',
      icon: Users,
    },
    {
      title: 'Activer le formulaire public',
      description: 'Pratique pour transformer un site, un QR code ou une bio réseau social en demandes qualifiées.',
      href: '/settings?tab=formulaire',
      done: readiness.publicFormReady,
      optional: true,
      reward: 80,
      tag: 'Bonus',
      icon: Globe,
    },
  ]

  const completedRequired = requiredItems.filter((item) => item.done).length
  const requiredTotal = requiredItems.length
  const progress = Math.round((completedRequired / requiredTotal) * 100)
  const nextItem = requiredItems.find((item) => !item.done) ?? optionalItems.find((item) => !item.done)
  const earnedPoints = [...requiredItems, ...optionalItems]
    .filter((item) => item.done)
    .reduce((sum, item) => sum + item.reward, 0)
  const totalRequiredPoints = requiredItems.reduce((sum, item) => sum + item.reward, 0)
  const level =
    completedRequired >= 6 ? 'Prêt à vendre'
    : completedRequired >= 4 ? 'Documents solides'
    : completedRequired >= 2 ? 'Base posée'
    : 'Démarrage'

  if (completedRequired === requiredTotal) {
    return <SetupCompleteCard organizationName={organizationName} earnedPoints={totalRequiredPoints} />
  }

  return (
    <section className="card overflow-hidden rounded-3xl">
      <div className="grid gap-0 lg:grid-cols-[minmax(280px,0.72fr)_1fr]">
        <div className="border-b border-[var(--elevation-border)] bg-base/70 p-5 sm:p-6 lg:border-b-0 lg:border-r dark:bg-white/[0.025]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-bold uppercase tracking-wider text-accent">Quête de lancement</p>
              <h2 className="mt-2 text-2xl font-bold tracking-tight text-primary">Monter {organizationName} en puissance</h2>
              <p className="mt-2 text-sm leading-relaxed text-secondary">
                Chaque mission débloque un gain concret dans l&#39;app. Les bonus restent facultatifs pour les entreprises qui en ont besoin.
              </p>
            </div>
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-accent/25 bg-accent/10">
              <span className="text-lg font-extrabold tabular-nums text-accent">{completedRequired}/{requiredTotal}</span>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2">
            <div className="state-card state-card-muted p-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-secondary">Niveau</p>
              <p className="mt-1 text-sm font-extrabold text-primary">{level}</p>
            </div>
            <div className="state-card state-card-muted p-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-secondary">Score</p>
              <p className="mt-1 text-sm font-extrabold tabular-nums text-primary">{earnedPoints}/{totalRequiredPoints} pts</p>
            </div>
          </div>

          <div className="mt-6 h-2 overflow-hidden rounded-full bg-[rgb(var(--bg-interactive))] dark:bg-white/10">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-2 text-xs font-semibold text-secondary">
            Progression essentielle : {progress}%
          </p>

          {nextItem && (
            <Link href={nextItem.href} className="btn-primary mt-6 inline-flex w-full items-center justify-center gap-2 px-5 py-3 text-sm">
              {nextItem.title}
              <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </div>

        <div className="space-y-3 p-4 sm:p-5">
          <div className="grid gap-3 xl:grid-cols-2">
            {requiredItems.map((item) => <ChecklistItem key={item.title} item={item} />)}
          </div>
          <div className="grid gap-3 border-t border-[var(--elevation-border)] pt-3 xl:grid-cols-2">
            {optionalItems.map((item) => <ChecklistItem key={item.title} item={item} />)}
          </div>
        </div>
      </div>
    </section>
  )
}
