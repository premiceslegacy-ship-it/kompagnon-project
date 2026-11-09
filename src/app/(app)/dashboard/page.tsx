// @atelier-migrated
import { getCurrentUserProfile } from '@/lib/data/queries/user';
import type { DashboardStats } from '@/lib/data/queries/dashboard';
import { getBillingTrendCached, getDashboardStatsCached, getPrevMonthKPIsCached, getDashboardSetupReadinessCached } from '@/lib/data/queries/dashboard-cached';
import type { MonthBilling } from '@/lib/data/queries/dashboard';
import { getCurrentOrganizationId } from '@/lib/data/queries/clients';
import { getChantierStats } from '@/lib/data/queries/chantiers';
import { getOrganizationModules } from '@/lib/data/queries/organization-modules';
import { getCurrentMembershipContext, getUserPermissions } from '@/lib/data/queries/membership';
import { getCollaborateurDashboard, getTodayPlanningDigest } from '@/lib/data/queries/dashboard-collaborateur';
import { getMemberGoalsWithProgress } from '@/lib/data/queries/member-goals';
import { Sparkline } from '@/components/ui/Sparkline';
import { SplitBar } from '@/components/ui/SplitBar';
import UrgentTasksClient from './UrgentTasksClient';
import MonthNav from './MonthNav';
import MaSemaineWidget from './MaSemaineWidget';
import CollaborateurDashboard from './CollaborateurDashboard';
import PlanningDigestWidget from './PlanningDigestWidget';
import SetupChecklist from './SetupChecklist';
import TodayHeader from './TodayHeader';
import styles from '@/components/layout/Screen.module.css';
import figures from './DashboardFigures.module.css';

const NB = '\u00a0'

const fmt = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)

