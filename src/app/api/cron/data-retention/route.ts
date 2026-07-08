import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseRuntimeConfig } from '@/lib/supabase/config'
import { verifyCronSecret } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'

// ─── Recyclage des données ────────────────────────────────────────────────────
// Chaque client tourne sur un projet Supabase Free (500 Mo de base, pause après
// 7 jours sans requête). Ce cron quotidien fait deux choses :
//   1. Keep-alive : la requête quotidienne empêche la mise en pause du projet.
//   2. Purge des données techniques périmées (logs, propositions expirées,
//      briefs consommés) pour rester loin du plafond des 500 Mo.
// Aucune donnée métier (devis, factures, chantiers, clients, pointages) n'est
// touchée : uniquement des données jetables ou reconstructibles.

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString()
}

export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get('x-cron-secret'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { supabaseUrl } = getSupabaseRuntimeConfig()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const results: Record<string, number | string> = {}

  async function purge(label: string, run: () => PromiseLike<{ count?: number | null; error: { message: string } | null }>) {
    try {
      const { count, error } = await run()
      results[label] = error ? `error: ${error.message}` : count ?? 0
    } catch (err) {
      results[label] = `error: ${err instanceof Error ? err.message : 'unknown'}`
    }
  }

  // Propositions Sarah : marquer expirées, puis purger l'historique traité.
  await purge('sarah_proposals_expired', () =>
    admin.from('sarah_action_proposals')
      .update({ status: 'expired' }, { count: 'exact' })
      .eq('status', 'pending')
      .lt('expires_at', new Date().toISOString()))
  await purge('sarah_proposals_deleted', () =>
    admin.from('sarah_action_proposals')
      .delete({ count: 'exact' })
      .neq('status', 'pending')
      .lt('created_at', daysAgo(60)))

  // Briefs inter-assistants : consommés après 30 jours, tous après 90 jours.
  await purge('ai_briefs_consumed', () =>
    admin.from('ai_briefs')
      .delete({ count: 'exact' })
      .neq('status', 'pending')
      .lt('created_at', daysAgo(30)))
  await purge('ai_briefs_stale', () =>
    admin.from('ai_briefs')
      .delete({ count: 'exact' })
      .lt('created_at', daysAgo(90)))

  // Journal d'activité : 6 mois d'historique suffisent pour l'UI (feed dashboard/
  // notifications). Les actions sensibles (audit.*) sont exemptées de cette purge :
  // elles servent de piste d'audit (qui a supprimé/payé/changé un rôle), à conserver
  // durablement, pas seulement pour l'affichage court terme.
  await purge('activity_log', () =>
    admin.from('activity_log')
      .delete({ count: 'exact' })
      .not('action', 'like', 'audit.%')
      .lt('created_at', daysAgo(180)))

  // Logs d'envoi d'emails groupés : 6 mois.
  await purge('broadcast_logs', () =>
    admin.from('broadcast_logs')
      .delete({ count: 'exact' })
      .lt('created_at', daysAgo(180)))

  // Compteurs de rate limiting : fenêtres de plus de 2 jours.
  await purge('rate_limits', () =>
    admin.from('rate_limits')
      .delete({ count: 'exact' })
      .lt('window_start', daysAgo(2)))

  // Logs d'usage IA : on garde 13 mois pour la facturation annuelle.
  await purge('usage_logs', () =>
    admin.from('usage_logs')
      .delete({ count: 'exact' })
      .lt('created_at', daysAgo(400)))

  // Briefs du jour de Sarah : jetables après 3 semaines.
  await purge('daily_briefs', () =>
    admin.from('company_memory')
      .delete({ count: 'exact' })
      .eq('type', 'daily_brief')
      .lt('created_at', daysAgo(21)))

  // Souvenirs désactivés : purge définitive après 90 jours.
  await purge('inactive_memories', () =>
    admin.from('company_memory')
      .delete({ count: 'exact' })
      .eq('is_active', false)
      .lt('created_at', daysAgo(90)))

  // Jobs d'import terminés : 60 jours.
  await purge('import_jobs', () =>
    admin.from('import_jobs')
      .delete({ count: 'exact' })
      .lt('created_at', daysAgo(60)))

  // Historique WhatsApp : 6 mois de conversation suffisent à l'agent.
  await purge('whatsapp_messages', () =>
    admin.from('whatsapp_messages')
      .delete({ count: 'exact' })
      .lt('created_at', daysAgo(180)))

  // Note : pa_status_events est un audit trail légal immuable, jamais purgé.

  console.log('[cron/data-retention]', JSON.stringify(results))
  return NextResponse.json({ ok: true, results })
}
