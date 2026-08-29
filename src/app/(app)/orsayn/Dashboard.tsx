import Link from 'next/link'
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Euro,
  Mail,
  Users,
  Zap,
} from 'lucide-react'
import type { CockpitData } from './data'
import { clientPath, formatMoney, formatPercent, formatSeverity, formatTier } from './utils'
import { UsageBreakdownChart, UsageTrendChart } from './UsageCharts'

function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`cockpit-panel ${className}`}>{children}</section>
}

function Kpi({ label, value, hint, icon: Icon, accent = false }: {
  label: string
  value: string
  hint: string
  icon: typeof Users
  accent?: boolean
}) {
  return (
    <Panel className="p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="cockpit-eyebrow">{label}</p>
        <Icon className={accent ? 'h-4 w-4 text-accent' : 'h-4 w-4 text-secondary'} />
      </div>
      <p className={`mt-5 text-3xl font-semibold tracking-tight tabular-nums ${accent ? 'text-accent' : 'text-primary'}`}>{value}</p>
      <p className="mt-2 text-xs text-secondary">{hint}</p>
    </Panel>
  )
}

function ClientLink({ row, detail }: { row: CockpitData['clientRows'][number]; detail: string }) {
  return <Link href={clientPath(row.sourceInstance, row.organizationId)} className="group flex items-center justify-between gap-4 border-b border-[var(--cockpit-line)] py-3 last:border-0">
    <span className="min-w-0">
      <span className="block truncate font-medium text-primary group-hover:text-accent">{row.label}</span>
      <span className="mt-0.5 block truncate text-xs text-secondary">{detail}</span>
    </span>
    <ArrowUpRight className="h-4 w-4 shrink-0 text-secondary transition group-hover:text-accent" />
  </Link>
}

