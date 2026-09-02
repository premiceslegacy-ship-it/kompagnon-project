// Variante cache-compatible des requêtes dashboard (getDashboardStats et
// consorts dans dashboard.ts). unstable_cache interdit tout accès à
// cookies()/headers() DANS la fonction cachée : orgId doit donc être résolu
// AVANT d'entrer dans le cache, et les requêtes utilisent le client admin
// (service role, sans session) plutôt que le client de session.
//
// Zéro logique métier dupliquée : les fonctions de dashboard.ts sont
// réutilisées telles quelles via le paramètre `deps` (client + orgId
// injectés), donc aucun risque de divergence entre une version "normale" et
// une version "cache" qui dériveraient l'une de l'autre avec le temps.
//
// TTL 60s : les KPI du dashboard tolèrent une minute de latence. Pas
// d'invalidation par tag depuis les mutations en v1 — à ajouter seulement si
// 60s s'avère insuffisant en usage réel (voir docs/perf-dashboard-cache-kv.md).
import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getDashboardStats, getDashboardSetupReadiness, getPrevMonthKPIs, type DashboardStats, type DashboardSetupReadiness } from './dashboard'

const REVALIDATE_SECONDS = 60

const cachedGetDashboardStats = unstable_cache(
  async (orgId: string, month: string): Promise<DashboardStats> =>
    getDashboardStats(month, { client: createAdminClient(), orgId }),
  ['dashboard-stats-v1'],
  { revalidate: REVALIDATE_SECONDS },
)

const cachedGetPrevMonthKPIs = unstable_cache(
  async (orgId: string, month: string): Promise<Pick<DashboardStats, 'caMois' | 'encaisseMois'>> =>
    getPrevMonthKPIs(month, { client: createAdminClient(), orgId }),
  ['dashboard-prev-kpis-v1'],
  { revalidate: REVALIDATE_SECONDS },
)

const cachedGetDashboardSetupReadiness = unstable_cache(
  async (orgId: string): Promise<DashboardSetupReadiness | null> =>
    getDashboardSetupReadiness({ client: createAdminClient(), orgId }),
  ['dashboard-setup-readiness-v1'],
  { revalidate: REVALIDATE_SECONDS },
)

/**
 * orgId doit être résolu par l'appelant (getCurrentOrganizationId(), hors
 * cache) avant ces appels — jamais depuis l'intérieur d'une fonction cachée.
 * La clé de cache Next inclut automatiquement les arguments passés à la
 * fonction enveloppée (orgId, month), donc pas de fuite entre organisations :
 * chaque org a sa propre entrée de cache.
 */
export function getDashboardStatsCached(orgId: string, month: string): Promise<DashboardStats> {
  return cachedGetDashboardStats(orgId, month)
}

export function getPrevMonthKPIsCached(orgId: string, month: string): Promise<Pick<DashboardStats, 'caMois' | 'encaisseMois'>> {
  return cachedGetPrevMonthKPIs(orgId, month)
}

export function getDashboardSetupReadinessCached(orgId: string): Promise<DashboardSetupReadiness | null> {
  return cachedGetDashboardSetupReadiness(orgId)
}
