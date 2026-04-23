import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'

export type OverdueInvoice = {
  id: string
  number: string | null
  total_ttc: number | null
  due_date: string | null
  daysOverdue: number
  clientName: string
  clientEmail: string | null
  clientId: string | null
  reminderCount: number
  lastRemindedAt: string | null
}

export type PendingQuote = {
  id: string
  number: string | null
  title: string | null
  total_ttc: number | null
  sent_at: string | null
  daysPending: number
  clientName: string
  clientEmail: string | null
  clientId: string | null
  reminderCount: number
  lastRemindedAt: string | null
}

export type RemindersData = {
  overdueInvoices: OverdueInvoice[]
  pendingQuotes: PendingQuote[]
}

// Nombre de jours de silence après une relance avant de réafficher l'item
const COOLDOWN_DAYS = 3

export async function getRemindersData(): Promise<RemindersData> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()

  if (!orgId) return { overdueInvoices: [], pendingQuotes: [] }

  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]
  const todayMidnight = new Date(todayStr)
  const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const cooldownCutoff = new Date(todayMidnight.getTime() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const [
    { data: invoices },
    { data: quotes },
    { data: invoiceReminderData },
    { data: quoteReminderData },
  ] = await Promise.all([
    // Factures envoyées avec due_date dépassé
    supabase
      .from('invoices')
      .select('id, number, total_ttc, due_date, client_id')
      .eq('organization_id', orgId)
      .eq('status', 'sent')
      .not('due_date', 'is', null)
      .lt('due_date', todayStr)
      .order('due_date'),

    // Devis envoyés > 7 jours sans réponse
    supabase
      .from('quotes')
      .select('id, number, title, total_ttc, sent_at, client_id')
      .eq('organization_id', orgId)
      .in('status', ['sent', 'viewed'])
      .lt('sent_at', sevenDaysAgo)
      .order('sent_at'),

    // Relances factures avec date d'envoi (pour cooldown)
    supabase
      .from('reminders')
      .select('invoice_id, sent_at')
      .eq('organization_id', orgId)
      .not('invoice_id', 'is', null)
      .order('sent_at', { ascending: false }),

    // Relances devis avec date d'envoi (pour cooldown)
    supabase
      .from('reminders')
      .select('quote_id, sent_at')
      .eq('organization_id', orgId)
      .not('quote_id', 'is', null)
      .order('sent_at', { ascending: false }),
  ])

  // Charger les clients en une seule requête
  const clientIds = [
    ...new Set([
      ...(invoices ?? []).map(i => i.client_id).filter(Boolean),
      ...(quotes ?? []).map(q => q.client_id).filter(Boolean),
    ]),
  ] as string[]

  let clientMap: Record<string, { name: string; email: string | null }> = {}
  if (clientIds.length > 0) {
    const { data: clients } = await supabase
      .from('clients')
      .select('id, company_name, contact_name, first_name, last_name, email')
      .in('id', clientIds)
    clients?.forEach(c => {
      clientMap[c.id] = {
        name: (c as any).company_name || [(c as any).first_name, (c as any).last_name].filter(Boolean).join(' ') || 'Client inconnu',
        email: (c as any).email ?? null,
      }
    })
  }

  // Compteurs + dernière date de relance par facture
  const invoiceReminderCount: Record<string, number> = {}
  const invoiceLastRemindedAt: Record<string, string> = {}
  invoiceReminderData?.forEach(r => {
    if (!r.invoice_id) return
    invoiceReminderCount[r.invoice_id] = (invoiceReminderCount[r.invoice_id] ?? 0) + 1
    // Les rows sont triées DESC, donc la première occurrence = la plus récente
    if (!invoiceLastRemindedAt[r.invoice_id]) {
      invoiceLastRemindedAt[r.invoice_id] = r.sent_at
    }
  })

  // Compteurs + dernière date de relance par devis
  const quoteReminderCount: Record<string, number> = {}
  const quoteLastRemindedAt: Record<string, string> = {}
  quoteReminderData?.forEach(r => {
    if (!r.quote_id) return
    quoteReminderCount[r.quote_id] = (quoteReminderCount[r.quote_id] ?? 0) + 1
    if (!quoteLastRemindedAt[r.quote_id]) {
      quoteLastRemindedAt[r.quote_id] = r.sent_at
    }
  })

  // Filtre cooldown : n'afficher que les items dont la dernière relance
  // remonte à plus de COOLDOWN_DAYS jours (ou jamais relancés)
  const overdueInvoices: OverdueInvoice[] = (invoices ?? [])
    .filter(inv => {
      const lastAt = invoiceLastRemindedAt[inv.id] ?? null
      return !lastAt || lastAt < cooldownCutoff
    })
    .map(inv => {
      const dueDate = new Date(inv.due_date!)
      const daysOverdue = Math.floor((todayMidnight.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24))
      const client = inv.client_id ? clientMap[inv.client_id] : null
      return {
        id: inv.id,
        number: inv.number,
        total_ttc: inv.total_ttc,
        due_date: inv.due_date,
        daysOverdue,
        clientName: client?.name ?? 'Client inconnu',
        clientEmail: client?.email ?? null,
        clientId: inv.client_id,
        reminderCount: invoiceReminderCount[inv.id] ?? 0,
        lastRemindedAt: invoiceLastRemindedAt[inv.id] ?? null,
      }
    })

  const pendingQuotes: PendingQuote[] = (quotes ?? [])
    .filter(q => {
      const lastAt = quoteLastRemindedAt[q.id] ?? null
      return !lastAt || lastAt < cooldownCutoff
    })
    .map(q => {
      const sentDateMidnight = new Date(q.sent_at!.split('T')[0])
      const daysPending = Math.floor((todayMidnight.getTime() - sentDateMidnight.getTime()) / (1000 * 60 * 60 * 24))
      const client = q.client_id ? clientMap[q.client_id] : null
      return {
        id: q.id,
        number: q.number,
        title: q.title,
        total_ttc: q.total_ttc,
        sent_at: q.sent_at,
        daysPending,
        clientName: client?.name ?? 'Client inconnu',
        clientEmail: client?.email ?? null,
        clientId: q.client_id,
        reminderCount: quoteReminderCount[q.id] ?? 0,
        lastRemindedAt: quoteLastRemindedAt[q.id] ?? null,
      }
    })

  return { overdueInvoices, pendingQuotes }
}
