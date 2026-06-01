'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { computeNextSendDate } from '@/lib/data/recurring-utils'
import type { RecurringFrequency } from '@/lib/data/recurring-utils'
import { dateParis } from '@/lib/utils'
import { coerceLegalVatRate } from '@/lib/utils'

type Result = { error: string | null }

// ─── Types input ──────────────────────────────────────────────────────────────

export type RecurringInvoiceInput = {
  clientId: string
  title: string
  internalNote?: string
  frequency: RecurringFrequency
  sendDay?: number | null          // jour du mois 1–28 pour mensuelle/trimestrielle
  customIntervalDays?: number | null
  firstSendDate: string            // date ISO du premier envoi
  requiresConfirmation: boolean
  confirmationDelayDays: number    // jours avant l'envoi où on crée le brouillon
  autoSendDelayDays?: number | null // jours après création brouillon avant envoi auto (null = désactivé)
  currency?: string
  items: {
    description: string
    quantity: number
    unit?: string
    unit_price: number
    vat_rate: number
    position: number
    is_internal?: boolean
  }[]
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createRecurringInvoice(data: RecurringInvoiceInput): Promise<Result & { id?: string }> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  // Calculer le montant HT de base
  const normalizedItems = data.items.map(item => ({ ...item, vat_rate: coerceLegalVatRate(item.vat_rate, 20) }))
  const baseAmountHt = normalizedItems.reduce((sum, i) => sum + i.quantity * i.unit_price, 0)

  const { data: created, error } = await supabase
    .from('recurring_invoices')
    .insert({
      organization_id: orgId,
      client_id: data.clientId,
      title: data.title,
      internal_note: data.internalNote ?? null,
      frequency: data.frequency,
      send_day: data.sendDay ?? null,
      custom_interval_days: data.customIntervalDays ?? null,
      next_send_date: data.firstSendDate,
      requires_confirmation: data.requiresConfirmation,
      confirmation_delay_days: data.confirmationDelayDays,
      auto_send_delay_days: data.autoSendDelayDays ?? null,
      base_amount_ht: baseAmountHt,
      currency: data.currency ?? 'EUR',
      is_active: true,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  // Insérer les lignes du modèle
  if (normalizedItems.length > 0) {
    const { error: itemsError } = await supabase.from('recurring_invoice_items').insert(
      normalizedItems.map(i => ({
        recurring_invoice_id: created.id,
        description: i.description,
        quantity: i.quantity,
        unit: i.unit ?? null,
        unit_price: i.unit_price,
        vat_rate: i.vat_rate,
        position: i.position,
        is_internal: i.is_internal ?? false,
      })),
    )
    if (itemsError) return { error: itemsError.message }
  }

  revalidatePath('/finances/recurring')
  return { error: null, id: created.id }
}

// ─── Update items ─────────────────────────────────────────────────────────────

export async function updateRecurringInvoiceItems(
  recurringId: string,
  items: { description: string; quantity: number; unit?: string; unit_price: number; vat_rate: number; position: number; is_internal?: boolean }[],
): Promise<Result> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  const { data: ri } = await supabase
    .from('recurring_invoices')
    .select('id')
    .eq('id', recurringId)
    .eq('organization_id', orgId)
    .single()
  if (!ri) return { error: 'Modèle introuvable.' }

  await supabase.from('recurring_invoice_items').delete().eq('recurring_invoice_id', recurringId)

  const normalizedItems = items.map(item => ({ ...item, vat_rate: coerceLegalVatRate(item.vat_rate, 20) }))
  const baseAmountHt = normalizedItems.reduce((sum, i) => sum + i.quantity * i.unit_price, 0)

  if (normalizedItems.length > 0) {
    await supabase.from('recurring_invoice_items').insert(
      normalizedItems.map(i => ({
        recurring_invoice_id: recurringId,
        description: i.description,
        quantity: i.quantity,
        unit: i.unit ?? null,
        unit_price: i.unit_price,
        vat_rate: i.vat_rate,
        position: i.position,
        is_internal: i.is_internal ?? false,
      })),
    )
  }

  await supabase
    .from('recurring_invoices')
    .update({ base_amount_ht: baseAmountHt })
    .eq('id', recurringId)

  revalidatePath('/finances/recurring')
  return { error: null }
}

// ─── Toggle active/pause ──────────────────────────────────────────────────────

export async function toggleRecurringActive(id: string, active: boolean): Promise<Result> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  const { error } = await supabase
    .from('recurring_invoices')
    .update({
      is_active: active,
      paused_until: active ? null : null,
    })
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }
  revalidatePath('/finances/recurring')
  return { error: null }
}

