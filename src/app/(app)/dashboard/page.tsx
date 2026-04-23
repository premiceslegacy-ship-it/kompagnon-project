import React from 'react';
import Link from 'next/link';
import { getCurrentUserProfile } from '@/lib/data/queries/user';
import { getDashboardStats } from '@/lib/data/queries/dashboard';
import type { DashboardStats } from '@/lib/data/queries/dashboard';
import {
  FileText, UserPlus,
  Wallet, Receipt, TrendingUp, HardHat,
  TrendingDown,
} from 'lucide-react';
import { getChantierStats } from '@/lib/data/queries/chantiers';
import { getOrganizationModules } from '@/lib/data/queries/organization-modules';
import UrgentTasksClient from './UrgentTasksClient';
import MonthNav from './MonthNav';
import MaSemaineWidget from './MaSemaineWidget';

const cardCls = "rounded-3xl p-6 bg-surface shadow-kompagnon dark:bg-surface/2 dark:backdrop-blur-glass border border-[var(--elevation-border)] transition-all duration-300 ease-out";

const fmt = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)

function Delta({ current, prev }: { current: number; prev: number }) {
  if (prev === 0 && current === 0) return null
  if (prev === 0) return <span className="text-xs font-semibold text-accent-green">Nouveau</span>
  const pct = Math.round(((current - prev) / prev) * 100)
  if (pct === 0) return <span className="text-xs text-secondary">= mois préc.</span>
  const up = pct > 0
  return (
    <span className={`text-xs font-semibold flex items-center gap-0.5 ${up ? 'text-accent-green' : 'text-red-500'}`}>
      {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {up ? '+' : ''}{pct}% vs mois préc.
    </span>
  )
}

const KPIRow = ({
  stats, prevStats, chantiersEnCours,
}: {
  stats: DashboardStats
  prevStats: DashboardStats
  chantiersEnCours: number
}) => (
  <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
    <div className={`${cardCls} flex flex-col justify-between`}>
      <div className="flex justify-between items-start">
        <p className="text-sm font-semibold text-secondary tracking-wider uppercase">CA du mois HT</p>
        <Wallet className="w-4 h-4 text-accent" />
      </div>
      <p className="text-3xl font-bold text-primary tabular-nums mt-4">
        {stats.caMois > 0 ? fmt(stats.caMois) : '-'}
      </p>
      <div className="mt-2">
        <Delta current={stats.caMois} prev={prevStats.caMois} />
      </div>
    </div>

    <div className={`${cardCls} flex flex-col justify-between`}>
      <div className="flex justify-between items-start">
        <p className="text-sm font-semibold text-secondary tracking-wider uppercase">Encaissé</p>
        <Receipt className="w-4 h-4 text-accent-green" />
      </div>
      <p className="text-3xl font-bold text-primary tabular-nums mt-4">
        {stats.encaisseMois > 0 ? fmt(stats.encaisseMois) : '-'}
      </p>
      <div className="mt-2">
        <Delta current={stats.encaisseMois} prev={prevStats.encaisseMois} />
      </div>
    </div>

    <div className={`${cardCls} flex flex-col justify-between`}>
      <div className="flex justify-between items-start">
        <p className="text-sm font-semibold text-secondary tracking-wider uppercase">Devis en attente</p>
        <TrendingUp className="w-4 h-4 text-blue-500" />
      </div>
      {stats.devisEnAttente > 0 ? (
        <p className="text-3xl font-bold text-primary tabular-nums mt-4">{stats.devisEnAttente}</p>
      ) : (
        <p className="text-sm text-secondary mt-4">Aucun devis en attente de réponse.</p>
      )}
    </div>

    <div className={`${cardCls} flex flex-col justify-between`}>
      <div className="flex justify-between items-start">
        <p className="text-sm font-semibold text-secondary tracking-wider uppercase">Chantiers en cours</p>
        <HardHat className="w-4 h-4 text-amber-500" />
      </div>
      {chantiersEnCours > 0 ? (
        <p className="text-3xl font-bold text-primary tabular-nums mt-4">{chantiersEnCours}</p>
      ) : (
        <p className="text-sm text-secondary mt-4">Aucun chantier actif.</p>
      )}
    </div>
  </div>
);


const QuickActions = () => (
  <div className={`${cardCls} p-8 flex flex-col`}>
    <h3 className="text-xl font-bold text-primary mb-6">Actions Rapides</h3>
    <div className="flex flex-col gap-4">
      <Link
        href="/finances/quote-editor"
        className="w-full py-4 rounded-pill bg-accent text-black font-bold text-lg flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-95 transition-all duration-300 ease-out shadow-lg shadow-accent/20"
      >
        <FileText className="w-5 h-5" />
        Nouveau Devis
      </Link>
      <Link
        href="/clients"
        className="w-full py-4 bg-[rgb(var(--accent-navy))] text-inverse dark:bg-white/10 dark:text-white font-bold text-lg rounded-pill flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-95 transition-all duration-300 ease-out shadow-lg border border-[var(--elevation-border)]"
      >
        <UserPlus className="w-5 h-5" />
        Nouveau Client
      </Link>
    </div>
  </div>
);


function getCurrentMonthYM(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function prevMonthYM(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: { mois?: string }
}) {
  const selectedMonth = (searchParams?.mois && /^\d{4}-\d{2}$/.test(searchParams.mois))
    ? searchParams.mois
    : getCurrentMonthYM()
  const previousMonth = prevMonthYM(selectedMonth)

  const [profile, stats, prevStats, chantierStats, modules] = await Promise.all([
    getCurrentUserProfile(),
    getDashboardStats(selectedMonth),
    getDashboardStats(previousMonth),
    getChantierStats(),
    getOrganizationModules(),
  ]);

  const firstName = profile?.full_name?.split(' ')[0] ?? null;
  const greeting = profile?.onboarding_done ? 'Bon retour,' : 'Bienvenue,';

  return (
    <main className="flex-1 p-8 max-w-[1400px] mx-auto w-full space-y-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-4xl tracking-tight text-primary">
            <span className="font-normal">{greeting} </span>
            <span className="font-bold">{firstName ?? 'dans ATELIER'}</span>
          </h1>
          <p className="text-secondary text-lg">Voici un résumé de votre activité.</p>
        </div>
        <MonthNav currentMonth={selectedMonth} />
      </div>

      <KPIRow stats={stats} prevStats={prevStats} chantiersEnCours={chantierStats.enCours} />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8">
          <UrgentTasksClient initialItems={stats.urgentItems} facturesEnRetard={stats.facturesEnRetard} quoteAiEnabled={modules.quote_ai} />
        </div>
        <div className="lg:col-span-4 flex flex-col">
          <QuickActions />
          <div className="mt-8">
            {modules.planning_ai ? <MaSemaineWidget /> : null}
          </div>
        </div>
      </div>
    </main>
  );
}
