import Link from 'next/link'
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
  UserPlus,
  Users,
} from 'lucide-react'
import type { DashboardSetupReadiness } from '@/lib/data/queries/dashboard'

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
      <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2.5 py-1 text-xs font-bold text-green-600 dark:text-success">
        <Check className="h-3 w-3" />
        +{reward} pts
      </span>
    )
  }

  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${optional ? 'bg-base text-secondary' : 'bg-accent/10 text-accent'}`}>
      {optional ? `Bonus +${reward}` : `+${reward} pts`}
    </span>
  )
}

function ChecklistItem({ item }: { item: SetupItem }) {
  const Icon = item.icon

  return (
    <Link
      href={item.href}
      className="group flex min-h-[112px] items-start gap-3 rounded-2xl border border-[var(--elevation-border)] bg-base/70 p-4 transition-all hover:-translate-y-0.5 hover:border-accent/45 hover:bg-accent/5 dark:bg-white/[0.03]"
    >
      <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${item.done ? 'bg-success/10 text-green-600 dark:text-success' : 'bg-accent/10 text-accent'}`}>
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

export default function SetupChecklist({ readiness }: { readiness: DashboardSetupReadiness | null }) {
  if (!readiness) return null
  const organizationName = readiness.organizationName?.trim() || 'votre entreprise'

  const requiredItems: SetupItem[] = [
    {
      title: 'Finaliser l’identité',
      description: 'Nom, email et activité métier pour adapter les libellés, unités et modèles.',
      href: '/settings?tab=entreprise',
      done: readiness.companyIdentityReady,
      reward: 120,
      tag: 'Mission 1',
      icon: Building2,
    },
    {
      title: 'Préparer les documents',
      description: 'Adresse, SIRET et TVA pour générer des devis et factures prêts à envoyer.',
      href: '/settings?tab=entreprise',
      done: readiness.documentDetailsReady,
      reward: 150,
      tag: 'Mission 2',
      icon: FileText,
    },
    {
      title: 'Ajouter les infos de paiement',
      description: 'RIB et délais pour éviter de les ressaisir sur chaque facture.',
      href: '/settings?tab=entreprise',
      done: readiness.paymentReady,
      reward: 120,
      tag: 'Mission 3',
      icon: CreditCard,
    },
    {
      title: 'Signer les contrats',
      description: 'Nom, fonction et signature manuscrite pour automatiser la partie signataire.',
      href: '/settings?tab=entreprise',
      done: readiness.signatureReady,
      reward: 110,
      tag: 'Mission 4',
      icon: ClipboardSignature,
    },
    {
      title: 'Vérifier le catalogue',
      description: 'Vos prestations de départ servent de base aux devis et aux chiffrages IA.',
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
      title: 'Inviter l’équipe',
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

  if (completedRequired === requiredTotal) return null

  return (
    <section className="card overflow-hidden rounded-3xl">
      <div className="grid gap-0 lg:grid-cols-[minmax(280px,0.72fr)_1fr]">
        <div className="border-b border-[var(--elevation-border)] bg-base/70 p-5 sm:p-6 lg:border-b-0 lg:border-r dark:bg-white/[0.025]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-bold uppercase tracking-wider text-accent">Quête de lancement</p>
              <h2 className="mt-2 text-2xl font-bold tracking-tight text-primary">Monter {organizationName} en puissance</h2>
              <p className="mt-2 text-sm leading-relaxed text-secondary">
                Chaque mission débloque un gain concret dans l’app. Les bonus restent facultatifs pour les entreprises qui en ont besoin.
              </p>
            </div>
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-accent/25 bg-accent/10">
              <span className="text-lg font-extrabold tabular-nums text-accent">{completedRequired}/{requiredTotal}</span>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2">
            <div className="rounded-2xl border border-[var(--elevation-border)] bg-surface p-3 dark:bg-white/[0.03]">
              <p className="text-[11px] font-bold uppercase tracking-wider text-secondary">Niveau</p>
              <p className="mt-1 text-sm font-extrabold text-primary">{level}</p>
            </div>
            <div className="rounded-2xl border border-[var(--elevation-border)] bg-surface p-3 dark:bg-white/[0.03]">
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
            <Link href={nextItem.href} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-accent px-5 py-3 text-sm font-extrabold text-black shadow-lg shadow-accent/20 transition-all hover:scale-[1.01] active:scale-[0.99]">
              Lancer : {nextItem.title.toLowerCase()}
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
