import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { todayParis, dateParis } from '@/lib/utils'

const FOLLOW_UP_DELAY_DAYS = 2
const RECENT_ACTIVITY_DAYS = 7

export type UrgentItem = {
  id: string
  type:
    | 'overdue_invoice'
    | 'invoice_to_follow_up'
    | 'pending_quote'
    | 'pending_recurring'
    | 'balance_due'
    | 'installment_due'
    | 'recently_sent'
    | 'task_due'
    | 'planning_slot'
    | 'missing_pointage'
    | 'chantier_profitability'
    | 'task_completed'
  label: string
  subtype?: 'recurring_invoice' | 'auto_reminder_invoice' | 'auto_reminder_quote'
  title?: string | null
  amount: number | null
  date: string | null
  clientEmail: string | null
  clientName?: string | null
  invoiceId?: string | null
  recurringId?: string | null
  chantierId?: string | null
  rank?: number | null
}

export type DashboardStats = {
  caMois: number
  encaisseMois: number
  devisEnAttente: number
  facturesEnRetard: number
  urgentItems: UrgentItem[]
}

export type DashboardSetupReadiness = {
  organizationName: string | null
  companyIdentityReady: boolean
  documentDetailsReady: boolean
  paymentReady: boolean
  signatureReady: boolean
  catalogReady: boolean
  firstClientReady: boolean
  firstQuoteReady: boolean
  teamReady: boolean
  publicFormReady: boolean
  counts: {
    clients: number
    quotes: number
    catalogItems: number
    teamMembers: number
  }
}

function formatClientName(client: {
  company_name?: string | null
  contact_name?: string | null
  first_name?: string | null
  last_name?: string | null
}) {
  return client.company_name
    || client.contact_name
    || [client.first_name, client.last_name].filter(Boolean).join(' ')
    || null
}

