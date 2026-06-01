import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from './clients'
import type { RecurringInvoice, PendingSchedule } from '@/lib/data/recurring-utils'

// Re-export des types pour les composants serveur qui importent depuis ici
export type { RecurringInvoice, PendingSchedule, RecurringInvoiceItem, RecurringFrequency } from '@/lib/data/recurring-utils'

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getRecurringInvoices(): Promise<RecurringInvoice[]> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  const baseSelect = `
    id, title, internal_note, frequency, send_day, custom_interval_days,
    next_send_date, requires_confirmation, confirmation_delay_days,
    base_amount_ht, currency, is_active, paused_until, created_at, client_id,
    client:clients(id, company_name, contact_name, first_name, last_name, email),
    items:recurring_invoice_items(id, description, quantity, unit, unit_price, vat_rate, position)
  `

  const query = (select: string) => supabase
    .from('recurring_invoices')
    .select(select)
    .eq('organization_id', orgId)
    .is('cancelled_at', null)
    .order('next_send_date', { ascending: true })

  const withAutoDelay = await query(baseSelect.replace('confirmation_delay_days,', 'confirmation_delay_days, auto_send_delay_days,'))
  let data = withAutoDelay.data as unknown[] | null
  let error = withAutoDelay.error

  if (error && error.code === '42703' && error.message.includes('auto_send_delay_days')) {
    console.warn('[getRecurringInvoices] auto_send_delay_days missing, fallback without column')
    const fallback = await query(baseSelect)
    data = ((fallback.data as unknown[] | null) ?? []).map(row => ({
      ...(row as unknown as Record<string, unknown>),
      auto_send_delay_days: null,
    }))
    error = fallback.error
  }

  if (error) {
    console.error('[getRecurringInvoices]', error)
    return []
  }

  return (data ?? []) as unknown as RecurringInvoice[]
}

export async function getPendingSchedules(): Promise<PendingSchedule[]> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  const { data, error } = await supabase
    .from('invoice_schedules')
    .select(`
      id, scheduled_date, status, invoice_id, amount_ht, notified_at, modification_note,
      recurring_invoice:recurring_invoices(
        id, title, frequency,
        client:clients(id, company_name, contact_name, first_name, last_name, email)
      )
    `)
    .eq('organization_id', orgId)
    .eq('status', 'pending_confirmation')
    .order('scheduled_date', { ascending: true })

  if (error) {
    console.error('[getPendingSchedules]', error)
    return []
  }

  return (data ?? []) as unknown as PendingSchedule[]
}
