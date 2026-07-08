import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { hasPermission } from '@/lib/data/queries/membership'
import { dateParis, todayParis } from '@/lib/utils'
import { clientNameFromJoin } from '@/lib/client'

const FOLLOW_UP_DELAY_DAYS = 2
const RECENT_ACTIVITY_DAYS = 7

export type NotificationsSummary = {
  total: number
  overdueInvoices: number
  invoiceFollowups: number
  expiringQuotes: number
  pendingQuotes: number
  pendingRecurring: number
  recurringReady: number
  chantierPeriodDrafts: number
  recentAutoReminders: number
  dueTasks: number
  planningToday: number
  missingPointages: number
  completedTasks: number
  newRequests: number
  decennaleExpiringDays: number | null
  chantiersAtRisk: number
  maintenanceDue: number
  maintenanceBillingPending: number
  dailyBriefPending: boolean
  sarahAlertLines: string[]
}

export const EMPTY_NOTIFICATIONS: NotificationsSummary = {
  total: 0,
  overdueInvoices: 0,
  invoiceFollowups: 0,
  expiringQuotes: 0,
  pendingQuotes: 0,
  pendingRecurring: 0,
  recurringReady: 0,
  chantierPeriodDrafts: 0,
  recentAutoReminders: 0,
  dueTasks: 0,
  planningToday: 0,
  missingPointages: 0,
  completedTasks: 0,
  newRequests: 0,
  decennaleExpiringDays: null,
  chantiersAtRisk: 0,
  maintenanceDue: 0,
  maintenanceBillingPending: 0,
  dailyBriefPending: false,
  sarahAlertLines: [],
}

function formatHour(value: string | null | undefined): string | null {
  return value ? value.slice(0, 5) : null
}

function minutesFromTime(value: string | null | undefined): number | null {
  const hour = formatHour(value)
  if (!hour) return null
  const [h, m] = hour.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  return h * 60 + m
}

function formatDurationMinutes(minutes: number | null | undefined): string | null {
  if (!minutes || minutes <= 0) return null
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h > 0 && m > 0) return `${h} h ${m.toString().padStart(2, '0')}`
  if (h > 0) return `${h} h`
  return `${m} min`
}

function formatSlotHours(start: string | null | undefined, end: string | null | undefined, durationMin?: number | null): string {
  const startHour = formatHour(start)
  const endHour = formatHour(end)
  const computedDuration = startHour && endHour
    ? formatDurationMinutes((minutesFromTime(end) ?? 0) - (minutesFromTime(start) ?? 0))
    : null
  const duration = computedDuration ?? formatDurationMinutes(durationMin)
  const suffix = duration ? ` (${duration})` : ''
  if (startHour && endHour) return `de ${startHour} à ${endHour}${suffix}`
  if (startHour) return `à ${startHour}${suffix}`
  if (duration) return `durée prévue ${duration}`
  return 'horaire non renseigné'
}

