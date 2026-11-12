'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import type { RecurringFrequency } from '@/lib/data/recurring-utils'
import { coerceLegalVatRate } from '@/lib/utils'
import { calculateMonetaryTotals } from '@/lib/utils/money'

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
  const baseAmountHt = calculateMonetaryTotals(normalizedItems.filter(item => item.unit !== '__section__')).totalHt

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
  const baseAmountHt = calculateMonetaryTotals(normalizedItems.filter(item => item.unit !== '__section__')).totalHt

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

  const { data, error } = await supabase.rpc('prepare_recurring_invoice_occurrence', {
    p_recurring_invoice_id: recurringId,
  })
  if (error) return { error: error.message }
  const occurrence = data as { invoice_id?: unknown; created?: unknown; reason?: unknown } | null
  if (!occurrence || typeof occurrence.created !== 'boolean') {
    return { error: 'La facture récurrente n’a pas retourné de brouillon valide.' }
  }
  if (occurrence.created === false && occurrence.reason === 'not_due') {
    return { error: 'La prochaine facture récurrente n’est pas encore à préparer.' }
  }
  if (typeof occurrence.invoice_id !== 'string') {
    return { error: 'La facture récurrente n’a pas retourné de brouillon valide.' }
  }
  const invoiceId = occurrence.invoice_id

  const { data: linkedContract } = await supabase
    .from('maintenance_contracts')
    .select('id, chantier_id')
    .eq('recurring_invoice_id', recurringId)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (linkedContract?.chantier_id) {
    await supabase
      .from('invoices')
      .update({ chantier_id: linkedContract.chantier_id, generation_source: 'maintenance_recurring' })
      .eq('id', invoiceId)
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
        .update({ invoice_id: invoiceId })
        .eq('id', nextIntervention.id)
        .eq('organization_id', orgId)
        .is('invoice_id', null)
    }
  }

  revalidatePath('/finances/recurring')
  revalidatePath('/finances')
  revalidatePath('/rapports')
  return { error: null, invoiceId }
}

// ─── Skip a pending schedule ──────────────────────────────────────────────────

export async function skipSchedule(scheduleId: string): Promise<Result> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('skip_recurring_invoice_occurrence', {
    p_schedule_id: scheduleId,
  })

  if (error) return { error: error.message }

  revalidatePath('/finances/recurring')
  revalidatePath('/finances')
  return { error: null }
}
