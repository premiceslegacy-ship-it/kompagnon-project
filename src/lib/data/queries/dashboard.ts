import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { todayParis, dateParis } from '@/lib/utils'

export type UrgentItem = {
  id: string
  type: 'overdue_invoice' | 'pending_quote' | 'pending_recurring' | 'balance_due' | 'recently_sent'
  label: string
  subtype?: 'recurring_invoice' | 'auto_reminder_invoice' | 'auto_reminder_quote'
  amount: number | null
  date: string | null
  clientEmail: string | null
  clientName?: string | null
  invoiceId?: string | null
  recurringId?: string | null
  rank?: number | null
}

export type DashboardStats = {
  caMois: number
  encaisseMois: number
  devisEnAttente: number
  facturesEnRetard: number
  urgentItems: UrgentItem[]
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
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const [
    { data: monthInvoices },
    { data: overdueInvoices },
    { data: pendingQuotes },
    { data: pendingSchedules },
    { data: pendingBalances },
    { data: recentAutoSent },
    { data: recentAutoReminders },
  ] = await Promise.all([
    // Factures du mois — filtre sur issue_date (date d'émission réelle, pas de création du brouillon)
    supabase
      .from('invoices')
      .select('total_ht, total_ttc, status')
      .eq('organization_id', orgId)
      .gte('issue_date', firstOfMonth.split('T')[0])
      .lt('issue_date', firstOfNextMonth.split('T')[0])
      .in('status', ['sent', 'paid']),

    // Factures en retard (envoyées, due_date dépassé)
    supabase
      .from('invoices')
      .select('id, number, total_ttc, due_date, client_id')
      .eq('organization_id', orgId)
      .eq('status', 'sent')
      .not('due_date', 'is', null)
      .lt('due_date', today)
      .order('due_date')
      .limit(10),

    // Devis envoyés sans réponse depuis > 2 semaines
    supabase
      .from('quotes')
      .select('id, number, title, total_ttc, sent_at, client_id')
      .eq('organization_id', orgId)
      .eq('is_archived', false)
      .in('status', ['sent', 'viewed'])
      .order('sent_at'),

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
      .select('id, number, total_ttc, balance_due_date, client_id')
      .eq('organization_id', orgId)
      .eq('invoice_type', 'acompte')
      .in('status', ['sent', 'paid'])
      .not('balance_due_date', 'is', null)
      .lte('balance_due_date', dateParis(now.getTime() + 7 * 24 * 60 * 60 * 1000))
      .order('balance_due_date')
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
      .gte('confirmed_at', sevenDaysAgo)
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
      .gte('sent_at', sevenDaysAgo)
      .order('sent_at', { ascending: false })
      .limit(5),
  ])

  // Charger les emails clients
  const clientIds = [
    ...new Set([
      ...(overdueInvoices ?? []).map(i => i.client_id).filter(Boolean),
      ...(pendingQuotes ?? []).map(q => q.client_id).filter(Boolean),
      ...(pendingBalances ?? []).map(i => i.client_id).filter(Boolean),
    ]),
  ] as string[]

  let clientEmailMap: Record<string, string | null> = {}
  if (clientIds.length > 0) {
    const { data: clients } = await supabase
      .from('clients')
      .select('id, email')
      .in('id', clientIds)
    clients?.forEach(c => { clientEmailMap[c.id] = c.email ?? null })
  }

  // CA du mois = toutes les factures émises ce mois (sent + paid), en HT
  const caMois = monthInvoices
    ?.reduce((sum, inv) => sum + (inv.total_ht ?? 0), 0) ?? 0
  // Encaissé du mois = uniquement les factures payées ce mois, en TTC
  const encaisseMois = monthInvoices
    ?.filter(inv => inv.status === 'paid')
    .reduce((sum, inv) => sum + (inv.total_ttc ?? 0), 0) ?? 0

  const devisEnAttente = pendingQuotes?.length ?? 0

  const staleQuotes = (pendingQuotes ?? [])
    .filter(q => q.sent_at && q.sent_at < twoWeeksAgo)
    .slice(0, 5)

  const urgentItems: UrgentItem[] = [
    ...(overdueInvoices ?? []).map(inv => ({
      id: inv.id,
      type: 'overdue_invoice' as const,
      label: `Facture ${inv.number ?? '-'} en retard`,
      amount: inv.total_ttc,
      date: inv.due_date,
      clientEmail: inv.client_id ? (clientEmailMap[inv.client_id] ?? null) : null,
    })),
    ...(pendingBalances ?? []).map(inv => ({
      id: `balance-${inv.id}`,
      type: 'balance_due' as const,
      label: `Solde restant · acompte ${inv.number ?? '-'}`,
      amount: null,
      date: inv.balance_due_date,
      clientEmail: inv.client_id ? (clientEmailMap[inv.client_id] ?? null) : null,
      invoiceId: inv.id,
    })),
    ...staleQuotes.map(q => ({
      id: q.id,
      type: 'pending_quote' as const,
      label: `Devis ${q.number ?? '-'} sans réponse`,
      amount: q.total_ttc,
      date: q.sent_at,
      clientEmail: q.client_id ? (clientEmailMap[q.client_id] ?? null) : null,
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
    // Envois automatiques récents (7 derniers jours) — section "Confirmé automatiquement"
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
  ]

  return {
    caMois,
    encaisseMois,
    devisEnAttente,
    facturesEnRetard: overdueInvoices?.length ?? 0,
    urgentItems,
  }
}