// ─── Update next send date ────────────────────────────────────────────────────

export async function postponeNextSendDate(id: string, newDate: string): Promise<Result> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  const { error } = await supabase
    .from('recurring_invoices')
    .update({ next_send_date: newDate })
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }
  revalidatePath('/finances/recurring')
  return { error: null }
}

// ─── Cancel (soft delete) ─────────────────────────────────────────────────────

export async function cancelRecurringInvoice(id: string): Promise<Result> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  const { error } = await supabase
    .from('recurring_invoices')
    .update({
      cancelled_at: new Date().toISOString(),
      is_active: false,
    })
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }
  revalidatePath('/finances/recurring')
  return { error: null }
}

// ─── Prepare next draft ──────────────────────────────────────────────────────

export async function prepareNextRecurringDraft(recurringId: string): Promise<Result & { invoiceId?: string }> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  const { data: model, error: modelError } = await supabase
    .from('recurring_invoices')
    .select(`
      id, organization_id, client_id, title, frequency, send_day,
      custom_interval_days, next_send_date, requires_confirmation,
      confirmation_delay_days, currency,
      items:recurring_invoice_items(description, quantity, unit, unit_price, vat_rate, position, is_internal)
    `)
    .eq('id', recurringId)
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .is('cancelled_at', null)
    .single()

  if (modelError || !model) return { error: 'Modèle récurrent introuvable.' }

  const nextSendDate = new Date(`${model.next_send_date}T00:00:00`)
  const delayDays = model.requires_confirmation ? (model.confirmation_delay_days ?? 3) : 0
  const triggerDate = new Date(nextSendDate)
  triggerDate.setDate(triggerDate.getDate() - delayDays)
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  if (today < triggerDate) {
    return { error: `La facture sera préparée à partir du ${dateParis(triggerDate.getTime())}.` }
  }

  const { data: existing } = await supabase
    .from('invoice_schedules')
    .select('invoice_id')
    .eq('recurring_invoice_id', model.id)
    .eq('scheduled_date', model.next_send_date)
    .in('status', ['pending_confirmation', 'confirmed', 'sent'])
    .limit(1)
    .maybeSingle()

  if (existing?.invoice_id) {
    revalidatePath('/finances/recurring')
    return { error: null, invoiceId: existing.invoice_id }
  }

  const items = (model.items ?? []) as Array<{
    description: string
    quantity: number
    unit: string | null
    unit_price: number
    vat_rate: number
    position: number
    is_internal?: boolean | null
  }>
  const clientItems = items.filter(item => !item.is_internal)
  const totalHt = clientItems.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unit_price), 0)
  const totalTva = clientItems.reduce(
    (sum, item) => sum + Number(item.quantity) * Number(item.unit_price) * (Number(item.vat_rate) / 100),
    0,
  )

  const { data: invoiceRow, error: invoiceError } = await supabase
    .from('invoices')
    .insert({
      organization_id: orgId,
      client_id: model.client_id,
      title: model.title,
      currency: model.currency ?? 'EUR',
      status: 'draft',
      issue_date: model.next_send_date,
      due_date: model.next_send_date,
      total_ht: totalHt,
      total_tva: totalTva,
      total_ttc: totalHt + totalTva,
      generation_source: 'recurring_model',
    })
    .select('id')
    .single()

  if (invoiceError || !invoiceRow) return { error: invoiceError?.message ?? 'Erreur lors de la création du brouillon.' }

  if (items.length > 0) {
    const { error: itemsError } = await supabase.from('invoice_items').insert(
      items.map(item => ({
        invoice_id: invoiceRow.id,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit ?? null,
        unit_price: item.unit_price,
        vat_rate: coerceLegalVatRate(item.vat_rate, 20),
        position: item.position,
        is_internal: item.is_internal ?? false,
      })),
    )
    if (itemsError) return { error: itemsError.message }
  }

  const { error: scheduleError } = await supabase.from('invoice_schedules').insert({
    organization_id: orgId,
    recurring_invoice_id: model.id,
    scheduled_date: model.next_send_date,
    status: model.requires_confirmation ? 'pending_confirmation' : 'confirmed',
    invoice_id: invoiceRow.id,
    amount_ht: totalHt,
    notified_at: new Date().toISOString(),
  })
  if (scheduleError) return { error: scheduleError.message }

  const nextDate = computeNextSendDate(
    new Date(`${model.next_send_date}T00:00:00`),
    model.frequency as RecurringFrequency,
    model.send_day,
    model.custom_interval_days,
  )
  await supabase
    .from('recurring_invoices')
    .update({ next_send_date: dateParis(nextDate.getTime()) })
    .eq('id', model.id)
    .eq('organization_id', orgId)

  const { data: linkedContract } = await supabase
    .from('maintenance_contracts')
    .select('id, chantier_id')
    .eq('recurring_invoice_id', model.id)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (linkedContract?.chantier_id) {
    await supabase
      .from('invoices')
      .update({ chantier_id: linkedContract.chantier_id, generation_source: 'maintenance_recurring' })
      .eq('id', invoiceRow.id)
      .eq('organization_id', orgId)
  }

  if (linkedContract?.id) {
    const { data: nextIntervention } = await supabase
      .from('maintenance_interventions')
      .select('id')
      .eq('maintenance_contract_id', linkedContract.id)
      .eq('organization_id', orgId)
      .eq('statut', 'planifiée')
      .is('invoice_id', null)
      .order('date_intervention', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (nextIntervention?.id) {
      await supabase
        .from('maintenance_interventions')
        .update({ invoice_id: invoiceRow.id })
        .eq('id', nextIntervention.id)
        .eq('organization_id', orgId)
    }
  }

  revalidatePath('/finances/recurring')
  revalidatePath('/finances')
  revalidatePath('/rapports')
  return { error: null, invoiceId: invoiceRow.id }
}