export async function getDashboardStats(month?: string): Promise<DashboardStats> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()

  if (!orgId) {
    return { caMois: 0, encaisseMois: 0, devisEnAttente: 0, facturesEnRetard: 0, urgentItems: [] }
  }

  const now = new Date()
  // Si month est fourni (YYYY-MM), utiliser ce mois ; sinon le mois courant
  let year: number, mon: number
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    [year, mon] = month.split('-').map(Number)
    mon = mon - 1 // 0-indexed
  } else {
    year = now.getFullYear()
    mon = now.getMonth()
  }
  const firstOfMonth = new Date(year, mon, 1).toISOString()
  const firstOfNextMonth = new Date(year, mon + 1, 1).toISOString()
  const today = todayParis()
  const followUpCutoff = new Date(now.getTime() - FOLLOW_UP_DELAY_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const recentActivityCutoff = new Date(now.getTime() - RECENT_ACTIVITY_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const [
    { data: monthInvoices },
    { data: overdueInvoices },
    { data: pendingQuotes },
    { data: pendingSchedules },
    { data: pendingBalances },
    { data: installmentsDue },
    { data: recentAutoSent },
    { data: recentAutoReminders },
    { data: recentRemindersSent },
    { data: dueTasks },
    { data: todayPlanningSlots },
    { data: yesterdayPlanningSlots },
    { data: yesterdayPointages },
    { data: orgLabor },
    { data: activeChantiersForRisk },
    { data: recentCompletedTasks },
  ] = await Promise.all([
    // Factures du mois - filtre sur issue_date (date d'émission réelle, pas de création du brouillon)
    supabase
      .from('invoices')
      .select('total_ht, total_ttc, total_paid, status')
      .eq('organization_id', orgId)
      .gte('issue_date', firstOfMonth.split('T')[0])
      .lt('issue_date', firstOfNextMonth.split('T')[0])
      .in('status', ['sent', 'partial', 'paid']),

    // Factures à relancer : échéance dépassée, ou envoyées depuis 2 jours sans règlement.
    supabase
      .from('invoices')
      .select('id, number, title, total_ttc, due_date, sent_at, client_id')
      .eq('organization_id', orgId)
      .eq('is_archived', false)
      .in('status', ['sent', 'partial'])
      .or(`due_date.lt.${today},sent_at.lt.${followUpCutoff}`)
      .order('due_date')
      .limit(10),

    // Devis envoyés sans réponse depuis 2 jours.
    supabase
      .from('quotes')
      .select('id, number, title, total_ttc, sent_at, client_id')
      .eq('organization_id', orgId)
      .eq('is_archived', false)
      .in('status', ['sent', 'viewed'])
      .order('sent_at')
      .limit(100),

    // Brouillons récurrents en attente de confirmation avant envoi
    supabase
      .from('invoice_schedules')
      .select(`
        id, scheduled_date, invoice_id,
        recurring_invoice:recurring_invoices!inner(
          organization_id, title,
          client:clients(company_name, contact_name, first_name, last_name, email)
        )
      `)
      .eq('recurring_invoices.organization_id', orgId)
      .eq('status', 'pending_confirmation')
      .order('scheduled_date')
      .limit(5),

    // Acomptes versés dont le solde restant arrive à échéance dans les 7 prochains jours (ou déjà dépassé)
    supabase
      .from('invoices')
      .select('id, number, title, total_ttc, balance_due_date, client_id')
      .eq('organization_id', orgId)
      .eq('invoice_type', 'acompte')
      .in('status', ['sent', 'paid'])
      .not('balance_due_date', 'is', null)
      .lte('balance_due_date', dateParis(now.getTime() + 7 * 24 * 60 * 60 * 1000))
      .order('balance_due_date')
      .limit(5),

    // Échéances de paiement (plusieurs fois) non soldées dans les 7 prochains jours ou en retard
    supabase
      .from('invoice_payment_schedule')
      .select(`
        id, label, due_date, amount, invoice_id,
        invoice:invoices!inner(id, number, organization_id, status, client_id)
      `)
      .eq('invoices.organization_id', orgId)
      .is('paid_payment_id', null)
      .lte('due_date', dateParis(now.getTime() + 7 * 24 * 60 * 60 * 1000))
      .not('invoices.status', 'eq', 'cancelled')
      .order('due_date')
      .limit(5),

    // Factures récurrentes envoyées en auto dans les 7 derniers jours
    supabase
      .from('invoice_schedules')
      .select(`
        id, scheduled_date, amount_ht, confirmed_at,
        recurring_invoice:recurring_invoices(
          id, title,
          client:clients(company_name, contact_name, first_name, last_name, email)
        )
      `)
      .eq('organization_id', orgId)
      .eq('status', 'sent')
      .gte('confirmed_at', recentActivityCutoff)
      .order('confirmed_at', { ascending: false })
      .limit(5),

    // Relances automatiques (devis + factures) envoyées dans les 7 derniers jours
    supabase
      .from('reminders')
      .select(`
        id, sent_at, type, rank,
        invoice:invoices(id, title),
        quote:quotes(id, title),
        client:clients(company_name, contact_name, first_name, last_name, email)
      `)
      .eq('organization_id', orgId)
      .eq('is_auto', true)
      .gte('sent_at', recentActivityCutoff)
      .order('sent_at', { ascending: false })
      .limit(5),

    // Toutes les relances (manuelles + auto) envoyées dans les 48h — pour filtrer les factures/devis du dashboard
    supabase
      .from('reminders')
      .select('invoice_id, quote_id, sent_at')
      .eq('organization_id', orgId)
      .gte('sent_at', followUpCutoff),

    // Tâches arrivées à échéance
    supabase
      .from('chantier_taches')
      .select(`
        id, title, due_date,
        chantier:chantiers!inner(id, title, organization_id, is_archived, status)
      `)
      .eq('chantier.organization_id', orgId)
      .eq('chantier.is_archived', false)
      .not('chantier.status', 'in', '("termine","annule")')
      .not('status', 'eq', 'termine')
      .not('due_date', 'is', null)
      .lte('due_date', today)
      .order('due_date')
      .limit(5),

    // Créneaux chantier du jour
    supabase
      .from('chantier_plannings')
      .select(`
        id, chantier_id, planned_date, start_time, end_time, label,
        chantier:chantiers!inner(id, title, organization_id, is_archived, status)
      `)
      .eq('chantier.organization_id', orgId)
      .eq('chantier.is_archived', false)
      .not('chantier.status', 'in', '("termine","annule")')
      .eq('planned_date', today)
      .order('start_time', { ascending: true, nullsFirst: false })
      .limit(5),

    // Créneaux d'hier sans pointage associé
    supabase
      .from('chantier_plannings')
      .select(`
        id, chantier_id, planned_date, member_id, label,
        chantier:chantiers!inner(id, title, organization_id, is_archived, status)
      `)
      .eq('chantier.organization_id', orgId)
      .eq('chantier.is_archived', false)
      .not('chantier.status', 'in', '("termine","annule")')
      .eq('planned_date', dateParis(now.getTime() - 24 * 60 * 60 * 1000))
      .limit(5),

    supabase
      .from('chantier_pointages')
      .select('id, chantier_id, date, member_id')
      .eq('date', dateParis(now.getTime() - 24 * 60 * 60 * 1000)),

    supabase
      .from('organizations')
      .select('default_labor_cost_per_hour, default_hourly_rate')
      .eq('id', orgId)
      .single(),

    supabase
      .from('chantiers')
      .select('id, title, budget_ht')
      .eq('organization_id', orgId)
      .eq('is_archived', false)
      .in('status', ['planifie', 'en_cours'])
      .gt('budget_ht', 0)
      .limit(50),

    supabase
      .from('activity_log')
      .select('id, created_at, metadata')
      .eq('organization_id', orgId)
      .eq('action', 'chantier_task.completed')
      .gte('created_at', recentActivityCutoff)
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  // IDs des factures/devis déjà relancés dans les 48h — on les exclut des urgences
  const recentlyRemindedInvoiceIds = new Set(
    (recentRemindersSent ?? []).map(r => r.invoice_id).filter(Boolean)
  )
  const recentlyRemindedQuoteIds = new Set(
    (recentRemindersSent ?? []).map(r => r.quote_id).filter(Boolean)
  )

  // Charger les emails clients
  const clientIds = [
    ...new Set([
      ...(overdueInvoices ?? []).map(i => i.client_id).filter(Boolean),
      ...(pendingQuotes ?? []).map(q => q.client_id).filter(Boolean),
      ...(pendingBalances ?? []).map(i => i.client_id).filter(Boolean),
      ...(installmentsDue ?? []).map((s: any) => s.invoice?.client_id).filter(Boolean),
    ]),
  ] as string[]

  let clientMap: Record<string, { email: string | null; name: string | null }> = {}
  if (clientIds.length > 0) {
    const { data: clients } = await supabase
      .from('clients')
      .select('id, company_name, contact_name, first_name, last_name, email')
      .in('id', clientIds)
    clients?.forEach(c => {
      clientMap[c.id] = {
        email: c.email ?? null,
        name: formatClientName(c),
      }
    })
  }

  // Facturé TTC = toutes les factures émises ce mois (sent + partial + paid), en TTC.
  // L'encaissé réel reste affiché séparément dans le dashboard.
  const caMois = monthInvoices
    ?.reduce((sum, inv) => sum + (inv.total_ttc ?? 0), 0) ?? 0
  // Encaissé du mois = factures payées + montants déjà encaissés sur les factures partielles.
  const encaisseMois = monthInvoices
    ?.reduce((sum, inv) => {
      if (inv.status === 'paid') return sum + (inv.total_ttc ?? 0)
      if (inv.status === 'partial') return sum + (inv.total_paid ?? 0)
      return sum
    }, 0) ?? 0

  const devisEnAttente = pendingQuotes?.length ?? 0

  const staleQuotes = (pendingQuotes ?? [])
    .filter(q => q.sent_at && q.sent_at < followUpCutoff)
    .slice(0, 5)

  const riskChantierIds = (activeChantiersForRisk ?? []).map(c => c.id)
  let chantierRiskItems: UrgentItem[] = []
  if (riskChantierIds.length > 0) {
    const [{ data: expenses }, { data: chantierPointages }] = await Promise.all([
      supabase
        .from('chantier_expenses')
        .select('chantier_id, amount_ht')
        .in('chantier_id', riskChantierIds),
      supabase
        .from('chantier_pointages')
        .select('chantier_id, hours, rate_snapshot')
        .in('chantier_id', riskChantierIds),
    ])
    const fallbackRate = orgLabor?.default_labor_cost_per_hour
      ?? (orgLabor?.default_hourly_rate ? orgLabor.default_hourly_rate * 0.5 : 0)
    const costs: Record<string, number> = {}
    for (const exp of expenses ?? []) {
      costs[exp.chantier_id] = (costs[exp.chantier_id] ?? 0) + (exp.amount_ht ?? 0)
    }
    for (const p of chantierPointages ?? []) {
      costs[p.chantier_id] = (costs[p.chantier_id] ?? 0) + (p.hours ?? 0) * (p.rate_snapshot ?? fallbackRate)
    }
    chantierRiskItems = (activeChantiersForRisk ?? [])
      .filter(c => (costs[c.id] ?? 0) >= (c.budget_ht ?? 0) * 0.9)
      .slice(0, 5)
      .map(c => ({
        id: `chantier-risk-${c.id}`,
        type: 'chantier_profitability' as const,
        label: `Rentabilité à surveiller · ${Math.round(((costs[c.id] ?? 0) / (c.budget_ht ?? 1)) * 100)}% du budget`,
        title: c.title,
        amount: null,
        date: null,
        clientEmail: null,
        clientName: c.title,
        chantierId: c.id,
      }))
  }

  const urgentItems: UrgentItem[] = [
    ...(overdueInvoices ?? []).filter(inv => !recentlyRemindedInvoiceIds.has(inv.id)).map(inv => {
      const isOverdue = Boolean(inv.due_date && inv.due_date < today)
      return {
        id: inv.id,
        type: isOverdue ? 'overdue_invoice' as const : 'invoice_to_follow_up' as const,
        label: isOverdue ? `Facture ${inv.number ?? '-'} en retard` : `Facture ${inv.number ?? '-'} à relancer`,
        title: inv.title,
        amount: inv.total_ttc,
        date: isOverdue ? inv.due_date : inv.sent_at,
        clientEmail: inv.client_id ? (clientMap[inv.client_id]?.email ?? null) : null,
        clientName: inv.client_id ? (clientMap[inv.client_id]?.name ?? null) : null,
      }
    }),
    ...(pendingBalances ?? []).map(inv => ({
      id: `balance-${inv.id}`,
      type: 'balance_due' as const,
      label: `Solde à encaisser · ${inv.number ?? '-'}`,
      title: inv.title,
      amount: null,
      date: inv.balance_due_date,
      clientEmail: inv.client_id ? (clientMap[inv.client_id]?.email ?? null) : null,
      clientName: inv.client_id ? (clientMap[inv.client_id]?.name ?? null) : null,
      invoiceId: inv.id,
    })),
    ...(installmentsDue ?? []).map((s: any) => {
      const inv = s.invoice
      const clientId = inv?.client_id ?? null
      return {
        id: `installment-${s.id}`,
        type: 'installment_due' as const,
        label: `${s.label} · ${inv?.number ?? '-'}`,
        amount: s.amount,
        date: s.due_date,
        clientEmail: clientId ? (clientMap[clientId]?.email ?? null) : null,
        clientName: clientId ? (clientMap[clientId]?.name ?? null) : null,
        invoiceId: inv?.id ?? null,
      }
    }),
    ...staleQuotes.filter(q => !recentlyRemindedQuoteIds.has(q.id)).map(q => ({
      id: q.id,
      type: 'pending_quote' as const,
      label: `Devis ${q.number ?? '-'} sans réponse`,
      title: q.title,
      amount: q.total_ttc,
      date: q.sent_at,
      clientEmail: q.client_id ? (clientMap[q.client_id]?.email ?? null) : null,
      clientName: q.client_id ? (clientMap[q.client_id]?.name ?? null) : null,
    })),
    ...(pendingSchedules ?? []).map((s: any) => {
      const ri = s.recurring_invoice
      const client = ri?.client
      const cName = client?.company_name
        ?? [client?.first_name, client?.last_name].filter(Boolean).join(' ')
        ?? null
      return {
        id: s.id,
        type: 'pending_recurring' as const,
        label: ri?.title ?? 'Facture récurrente',
        subtype: 'recurring_invoice' as const,
        amount: null,
        date: s.scheduled_date,
        clientEmail: client?.email ?? null,
        invoiceId: s.invoice_id ?? null,
        recurringId: ri?.id ?? null,
        clientName: cName,
      }
    }),
    // Envois automatiques récents (7 derniers jours) - section "Confirmé automatiquement"
    ...(recentAutoSent ?? []).map((s: any) => {
      const ri = s.recurring_invoice
      const client = ri?.client
      const cName = client?.company_name
        ?? [client?.first_name, client?.last_name].filter(Boolean).join(' ')
        ?? null
      return {
        id: `autosent-${s.id}`,
        type: 'recently_sent' as const,
        label: ri?.title ?? 'Facture récurrente',
        subtype: 'recurring_invoice' as const,
        amount: s.amount_ht ?? null,
        date: s.confirmed_at ?? s.scheduled_date,
        clientEmail: client?.email ?? null,
        clientName: cName,
      }
    }),
    ...(recentAutoReminders ?? []).map((r: any) => {
      const isInvoice = r.type === 'payment_reminder' || r.type === 'overdue_notice'
      const doc = isInvoice ? r.invoice : r.quote
      const client = r.client
      const cName = client?.company_name
        ?? [client?.first_name, client?.last_name].filter(Boolean).join(' ')
        ?? null
      return {
        id: `autoremind-${r.id}`,
        type: 'recently_sent' as const,
        label: doc?.title ?? (isInvoice ? 'Facture' : 'Devis'),
        subtype: (isInvoice ? 'auto_reminder_invoice' : 'auto_reminder_quote') as 'auto_reminder_invoice' | 'auto_reminder_quote',
        amount: null,
        date: r.sent_at,
        clientEmail: client?.email ?? null,
        clientName: cName,
        rank: r.rank,
      }
    }),
    ...(recentCompletedTasks ?? []).map((log: any) => ({
      id: `task-completed-${log.id}`,
      type: 'task_completed' as const,
      label: `${log.metadata?.actor_name ?? 'Un membre'} a terminé : ${log.metadata?.task_title ?? 'Tâche'}`,
      title: log.metadata?.chantier_title ?? null,
      amount: null,
      date: log.created_at,
      clientEmail: null,
      clientName: log.metadata?.chantier_title ?? null,
      chantierId: log.metadata?.chantier_id ?? null,
    })),
    ...(dueTasks ?? []).map((t: any) => ({
      id: `task-${t.id}`,
      type: 'task_due' as const,
      label: `Tâche à faire · ${t.title}`,
      title: t.chantier?.title ?? null,
      amount: null,
      date: t.due_date,
      clientEmail: null,
      clientName: t.chantier?.title ?? null,
      chantierId: t.chantier?.id ?? null,
    })),
    ...(todayPlanningSlots ?? []).map((slot: any) => ({
      id: `planning-${slot.id}`,
      type: 'planning_slot' as const,
      label: slot.start_time ? `${slot.label} · ${slot.start_time.slice(0, 5)}` : slot.label,
      title: slot.chantier?.title ?? null,
      amount: null,
      date: slot.planned_date,
      clientEmail: null,
      clientName: slot.chantier?.title ?? null,
      chantierId: slot.chantier?.id ?? null,
    })),
    ...(yesterdayPlanningSlots ?? [])
      .filter((slot: any) => {
        const pointageKeys = new Set((yesterdayPointages ?? []).map((p: any) => `${p.chantier_id}:${p.date}:${p.member_id ?? '*'}`))
        const pointageDayKeys = new Set((yesterdayPointages ?? []).map((p: any) => `${p.chantier_id}:${p.date}`))
        const directKey = `${slot.chantier_id}:${slot.planned_date}:${slot.member_id ?? '*'}`
        const dayKey = `${slot.chantier_id}:${slot.planned_date}`
        return !pointageKeys.has(directKey) && !pointageDayKeys.has(dayKey)
      })
      .map((slot: any) => ({
        id: `missing-pointage-${slot.id}`,
        type: 'missing_pointage' as const,
        label: `Pointage à vérifier · ${slot.label}`,
        title: slot.chantier?.title ?? null,
        amount: null,
        date: slot.planned_date,
        clientEmail: null,
        clientName: slot.chantier?.title ?? null,
        chantierId: slot.chantier?.id ?? null,
      })),
    ...chantierRiskItems,
  ]

  return {
    caMois,
    encaisseMois,
    devisEnAttente,
    facturesEnRetard: (overdueInvoices ?? []).filter(inv => inv.due_date && inv.due_date < today).length,
    urgentItems,
  }
}

export async function getDashboardSetupReadiness(): Promise<DashboardSetupReadiness | null> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return null

  const [
    { data: org, error: orgError },
    { count: clientsCount },
    { count: quotesCount },
    { count: prestationCount },
    { count: materialsCount },
    { count: laborCount },
    { count: teamCount },
  ] = await Promise.all([
    supabase
      .from('organizations')
      .select(`
        name, email, business_activity_id, address_line1, postal_code, city,
        siret, vat_number, is_vat_subject, iban, bic, payment_terms_days,
        signatory_name, signatory_role, signature_image, public_form_enabled,
        setup_checklist_dismissed
      `)
      .eq('id', orgId)
      .single(),
    supabase
      .from('clients')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('is_archived', false),
    supabase
      .from('quotes')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('is_archived', false),
    supabase
      .from('prestation_types')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('is_active', true),
    supabase
      .from('materials')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('is_active', true),
    supabase
      .from('labor_rates')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('is_active', true),
    supabase
      .from('memberships')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('is_active', true),
  ])

  if (orgError || !org) {
    console.error('[getDashboardSetupReadiness]', orgError)
    return null
  }

  if (org.setup_checklist_dismissed) return null

  const catalogItems = (prestationCount ?? 0) + (materialsCount ?? 0) + (laborCount ?? 0)
  const isVatSubject = org.is_vat_subject !== false

  return {
    organizationName: org.name ?? null,
    companyIdentityReady: Boolean(org.name && org.email && org.business_activity_id),
    documentDetailsReady: Boolean(
      org.address_line1 &&
      org.postal_code &&
      org.city &&
      org.siret &&
      (!isVatSubject || org.vat_number)
    ),
    paymentReady: Boolean(org.iban && org.bic && org.payment_terms_days !== null),
    signatureReady: Boolean(org.signatory_name && org.signatory_role && org.signature_image),
    catalogReady: catalogItems > 0,
    firstClientReady: (clientsCount ?? 0) > 0,
    firstQuoteReady: (quotesCount ?? 0) > 0,
    teamReady: (teamCount ?? 0) > 1,
    publicFormReady: org.public_form_enabled === true,
    counts: {
      clients: clientsCount ?? 0,
      quotes: quotesCount ?? 0,
      catalogItems,
      teamMembers: teamCount ?? 0,
    },
  }
}

export async function getPrevMonthKPIs(month?: string): Promise<Pick<DashboardStats, 'caMois' | 'encaisseMois'>> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()

  if (!orgId) return { caMois: 0, encaisseMois: 0 }

  const now = new Date()
  let year: number, mon: number
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    ;[year, mon] = month.split('-').map(Number)
    mon = mon - 1
  } else {
    year = now.getFullYear()
    mon = now.getMonth()
  }
  const firstOfMonth = new Date(year, mon, 1).toISOString().split('T')[0]
  const firstOfNextMonth = new Date(year, mon + 1, 1).toISOString().split('T')[0]

  const { data: monthInvoices } = await supabase
    .from('invoices')
    .select('total_ttc, total_paid, status')
    .eq('organization_id', orgId)
    .gte('issue_date', firstOfMonth)
    .lt('issue_date', firstOfNextMonth)
    .in('status', ['sent', 'partial', 'paid'])

  const caMois = monthInvoices?.reduce((sum, inv) => sum + (inv.total_ttc ?? 0), 0) ?? 0
  const encaisseMois = monthInvoices?.reduce((sum, inv) => {
    if (inv.status === 'paid') return sum + (inv.total_ttc ?? 0)
    if (inv.status === 'partial') return sum + (inv.total_paid ?? 0)
    return sum
  }, 0) ?? 0

  return { caMois, encaisseMois }
}