export default function Dashboard({ data }: { data: CockpitData }) {
  const alertCount = data.syncAttentionRows.length + data.trialEndingRows.length + data.paymentAttentionRows.length
  const allAlerts = [
    ...data.syncAttentionRows.map((row) => ({ row, label: 'Configuration à vérifier', detail: row.configSyncError ?? 'Renvoyer la configuration au client', icon: AlertTriangle })),
    ...data.trialEndingRows.map((row) => ({ row, label: 'Essai bientôt terminé', detail: row.trialEndsAt ? `Fin le ${new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' }).format(new Date(row.trialEndsAt))}` : 'Fin prochaine', icon: Clock3 })),
    ...data.paymentAttentionRows.map((row) => ({ row, label: 'Paiement à vérifier', detail: 'Le dernier paiement n’a pas abouti', icon: CircleDollarSign })),
  ].slice(0, 8)

  return (
    <main className="cockpit-shell">
      <header className="cockpit-header">
        <div>
          <p className="cockpit-kicker">Pilotage Orsayn</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-primary sm:text-4xl">Bonjour, voici la vue d’ensemble.</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-secondary">Suis tes clients, ta rentabilité et la consommation IA depuis un seul espace.</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-secondary">
          <span className="hidden sm:inline">{data.user.email}</span>
          <div className="flex flex-wrap items-center gap-2"><Link href="/orsayn/emails" className="cockpit-button cockpit-button-outline"><Mail className="h-4 w-4" /> Emails</Link><Link href="/orsayn/clients" className="cockpit-button cockpit-button-dark"><Users className="h-4 w-4" /> Voir les clients</Link></div>
        </div>
      </header>

      {alertCount > 0 && (
        <Panel className="p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-accent" /><p className="font-semibold text-primary">{alertCount} point{alertCount > 1 ? 's' : ''} à traiter</p></div>
              <p className="mt-1 text-sm text-secondary">Les éléments importants de la semaine sont regroupés ici.</p>
            </div>
            <div className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
              <Link href="/orsayn/clients?filter=sync" className="text-secondary hover:text-accent">{data.syncAttentionRows.length} configuration{data.syncAttentionRows.length > 1 ? 's' : ''}</Link>
              <Link href="/orsayn/clients?filter=trial" className="text-secondary hover:text-accent">{data.trialEndingRows.length} essai{data.trialEndingRows.length > 1 ? 's' : ''}</Link>
              <Link href="/orsayn/clients?filter=payment" className="text-secondary hover:text-accent">{data.paymentAttentionRows.length} paiement{data.paymentAttentionRows.length > 1 ? 's' : ''}</Link>
            </div>
          </div>
          {allAlerts.length > 0 && <div className="mt-4 grid gap-x-6 sm:grid-cols-2 lg:grid-cols-4">
            {allAlerts.slice(0, 4).map(({ row, label, detail, icon: Icon }) => <Link key={`${row.sourceInstance}:${row.organizationId}:${label}`} href={clientPath(row.sourceInstance, row.organizationId)} className="border-t border-[var(--cockpit-line)] py-3 hover:bg-[var(--cockpit-paper)]"><span className="flex items-center gap-2 text-xs font-semibold text-primary"><Icon className="h-3.5 w-3.5 text-accent" />{row.label}</span><span className="mt-1 block truncate text-xs text-secondary">{detail}</span></Link>)}
          </div>}
        </Panel>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Revenus du mois" value={formatMoney(data.revenueTotalEur)} hint={`${data.activeRows.filter((row) => row.monthlyFee !== null).length} forfaits renseignés`} icon={Euro} />
        <Kpi label="Coût IA pris en charge" value={formatMoney(data.costTotalEur)} hint={`Consommation totale : ${formatMoney(data.usageTotalEur)}`} icon={Zap} />
        <Kpi label="Marge estimée" value={formatMoney(data.grossMarginTotalEur)} hint={`${formatPercent(data.marginRate)} de marge brute`} icon={CircleDollarSign} accent />
        <Kpi label="Clients actifs" value={String(data.activeRows.length)} hint={`${data.clientRows.filter((row) => row.isArchived).length} fiche${data.clientRows.filter((row) => row.isArchived).length > 1 ? 's' : ''} archivée${data.clientRows.filter((row) => row.isArchived).length > 1 ? 's' : ''}`} icon={Users} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.45fr_.55fr]">
        <Panel className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-lg font-semibold text-primary">Consommation IA</p><p className="mt-1 text-sm text-secondary">Évolution des douze derniers mois, tous clients confondus.</p></div><span className="cockpit-tag"><Zap className="h-3.5 w-3.5" /> Coût en EUR</span></div>
          <div className="mt-5"><UsageTrendChart history={data.usageHistory} /></div>
        </Panel>
        <Panel className="p-5 sm:p-6">
          <p className="text-lg font-semibold text-primary">À suivre</p>
          <p className="mt-1 text-sm text-secondary">Les dossiers qui demandent ton attention.</p>
          <div className="mt-3">{allAlerts.length === 0 ? <div className="flex items-center gap-2 py-7 text-sm text-secondary"><CheckCircle2 className="h-4 w-4 text-success" />Tout est à jour.</div> : allAlerts.slice(0, 5).map(({ row, label, detail }) => <ClientLink key={`${row.sourceInstance}:${row.organizationId}:${label}`} row={row} detail={`${label} · ${detail}`} />)}</div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel className="p-5 sm:p-6"><div className="mb-3"><p className="text-lg font-semibold text-primary">Coût par fonction</p><p className="mt-1 text-sm text-secondary">Ce qui consomme le plus ce mois-ci.</p></div><UsageBreakdownChart rows={data.featureUsageRows} title="Fonction" /></Panel>
        <Panel className="p-5 sm:p-6"><div className="mb-3"><p className="text-lg font-semibold text-primary">Coût par modèle</p><p className="mt-1 text-sm text-secondary">Répartition de la consommation IA.</p></div><UsageBreakdownChart rows={data.modelUsageRows} title="Modèle" /></Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel className="p-5 sm:p-6"><div className="flex items-start justify-between gap-3"><div><p className="text-lg font-semibold text-primary">Clients les plus consommateurs</p><p className="mt-1 text-sm text-secondary">Usage IA indicatif du mois.</p></div><Link href="/orsayn/clients" className="text-xs font-semibold text-accent hover:underline">Tout voir</Link></div><div className="mt-3">{data.expensiveRows.length === 0 ? <p className="py-5 text-sm text-secondary">Pas encore de consommation.</p> : data.expensiveRows.map((row) => <ClientLink key={`${row.sourceInstance}:${row.organizationId}`} row={row} detail={`${formatMoney(row.monthUsageCostEur)} · ${row.monthEventCount} appel${row.monthEventCount > 1 ? 's' : ''}`} />)}</div></Panel>
        <Panel className="p-5 sm:p-6"><div><p className="text-lg font-semibold text-primary">Marge à surveiller</p><p className="mt-1 text-sm text-secondary">Les forfaits les moins rentables ce mois-ci.</p></div><div className="mt-3">{data.lowMarginRows.length === 0 ? <p className="py-5 text-sm text-secondary">Pas assez de données pour calculer la marge.</p> : data.lowMarginRows.map((row) => <ClientLink key={`${row.sourceInstance}:${row.organizationId}`} row={row} detail={`${formatPercent(row.marginPct)} · ${formatMoney(row.grossMarginEur ?? 0)} de marge`} />)}</div></Panel>
      </div>

      {data.recommendations.length > 0 && <Panel className="p-5 sm:p-6"><div className="flex items-center gap-2"><ArrowUpRight className="h-4 w-4 text-accent" /><p className="text-lg font-semibold text-primary">Opportunités commerciales</p></div><div className="mt-3 grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">{data.recommendations.slice(0, 6).map((recommendation) => <Link key={recommendation.id} href={clientPath(recommendation.sourceInstance, recommendation.organizationId)} className="border-t border-[var(--cockpit-line)] py-3"><div className="flex items-center justify-between gap-3"><span className="truncate font-medium text-primary">{recommendation.clientLabel}</span><span className={`cockpit-tag ${recommendation.severity === 'high' ? 'cockpit-tag-danger' : ''}`}>{formatSeverity(recommendation.severity)}</span></div><p className="mt-1 text-xs text-secondary">{recommendation.reason}</p><p className="mt-1 text-xs font-medium text-accent">{formatTier(recommendation.suggestedTier)}</p></Link>)}</div></Panel>}
    </main>
  )
}