function todayKicker(): string {
  const label = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' }).format(new Date())
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/** Évolution par rapport au mois précédent, sans inventer de chute quand le mois commence. */
function Delta({ current, prev }: { current: number; prev: number }) {
  if (prev === 0 && current === 0) return null
  if (prev === 0) return <span className={styles.up}>Nouveau ce mois-ci</span>
  if (current === 0) return <>Pas encore de donnée ce mois-ci</>
  const pct = Math.round(((current - prev) / prev) * 100)
  if (pct === 0) return <>Comme le mois précédent</>
  return (
    <>
      <span className={pct > 0 ? styles.up : styles.down}>{pct > 0 ? '+' : '−'}{Math.abs(pct)}{NB}%</span> vs mois précédent
    </>
  )
}

function Figures({
  stats, prevStats, chantiersEnCours, month, trend,
}: {
  stats: DashboardStats
  prevStats: Pick<DashboardStats, 'caMois' | 'encaisseMois'>
  chantiersEnCours: number
  month: string
  trend: MonthBilling[]
}) {
  const due = Math.max(0, stats.caMois - stats.encaisseMois)
  const series = trend.map(t => t.caMois)
  const showTrend = series.length >= 2 && series.some(v => v > 0)
  return (
    <>
      <MonthNav currentMonth={month} />
      <section className={`${styles.card} ${styles.hero}`} aria-labelledby="today-billed">
        <div className={styles.label}><span id="today-billed">Facturé TTC</span></div>
        <div className={figures.heroRow}>
          <div className={styles.big}>{fmt(stats.caMois)}</div>
          {showTrend && (
            <Sparkline
              className={figures.trend}
              values={series}
              label={`Facturé sur les ${series.length} derniers mois, de ${fmt(series[0])} à ${fmt(series[series.length - 1])}`}
            />
          )}
        </div>
        <div className={styles.sub}><Delta current={stats.caMois} prev={prevStats.caMois} /></div>
        {stats.caMois > 0 && (
          <SplitBar
            className={figures.split}
            label="Encaissement des factures du mois"
            segments={[
              { key: 'paid', label: 'Encaissé', value: stats.encaisseMois, tone: 'success', display: fmt(stats.encaisseMois) },
              { key: 'due', label: 'À encaisser', value: due, tone: 'accent', display: fmt(due) },
            ]}
          />
        )}
      </section>
      <div className={styles.duo}>
        <section className={styles.card} aria-labelledby="today-pending">
          <div className={styles.label}><span id="today-pending">Devis en attente</span></div>
          <div className={styles.big}>{stats.devisEnAttente}</div>
          <div className={styles.sub}>{stats.devisEnAttente === 0 ? 'Aucun en attente' : 'En attente de réponse'}</div>
        </section>
        <section className={styles.card} aria-labelledby="today-sites">
          <div className={styles.label}><span id="today-sites">Chantiers en cours</span></div>
          <div className={styles.big}>{chantiersEnCours}</div>
          <div className={styles.sub}>{chantiersEnCours === 0 ? 'Aucun chantier actif' : 'Sur le terrain'}</div>
        </section>
      </div>
    </>
  )
}

const SENT_TYPES = new Set(['recently_sent', 'task_completed'])

function getCurrentMonthYM(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function prevMonthYM(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Rôles qui voient un dashboard personnalisé (pas le dashboard CA). */
const COLLAB_ROLES = new Set(['employee', 'collaborateur', 'viewer'])

export default async function DashboardPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ mois?: string }>
}) {
  const searchParams = await searchParamsPromise
  const selectedMonth = (searchParams?.mois && /^\d{4}-\d{2}$/.test(searchParams.mois))
    ? searchParams.mois
    : getCurrentMonthYM()
  const previousMonth = prevMonthYM(selectedMonth)

  const [profile, membership, perms] = await Promise.all([
    getCurrentUserProfile(),
    getCurrentMembershipContext(),
    getUserPermissions(),
  ])

  const firstName = profile?.full_name?.split(' ')[0] ?? null
  const roleSlug = membership?.roleSlug ?? null
  const isCollabView = roleSlug !== null && COLLAB_ROLES.has(roleSlug)
  const canViewCA = perms.has('*') || perms.has('dashboard.view_ca')

  // ─── Dashboard collaborateur ────────────────────────────────────────────────
  if (isCollabView && profile?.id) {
    const now = new Date()
    const collabData = await getCollaborateurDashboard(profile.id)
    // Cherche les objectifs par fiche intervenant si liée, sinon par membership
    const realGoals = (collabData.memberId || membership?.membershipId)
        ? await getMemberGoalsWithProgress({
            memberId: collabData.memberId ?? undefined,
            membershipId: membership?.membershipId ?? undefined,
            userId: membership?.userId ?? undefined,
            year: now.getFullYear(),
            month: now.getMonth() + 1,
          })
      : []

    return (
      <main className={styles.root}>
        <div className={styles.page}>
          <TodayHeader kicker={todayKicker()} title={firstName ? `Bonjour ${firstName}` : 'Bonjour'} />
          <CollaborateurDashboard data={collabData} goals={realGoals} firstName={firstName} />
        </div>
      </main>
    )
  }

  // ─── Dashboard owner / admin / manager / commercial ────────────────────────
  // orgId résolu ici (hors cache) puis injecté dans les variantes cache-compatibles
  // (client admin + TTL 60s sur le KV OpenNext déjà provisionné) : endpoint le
  // plus lourd du dashboard (confirmé par test de charge, p95 ~10s sans cache).
  const orgId = await getCurrentOrganizationId();
  const [stats, prevStats, chantierStats, modules, todaySlots, setupReadiness, billingTrend] = await Promise.all([
    orgId ? getDashboardStatsCached(orgId, selectedMonth) : Promise.resolve({ caMois: 0, encaisseMois: 0, devisEnAttente: 0, facturesEnRetard: 0, urgentItems: [] }),
    orgId ? getPrevMonthKPIsCached(orgId, previousMonth) : Promise.resolve({ caMois: 0, encaisseMois: 0 }),
    getChantierStats(),
    getOrganizationModules(),
    getTodayPlanningDigest(),
    roleSlug === 'owner' && orgId ? getDashboardSetupReadinessCached(orgId) : Promise.resolve(null),
    canViewCA && orgId ? getBillingTrendCached(orgId, selectedMonth) : Promise.resolve([] as MonthBilling[]),
  ])

  const toFollow = stats.urgentItems.filter(item => !SENT_TYPES.has(item.type)).length
  const title = toFollow === 0
    ? 'Tout est à jour'
    : `${toFollow} point${toFollow > 1 ? 's' : ''} à suivre`

  return (
    <main className={styles.root}>
      <div className={styles.page}>
        <TodayHeader kicker={todayKicker()} title={title} />
        <div className={styles.cols}>
          <div>
            <UrgentTasksClient initialItems={stats.urgentItems} facturesEnRetard={stats.facturesEnRetard} quoteAiEnabled={modules.quote_ai} />
            <PlanningDigestWidget slots={todaySlots} />
          </div>
          <div className={styles.side}>
            <SetupChecklist readiness={setupReadiness} />
            {canViewCA ? (
              <Figures stats={stats} prevStats={prevStats} chantiersEnCours={chantierStats.enCours} month={selectedMonth} trend={billingTrend} />
            ) : null}
            {modules.planning_ai ? <MaSemaineWidget /> : null}
          </div>
        </div>
      </div>
    </main>
  )
}
