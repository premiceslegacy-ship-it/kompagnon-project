import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { dateParis, todayParis } from '@/lib/utils'

const FOLLOW_UP_DELAY_DAYS = 2
const RECENT_ACTIVITY_DAYS = 7

export type NotificationsSummary = {
  total: number
  overdueInvoices: number
  invoiceFollowups: number
  expiringQuotes: number
  pendingQuotes: number
  pendingRecurring: number
  recentAutoReminders: number
  dueTasks: number
  planningToday: number
  missingPointages: number
  completedTasks: number
  newRequests: number
  decennaleExpiringDays: number | null
  chantiersAtRisk: number
}

export const EMPTY_NOTIFICATIONS: NotificationsSummary = {
  total: 0,
  overdueInvoices: 0,
  invoiceFollowups: 0,
  expiringQuotes: 0,
  pendingQuotes: 0,
  pendingRecurring: 0,
  recentAutoReminders: 0,
  dueTasks: 0,
  planningToday: 0,
  missingPointages: 0,
  completedTasks: 0,
  newRequests: 0,
  decennaleExpiringDays: null,
  chantiersAtRisk: 0,
}

export async function getNotificationsSummary(): Promise<NotificationsSummary> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return EMPTY_NOTIFICATIONS

  const now = Date.now()
  const today = todayParis()
  const yesterday = dateParis(now - 24 * 60 * 60 * 1000)
  const in3days = dateParis(now + 3 * 24 * 60 * 60 * 1000)
  const followUpCutoff = new Date(now - FOLLOW_UP_DELAY_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const recentActivityCutoff = new Date(now - RECENT_ACTIVITY_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const [
    { count: overdueInvoices },
    { count: invoiceFollowups },
    { count: expiringQuotes },
    { count: pendingQuotes },
    { count: pendingRecurring },
    { count: recentAutoReminders },
    { count: dueTasks },
    { count: planningToday },
    { count: completedTasks },
    { count: newRequests },
    { data: orgDecennale },
    { data: plannedSlots },
    { data: pointages },
    { data: activeChantiers },
  ] = await Promise.all([
    supabase
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('is_archived', false)
      .in('status', ['sent', 'partial'])
      .lt('due_date', today),
    supabase
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('is_archived', false)
      .in('status', ['sent', 'partial'])
      .is('due_date', null)
      .lt('sent_at', followUpCutoff),
    supabase
      .from('quotes')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .in('status', ['sent', 'viewed'])
      .gte('valid_until', today)
      .lte('valid_until', in3days),
    supabase
      .from('quotes')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('is_archived', false)
      .in('status', ['sent', 'viewed'])
      .lt('sent_at', followUpCutoff),
    supabase
      .from('invoice_schedules')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('status', 'pending_confirmation'),
    supabase
      .from('reminders')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('is_auto', true)
      .gte('sent_at', recentActivityCutoff),
    supabase
      .from('chantier_taches')
      .select('id, chantier:chantiers!inner(organization_id, is_archived, status)', { count: 'exact', head: true })
      .eq('chantier.organization_id', orgId)
      .eq('chantier.is_archived', false)
      .not('chantier.status', 'in', '("termine","annule")')
      .not('status', 'eq', 'termine')
      .not('due_date', 'is', null)
      .lte('due_date', today),
    supabase
      .from('chantier_plannings')
      .select('id, chantier:chantiers!inner(organization_id, is_archived, status)', { count: 'exact', head: true })
      .eq('chantier.organization_id', orgId)
      .eq('chantier.is_archived', false)
      .not('chantier.status', 'in', '("termine","annule")')
      .eq('planned_date', today),
    supabase
      .from('activity_log')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('action', 'chantier_task.completed')
      .gte('created_at', recentActivityCutoff),
    supabase
      .from('quote_requests')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('status', 'new'),
    supabase
      .from('organizations')
      .select('decennale_enabled, decennale_date_fin, default_labor_cost_per_hour, default_hourly_rate')
      .eq('id', orgId)
      .single(),
    supabase
      .from('chantier_plannings')
      .select('id, chantier_id, planned_date, member_id, equipe_id, chantier:chantiers!inner(organization_id, is_archived, status)')
      .eq('chantier.organization_id', orgId)
      .eq('chantier.is_archived', false)
      .not('chantier.status', 'in', '("termine","annule")')
      .gte('planned_date', yesterday)
      .lt('planned_date', today),
    supabase
      .from('chantier_pointages')
      .select('id, chantier_id, date, member_id')
      .gte('date', yesterday)
      .lt('date', today),
    supabase
      .from('chantiers')
      .select('id, budget_ht')
      .eq('organization_id', orgId)
      .eq('is_archived', false)
      .in('status', ['planifie', 'en_cours'])
      .gt('budget_ht', 0),
  ])

  const pointageKeys = new Set((pointages ?? []).map((p: any) => `${p.chantier_id}:${p.date}:${p.member_id ?? '*'}`))
  const pointageDayKeys = new Set((pointages ?? []).map((p: any) => `${p.chantier_id}:${p.date}`))
  const missingPointages = (plannedSlots ?? []).filter((slot: any) => {
    const directKey = `${slot.chantier_id}:${slot.planned_date}:${slot.member_id ?? '*'}`
    const dayKey = `${slot.chantier_id}:${slot.planned_date}`
    return !pointageKeys.has(directKey) && !pointageDayKeys.has(dayKey)
  }).length

  let chantiersAtRisk = 0
  const chantierIds = (activeChantiers ?? []).map(c => c.id)
  if (chantierIds.length > 0) {
    const [{ data: expenses }, { data: chantierPointages }] = await Promise.all([
      supabase
        .from('chantier_expenses')
        .select('chantier_id, amount_ht')
        .in('chantier_id', chantierIds),
      supabase
        .from('chantier_pointages')
        .select('chantier_id, hours, rate_snapshot')
        .in('chantier_id', chantierIds),
    ])

    const fallbackRate = orgDecennale?.default_labor_cost_per_hour
      ?? (orgDecennale?.default_hourly_rate ? orgDecennale.default_hourly_rate * 0.5 : 0)
    const costs: Record<string, number> = {}
    for (const exp of expenses ?? []) {
      costs[exp.chantier_id] = (costs[exp.chantier_id] ?? 0) + (exp.amount_ht ?? 0)
    }
    for (const p of chantierPointages ?? []) {
      costs[p.chantier_id] = (costs[p.chantier_id] ?? 0) + (p.hours ?? 0) * (p.rate_snapshot ?? fallbackRate)
    }
    chantiersAtRisk = (activeChantiers ?? []).filter(c => (costs[c.id] ?? 0) >= (c.budget_ht ?? 0) * 0.9).length
  }

  let decennaleExpiringDays: number | null = null
  if (orgDecennale?.decennale_enabled && orgDecennale?.decennale_date_fin) {
    const daysLeft = Math.ceil((new Date(orgDecennale.decennale_date_fin).getTime() - now) / 86400000)
    if (daysLeft <= 60) decennaleExpiringDays = daysLeft
  }

  const summary = {
    overdueInvoices: overdueInvoices ?? 0,
    invoiceFollowups: invoiceFollowups ?? 0,
    expiringQuotes: expiringQuotes ?? 0,
    pendingQuotes: pendingQuotes ?? 0,
    pendingRecurring: pendingRecurring ?? 0,
    recentAutoReminders: recentAutoReminders ?? 0,
    dueTasks: dueTasks ?? 0,
    planningToday: planningToday ?? 0,
    missingPointages,
    completedTasks: completedTasks ?? 0,
    newRequests: newRequests ?? 0,
    decennaleExpiringDays,
    chantiersAtRisk,
  }

  return {
    ...summary,
    total:
      summary.overdueInvoices +
      summary.invoiceFollowups +
      summary.pendingQuotes +
      summary.pendingRecurring +
      summary.recentAutoReminders +
      summary.dueTasks +
      summary.planningToday +
      summary.missingPointages +
      summary.completedTasks +
      summary.newRequests +
      summary.chantiersAtRisk,
  }
}