// ─── Skip a pending schedule ──────────────────────────────────────────────────

export async function skipSchedule(scheduleId: string): Promise<Result> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  // Récupérer le schedule + l'invoice_id associé
  const { data: schedule } = await supabase
    .from('invoice_schedules')
    .select('id, invoice_id, recurring_invoice_id')
    .eq('id', scheduleId)
    .eq('organization_id', orgId)
    .single()

  if (!schedule) return { error: 'Occurrence introuvable.' }

  // Marquer comme ignoré
  await supabase
    .from('invoice_schedules')
    .update({ status: 'skipped' })
    .eq('id', scheduleId)

  // Supprimer le brouillon si existant
  if (schedule.invoice_id) {
    await supabase
      .from('invoices')
      .update({ status: 'cancelled', is_archived: true })
      .eq('id', schedule.invoice_id)
      .eq('status', 'draft')
  }

  // Avancer le next_send_date du modèle
  const { data: ri } = await supabase
    .from('recurring_invoices')
    .select('frequency, send_day, custom_interval_days, next_send_date')
    .eq('id', schedule.recurring_invoice_id)
    .single()

  if (ri) {
    const next = computeNextSendDate(
      new Date(ri.next_send_date),
      ri.frequency as RecurringFrequency,
      ri.send_day,
      ri.custom_interval_days,
    )
    await supabase
      .from('recurring_invoices')
      .update({ next_send_date: dateParis(next.getTime()) })
      .eq('id', schedule.recurring_invoice_id)
  }

  revalidatePath('/finances/recurring')
  revalidatePath('/finances')
  return { error: null }
}
