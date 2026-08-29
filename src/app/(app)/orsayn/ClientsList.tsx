'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Archive, CheckCircle2, Plus, Search, UserRound } from 'lucide-react'
import { upsertOperatorClientSettings } from './actions'
import ActionForm from './ActionForm'
import type { CockpitData } from './data'
import { clientPath, formatDate, formatMoney, formatPercent, formatSyncStatus, formatTier, getSyncBadge, isActiveTrial } from './utils'

type Filter = 'active' | 'archived' | 'all' | 'sync' | 'trial' | 'payment'
type Sort = 'name' | 'margin' | 'usage' | 'recent'

const inputClass = 'cockpit-input w-full'

function AddClientForm() {
  return (
    <ActionForm action={upsertOperatorClientSettings} className="grid gap-4 md:grid-cols-2" feedbackClassName="md:col-span-2" successMessage="Fiche client enregistrée.">
      <label><span className="cockpit-label">Nom du client</span><input required name="label" className={inputClass} placeholder="Entreprise Martin" /></label>
      <label><span className="cockpit-label">Identifiant technique</span><input required name="sourceInstance" className={inputClass} placeholder="entreprise-martin" /></label>
      <label><span className="cockpit-label">Identifiant d’organisation (instance partagée)</span><input name="organizationId" className={inputClass} placeholder="Optionnel" /></label>
      <p className="md:col-span-2 -mt-2 text-xs leading-5 text-secondary">Cette action crée une fiche de suivi dans le cockpit. Si l’identifiant d’organisation est laissé vide, elle reste en préconfiguration jusqu’à ce que l’app cliente fournisse son organisation réelle.</p>
      <label><span className="cockpit-label">Email de contact</span><input name="contactEmail" type="email" className={inputClass} placeholder="contact@entreprise.fr" /></label>
      <label><span className="cockpit-label">Forfait mensuel HT</span><input name="monthlyFeeHt" type="number" min="0" step="0.01" className={inputClass} placeholder="69" /></label>
      <label><span className="cockpit-label">URL de l’espace client</span><input name="appUrl" type="url" className={inputClass} placeholder="https://atelier.entreprise.fr" /></label>
      <label><span className="cockpit-label">Devise</span><select name="billingCurrency" defaultValue="EUR" className={inputClass}><option value="EUR">EUR</option><option value="USD">USD</option></select></label>
      <label className="flex items-center gap-3 self-end pb-2 text-sm text-secondary"><input defaultChecked name="isActive" type="checkbox" className="h-4 w-4 accent-accent" /> Fiche active</label>
      <div className="md:col-span-2"><button type="submit" className="cockpit-button cockpit-button-dark"><Plus className="h-4 w-4" /> Ajouter la fiche</button></div>
    </ActionForm>
  )
}

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'active', label: 'Actifs' },
  { value: 'archived', label: 'Archivés' },
  { value: 'sync', label: 'Configuration' },
  { value: 'trial', label: 'Essais' },
  { value: 'payment', label: 'Paiements' },
  { value: 'all', label: 'Tous' },
]

function matchesFilter(row: CockpitData['clientRows'][number], filter: Filter): boolean {
  if (filter === 'active') return row.isActive && !row.isArchived
  if (filter === 'archived') return row.isArchived
  if (filter === 'sync') return row.isActive && !row.isArchived && ['failed', 'pending_manual'].includes(row.configSyncStatus ?? '')
  if (filter === 'trial') return row.isActive && !row.isArchived && !row.trialConverted && isActiveTrial(row.trialEndsAt)
  if (filter === 'payment') return row.isActive && !row.isArchived && (Boolean(row.paymentFailedAt) || ['past_due', 'unpaid'].includes(row.stripeStatus ?? ''))
  return true
}

