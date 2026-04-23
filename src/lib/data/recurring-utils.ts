// Types + utilitaires récurrentes — importables côté client ET serveur (pas de next/headers)

export type RecurringFrequency = 'weekly' | 'monthly' | 'quarterly' | 'custom'

export type RecurringInvoiceItem = {
  id: string
  description: string
  quantity: number
  unit: string | null
  unit_price: number
  vat_rate: number
  position: number
}

export type RecurringInvoice = {
  id: string
  title: string
  internal_note: string | null
  frequency: RecurringFrequency
  send_day: number | null
  custom_interval_days: number | null
  next_send_date: string
  requires_confirmation: boolean
  confirmation_delay_days: number
  base_amount_ht: number | null
  currency: string
  is_active: boolean
  paused_until: string | null
  created_at: string
  client_id: string
  client: {
    id: string
    company_name: string | null
    first_name: string | null
    last_name: string | null
    email: string | null
  } | null
  items: RecurringInvoiceItem[]
}

export type PendingSchedule = {
  id: string
  scheduled_date: string
  status: string
  invoice_id: string | null
  amount_ht: number | null
  notified_at: string | null
  modification_note: string | null
  recurring_invoice: {
    id: string
    title: string
    frequency: RecurringFrequency
    client: {
      id: string
      company_name: string | null
      first_name: string | null
      last_name: string | null
      email: string | null
    } | null
  } | null
}

export function computeNextSendDate(
  from: Date,
  frequency: RecurringFrequency,
  sendDay?: number | null,
  customIntervalDays?: number | null,
): Date {
  const next = new Date(from)
  switch (frequency) {
    case 'weekly':
      next.setDate(next.getDate() + 7)
      break
    case 'monthly':
      next.setMonth(next.getMonth() + 1)
      if (sendDay) next.setDate(Math.min(sendDay, 28))
      break
    case 'quarterly':
      next.setMonth(next.getMonth() + 3)
      if (sendDay) next.setDate(Math.min(sendDay, 28))
      break
    case 'custom':
      next.setDate(next.getDate() + (customIntervalDays ?? 30))
      break
  }
  return next
}

export function frequencyLabel(f: RecurringFrequency): string {
  switch (f) {
    case 'weekly': return 'Hebdomadaire'
    case 'monthly': return 'Mensuelle'
    case 'quarterly': return 'Trimestrielle'
    case 'custom': return 'Personnalisée'
  }
}