function personName(row: { prenom?: string | null; name?: string | null } | null | undefined): string | null {
  const full = [row?.prenom, row?.name].filter(Boolean).join(' ').trim()
  return full || null
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
  const [canSeeInvoices, canSeeQuotes, canSeeReminders, canSeeChantiers, canSeeLeads, canUseAI] = await Promise.all([
    hasPermission('invoices.view'),
    hasPermission('quotes.view'),
    hasPermission('reminders.view'),
    hasPermission('chantiers.view'),
    hasPermission('leads.view'),
    hasPermission('ai.sarah'),
  ])

  const [
    { count: overdueInvoices },
    { count: invoiceFollowups },
    { count: expiringQuotes },
    { count: pendingQuotes },
    { count: pendingRecurring },
    { count: chantierPeriodDrafts },
    { count: recentAutoReminders },
    { count: dueTasks },
    { count: planningToday },
    { count: completedTasks },
    { count: newRequests },
    { data: orgDecennale },
    { data: todayPlanningDetails },
    { data: todayPointages },
    { data: equipesForPlanning },
    { data: membersForPlanning },
    { data: plannedSlots },
    { data: pointages },
    { data: activeChantiers },
    { data: maintenanceDueDetails },
    { data: dailyBriefRow },
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
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('is_archived', false)
      .eq('status', 'draft')
      .eq('generation_source', 'chantier_period'),
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
      .select('id, planned_date, start_time, end_time, duration_min, label, team_size, member_id, equipe_id, chantier:chantiers!inner(title, organization_id, is_archived, status, client:clients(company_name, first_name, last_name, contact_name))')
      .eq('chantier.organization_id', orgId)
      .eq('chantier.is_archived', false)
      .not('chantier.status', 'in', '("termine","annule")')
      .eq('planned_date', today)
      .order('start_time', { ascending: true, nullsFirst: false })
      .limit(5),
    supabase
      .from('chantier_pointages')
      .select('id, chantier_planning_id, chantier_id, date, member_id, user_id')
      .eq('date', today),
    supabase
      .from('chantier_equipes')
      .select('id, name, membres:chantier_equipe_membres(prenom, name)')
      .eq('organization_id', orgId)
      .limit(50),
    supabase
      .from('chantier_equipe_membres')
      .select('id, prenom, name')
      .eq('organization_id', orgId)
      .limit(200),
    supabase
      .from('chantier_plannings')
      .select('id, chantier_id, planned_date, start_time, end_time, label, team_size, member_id, equipe_id, chantier:chantiers!inner(title, organization_id, is_archived, status, client:clients(company_name, first_name, last_name, contact_name))')
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
    supabase
      .from('maintenance_interventions')
      .select(`
        id, date_intervention, start_time, end_time, duration_hours,
        intervenant:chantier_equipe_membres!maintenance_interventions_intervenant_member_id_fkey(prenom, name),
        intervenant_profile:profiles!maintenance_interventions_intervenant_user_id_fkey(full_name, email),
        contract:maintenance_contracts!inner(
          title, organization_id,
          chantier:chantiers!maintenance_contracts_chantier_id_fkey(title)
        )
      `)
      .eq('organization_id', orgId)
      .eq('statut', 'planifiée')
      .lte('date_intervention', today)
      .order('date_intervention', { ascending: true })
      .order('start_time', { ascending: true, nullsFirst: false })
      .limit(5),
    canUseAI
      ? supabase
          .from('company_memory')
          .select('id, metadata')
          .eq('organization_id', orgId)
          .eq('type', 'daily_brief')
          .eq('metadata->>date', today)
          .eq('is_active', true)
          .limit(1)
      : Promise.resolve({ data: null, error: null }),
  ])

  const pointageKeys = new Set((pointages ?? []).map((p: any) => `${p.chantier_id}:${p.date}:${p.member_id ?? '*'}`))
  const pointageDayKeys = new Set((pointages ?? []).map((p: any) => `${p.chantier_id}:${p.date}`))
  const missingPointageSlots = (plannedSlots ?? []).filter((slot: any) => {
    const directKey = `${slot.chantier_id}:${slot.planned_date}:${slot.member_id ?? '*'}`
    const dayKey = `${slot.chantier_id}:${slot.planned_date}`
    return !pointageKeys.has(directKey) && !pointageDayKeys.has(dayKey)
  })
  const missingPointages = missingPointageSlots.length

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

  const dailyBriefPending = canUseAI && Array.isArray(dailyBriefRow) && dailyBriefRow.length > 0
    ? dailyBriefRow[0].metadata?.read !== true
    : false

  let decennaleExpiringDays: number | null = null
  if (orgDecennale?.decennale_enabled && orgDecennale?.decennale_date_fin) {
    const daysLeft = Math.ceil((new Date(orgDecennale.decennale_date_fin).getTime() - now) / 86400000)
    if (daysLeft <= 60) decennaleExpiringDays = daysLeft
  }

  let recurringReady = 0
  if (canSeeInvoices) {
    const { data: recurringModels } = await supabase
      .from('recurring_invoices')
      .select('id, next_send_date, requires_confirmation, confirmation_delay_days')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .is('cancelled_at', null)

    const readyModels = (recurringModels ?? []).filter(model => {
      const nextDate = new Date(`${model.next_send_date}T00:00:00`)
      const triggerDate = new Date(nextDate)
      triggerDate.setDate(triggerDate.getDate() - (model.requires_confirmation ? model.confirmation_delay_days ?? 3 : 0))
      return triggerDate <= new Date(`${today}T00:00:00`)
    })

    if (readyModels.length > 0) {
      const { data: existingSchedules } = await supabase
        .from('invoice_schedules')
        .select('recurring_invoice_id, scheduled_date')
        .eq('organization_id', orgId)
        .in('recurring_invoice_id', readyModels.map(model => model.id))
        .in('status', ['pending_confirmation', 'confirmed', 'sent'])

      const existingKeys = new Set((existingSchedules ?? []).map(schedule => `${schedule.recurring_invoice_id}:${schedule.scheduled_date}`))
      recurringReady = readyModels.filter(model => !existingKeys.has(`${model.id}:${model.next_send_date}`)).length
    }
  }

  let maintenanceDue = 0
  let maintenanceBillingPending = 0
  if (canSeeChantiers) {
    const [{ count: dueCount }, { data: billingRows }] = await Promise.all([
      supabase
        .from('maintenance_interventions')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('statut', 'planifiée')
        .lte('date_intervention', today),
      supabase
        .from('maintenance_interventions')
        .select('id, billable_amount_ht, billable_notes')
        .eq('organization_id', orgId)
        .eq('statut', 'réalisée')
        .is('invoice_id', null),
    ])
    maintenanceDue = dueCount ?? 0
    maintenanceBillingPending = (billingRows ?? []).filter(row =>
      (row.billable_amount_ht ?? 0) > 0 || Boolean(row.billable_notes?.trim()),
    ).length
  }

  const equipeMembersById = new Map<string, string[]>()
  const equipeNameById = new Map<string, string>()
  for (const row of equipesForPlanning ?? []) {
    const eq = row as any
    if (eq.id && eq.name) equipeNameById.set(eq.id, eq.name)
    equipeMembersById.set(
      eq.id,
      (eq.membres ?? []).map((m: any) => personName(m)).filter(Boolean),
    )
  }

  const memberNameById = new Map<string, string>()
  for (const row of membersForPlanning ?? []) {
    const member = row as any
    const name = personName(member)
    if (member.id && name) memberNameById.set(member.id, name)
  }

  const todayPointagePlanningIds = new Set(
    (todayPointages ?? []).map((p: any) => p.chantier_planning_id).filter(Boolean),
  )
  const todayPointageKeys = new Set(
    (todayPointages ?? []).map((p: any) => `${p.chantier_id}:${p.date}:${p.member_id ?? p.user_id ?? '*'}`),
  )

  const filteredTodayPlanning = (todayPlanningDetails ?? []).filter((row: any) => {
    if (todayPointagePlanningIds.has(row.id)) return false
    const directKey = `${row.chantier_id}:${row.planned_date}:${row.member_id ?? '*'}` // fallback pour les pointages non liés
    const genericKey = `${row.chantier_id}:${row.planned_date}:*`
    return !todayPointageKeys.has(directKey) && !todayPointageKeys.has(genericKey)
  })

  const sarahAlertLines: string[] = []

  if (canSeeChantiers) {
    for (const slot of filteredTodayPlanning) {
      const row = slot as any
      const chantier = row.chantier as any
      const member = row.member_id ? memberNameById.get(row.member_id) ?? null : null
      const equipeMembers = row.equipe_id ? equipeMembersById.get(row.equipe_id) ?? [] : []
      const equipeName = row.equipe_id ? equipeNameById.get(row.equipe_id) ?? null : null
      const who = member
        ?? (equipeMembers.length ? equipeMembers.join(', ') : null)
        ?? (equipeName ? `l'équipe ${equipeName}` : null)
        ?? (row.team_size ? `${row.team_size} personne${row.team_size > 1 ? 's' : ''}` : null)
        ?? 'Intervenant non renseigné'
      const pluralSubject = !member && (equipeMembers.length > 1 || (row.team_size ?? 0) > 1)
      const verb = pluralSubject ? 'interviennent' : 'intervient'
      const chantierLabel = chantier?.title ? `sur le chantier "${chantier.title}"` : 'sur un chantier non renseigné'
      const clientOfChantier = clientNameFromJoin(chantier?.client)
      const clientLabel = clientOfChantier ? ` (${clientOfChantier})` : ''
      const label = row.label ? `, mission : ${row.label}` : ''
      sarahAlertLines.push(`${who} ${verb} aujourd'hui ${formatSlotHours(row.start_time, row.end_time, row.duration_min)} ${chantierLabel}${clientLabel}${label}.`)
    }

    for (const intervention of maintenanceDueDetails ?? []) {
      const row = intervention as any
      const contract = row.contract as any
      const member = personName(row.intervenant)
      const profileName = row.intervenant_profile?.full_name ?? row.intervenant_profile?.email ?? null
      const who = member ?? profileName ?? 'Intervenant non renseigné'
      const dateLabel = row.date_intervention === today ? "aujourd'hui" : `prévue le ${row.date_intervention}`
      const contractLabel = contract?.title ? `"${contract.title}"` : 'maintenance'
      const chantierLabel = contract?.chantier?.title ? ` sur le chantier "${contract.chantier.title}"` : ''
      sarahAlertLines.push(`${who} doit réaliser l'intervention ${contractLabel} ${dateLabel} ${formatSlotHours(row.start_time, row.end_time)}${chantierLabel}.`)
    }

    for (const slot of missingPointageSlots.slice(0, 3)) {
      const row = slot as any
      const chantier = row.chantier as any
      const member = row.member_id ? memberNameById.get(row.member_id) ?? null : null
      const equipeMembers = row.equipe_id ? equipeMembersById.get(row.equipe_id) ?? [] : []
      const equipeName = row.equipe_id ? equipeNameById.get(row.equipe_id) ?? null : null
      const who = member
        ?? (equipeMembers.length ? equipeMembers.join(', ') : null)
        ?? (equipeName ? `l'équipe ${equipeName}` : null)
        ?? (row.label?.trim() ? row.label.trim() : null)
        ?? (row.team_size ? `${row.team_size} personne${row.team_size > 1 ? 's' : ''}` : null)
        ?? 'Intervenant non renseigné'
      const chantierLabel = chantier?.title ? `sur le chantier "${chantier.title}"` : 'sur un chantier non renseigné'
      const clientOfChantier = clientNameFromJoin(chantier?.client)
      const clientLabel = clientOfChantier ? ` (${clientOfChantier})` : ''
      const dateLabel = row.planned_date === yesterday ? 'hier' : `le ${row.planned_date}`
      sarahAlertLines.push(`Pointage à vérifier : ${who} était prévu ${dateLabel} ${formatSlotHours(row.start_time, row.end_time)} ${chantierLabel}${clientLabel}.`)
    }
    if (missingPointageSlots.length > 3) {
      sarahAlertLines.push(`${missingPointageSlots.length - 3} autre${missingPointageSlots.length - 3 > 1 ? 's' : ''} pointage${missingPointageSlots.length - 3 > 1 ? 's' : ''} à vérifier.`)
    }
  }

  if (canSeeInvoices && (overdueInvoices ?? 0) > 0) sarahAlertLines.push(`${overdueInvoices} facture${(overdueInvoices ?? 0) > 1 ? 's' : ''} en retard de paiement.`)
  if (canSeeInvoices && canSeeReminders && (invoiceFollowups ?? 0) > 0) sarahAlertLines.push(`${invoiceFollowups} facture${(invoiceFollowups ?? 0) > 1 ? 's' : ''} sans échéance à relancer.`)
  if (canSeeQuotes && canSeeReminders && (pendingQuotes ?? 0) > 0) sarahAlertLines.push(`${pendingQuotes} devis à relancer.`)
  if (canSeeInvoices && (pendingRecurring ?? 0) > 0) sarahAlertLines.push(`${pendingRecurring} facture${(pendingRecurring ?? 0) > 1 ? 's récurrentes' : ' récurrente'} à confirmer.`)
  if (recurringReady > 0) sarahAlertLines.push(`${recurringReady} facture${recurringReady > 1 ? 's récurrentes' : ' récurrente'} prête à préparer.`)
  if (canSeeInvoices && (chantierPeriodDrafts ?? 0) > 0) sarahAlertLines.push(`${chantierPeriodDrafts} facture${(chantierPeriodDrafts ?? 0) > 1 ? 's' : ''} de chantier à valider.`)
  if (canSeeReminders && (recentAutoReminders ?? 0) > 0) sarahAlertLines.push(`${recentAutoReminders} relance${(recentAutoReminders ?? 0) > 1 ? 's automatiques envoyées' : ' automatique envoyée'} récemment.`)
  if (canSeeChantiers && (dueTasks ?? 0) > 0) sarahAlertLines.push(`${dueTasks} tâche${(dueTasks ?? 0) > 1 ? 's chantier' : ' chantier'} à échéance.`)
  if (canSeeChantiers && (completedTasks ?? 0) > 0) sarahAlertLines.push(`${completedTasks} tâche${(completedTasks ?? 0) > 1 ? 's chantier terminées' : ' chantier terminée'} récemment.`)
  if (canSeeLeads && (newRequests ?? 0) > 0) sarahAlertLines.push(`${newRequests} nouvelle${(newRequests ?? 0) > 1 ? 's demandes' : ' demande'} de devis à traiter.`)
  if (canSeeChantiers && chantiersAtRisk > 0) sarahAlertLines.push(`${chantiersAtRisk} chantier${chantiersAtRisk > 1 ? 's' : ''} en alerte budget.`)
  if (maintenanceBillingPending > 0) sarahAlertLines.push(`${maintenanceBillingPending} intervention${maintenanceBillingPending > 1 ? 's maintenance' : ' maintenance'} à facturer.`)
  if (dailyBriefPending) sarahAlertLines.push('Le brief du jour est disponible.')

  const summary = {
    overdueInvoices: canSeeInvoices ? overdueInvoices ?? 0 : 0,
    invoiceFollowups: canSeeInvoices && canSeeReminders ? invoiceFollowups ?? 0 : 0,
    expiringQuotes: canSeeQuotes ? expiringQuotes ?? 0 : 0,
    pendingQuotes: canSeeQuotes && canSeeReminders ? pendingQuotes ?? 0 : 0,
    pendingRecurring: canSeeInvoices ? pendingRecurring ?? 0 : 0,
    recurringReady,
    chantierPeriodDrafts: canSeeInvoices ? chantierPeriodDrafts ?? 0 : 0,
    recentAutoReminders: canSeeReminders ? recentAutoReminders ?? 0 : 0,
    dueTasks: canSeeChantiers ? dueTasks ?? 0 : 0,
    planningToday: canSeeChantiers ? filteredTodayPlanning.length : 0,
    missingPointages: canSeeChantiers ? missingPointages : 0,
    completedTasks: canSeeChantiers ? completedTasks ?? 0 : 0,
    newRequests: canSeeLeads ? newRequests ?? 0 : 0,
    decennaleExpiringDays,
    chantiersAtRisk: canSeeChantiers ? chantiersAtRisk : 0,
    maintenanceDue,
    maintenanceBillingPending,
    dailyBriefPending,
    sarahAlertLines,
  }

  return {
    ...summary,
    total:
      summary.overdueInvoices +
      summary.invoiceFollowups +
      summary.pendingQuotes +
      summary.pendingRecurring +
      summary.recurringReady +
      summary.chantierPeriodDrafts +
      summary.dueTasks +
      summary.planningToday +
      summary.missingPointages +
      summary.newRequests +
      summary.chantiersAtRisk +
      summary.maintenanceDue +
      summary.maintenanceBillingPending +
      (summary.dailyBriefPending ? 1 : 0),
  }
}