export default function ClientsList({ data, initialFilter = 'active' }: { data: CockpitData; initialFilter?: Filter }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>(initialFilter)
  const [sort, setSort] = useState<Sort>('name')
  const [showAdd, setShowAdd] = useState(false)

  const rows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('fr')
    return data.clientRows
      .filter((row) => matchesFilter(row, filter))
      .filter((row) => !normalized || `${row.label} ${row.sourceInstance} ${row.contactEmail ?? ''}`.toLocaleLowerCase('fr').includes(normalized))
      .sort((a, b) => {
        if (sort === 'margin') return (a.grossMarginEur ?? Infinity) - (b.grossMarginEur ?? Infinity)
        if (sort === 'usage') return b.monthUsageCostEur - a.monthUsageCostEur
        if (sort === 'recent') return new Date(b.lastSeenAt ?? 0).getTime() - new Date(a.lastSeenAt ?? 0).getTime()
        return a.label.localeCompare(b.label, 'fr')
      })
  }, [data.clientRows, filter, query, sort])

  return (
    <main className="cockpit-shell">
      <header className="cockpit-header">
        <div><p className="cockpit-kicker">Relation client</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-primary sm:text-4xl">Clients</h1><p className="mt-3 text-sm leading-6 text-secondary">Retrouve chaque entreprise, son offre, sa consommation et les prochaines actions.</p></div>
        <Link href="/orsayn" className="cockpit-button cockpit-button-outline">Vue d’ensemble</Link>
      </header>

      <section className="cockpit-panel p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-lg font-semibold text-primary">Base clients</p><p className="mt-1 text-sm text-secondary">{data.clientRows.filter((row) => row.isActive && !row.isArchived).length} fiches actives · {data.clientRows.filter((row) => row.isArchived).length} archivées</p></div><button type="button" onClick={() => setShowAdd((value) => !value)} className="cockpit-button cockpit-button-dark"><Plus className="h-4 w-4" /> {showAdd ? 'Fermer' : 'Nouvelle fiche'}</button></div>
        {showAdd && <div className="mt-5 border-t border-[var(--cockpit-line)] pt-5"><AddClientForm /></div>}
      </section>

      <section className="cockpit-panel overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[var(--cockpit-line)] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <label className="relative block min-w-0 flex-1 sm:max-w-md"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary" /><input value={query} onChange={(event) => setQuery(event.target.value)} className={`${inputClass} pl-9`} placeholder="Rechercher un client…" /></label>
          <div className="flex flex-wrap items-center gap-2"><div className="flex flex-wrap rounded border border-[var(--cockpit-line)] p-0.5">{FILTERS.map(({ value, label }) => <button key={value} type="button" onClick={() => setFilter(value)} className={`px-3 py-1.5 text-xs font-medium ${filter === value ? 'bg-[rgb(var(--ink))] text-white' : 'text-secondary hover:text-primary'}`}>{label}</button>)}</div><label className="cockpit-sort-label" htmlFor="sort-clients">Trier par</label><select id="sort-clients" aria-label="Trier les clients" value={sort} onChange={(event) => setSort(event.target.value as Sort)} className="cockpit-input text-xs"><option value="name">Nom</option><option value="margin">Marge la plus faible</option><option value="usage">Consommation</option><option value="recent">Dernière activité</option></select></div>
        </div>
        <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm"><thead><tr className="border-b border-[var(--cockpit-line)]"><th className="cockpit-th">Client</th><th className="cockpit-th">Formule</th><th className="cockpit-th">Consommation</th><th className="cockpit-th">Marge</th><th className="cockpit-th">Configuration</th><th className="cockpit-th">Dernière activité</th><th className="cockpit-th"><span className="sr-only">Ouvrir</span></th></tr></thead><tbody>
          {rows.length === 0 ? <tr><td colSpan={7} className="py-12 text-center text-sm text-secondary">Aucun client ne correspond à ta recherche.</td></tr> : rows.map((row) => { const sync = getSyncBadge(row.lastSeenAt, row.lastStatus); return <tr key={`${row.sourceInstance}:${row.organizationId}`} className="border-b border-[var(--cockpit-line)] last:border-0 hover:bg-[var(--cockpit-paper)]"><td className="px-5 py-4"><Link href={clientPath(row.sourceInstance, row.organizationId)} className="group flex items-center gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--ink)/.08)] text-secondary"><UserRound className="h-4 w-4" /></span><span className="min-w-0"><span className="block truncate font-semibold text-primary group-hover:text-accent">{row.label}</span><span className="mt-0.5 block truncate text-xs text-secondary">{row.contactEmail ?? 'Aucun contact renseigné'}</span></span></Link></td><td className="px-5 py-4"><span className="block font-medium text-primary">{formatTier(row.tier)}</span><span className="mt-0.5 block text-xs text-secondary">{row.monthlyFee === null ? 'Forfait à compléter' : formatMoney(row.monthlyFee, row.billingCurrency)}</span></td><td className="px-5 py-4"><span className="block tabular-nums text-primary">{formatMoney(row.monthUsageCostEur)}</span><span className="mt-0.5 block text-xs text-secondary">{row.monthEventCount} appel{row.monthEventCount > 1 ? 's' : ''}</span></td><td className="px-5 py-4"><span className="block tabular-nums text-primary">{formatPercent(row.marginPct)}</span><span className="mt-0.5 block text-xs text-secondary">{row.grossMarginEur === null ? 'À compléter' : formatMoney(row.grossMarginEur)}</span></td><td className="px-5 py-4"><span className={`inline-flex items-center gap-1.5 text-xs font-medium ${sync.className}`}><CheckCircle2 className="h-3.5 w-3.5" />{row.isArchived ? 'Archivé' : formatSyncStatus(row.configSyncStatus)}</span></td><td className="px-5 py-4 text-xs text-secondary">{formatDate(row.lastSeenAt)}</td><td className="px-5 py-4 text-right"><Link href={clientPath(row.sourceInstance, row.organizationId)} className="text-xs font-semibold text-accent hover:underline">Ouvrir</Link></td></tr> })}
        </tbody></table></div>
      </section>

      {filter === 'archived' && <p className="flex items-center gap-2 text-xs text-secondary"><Archive className="h-3.5 w-3.5" />Les fiches archivées restent disponibles avec leur historique de consommation.</p>}
    </main>
  )
}
