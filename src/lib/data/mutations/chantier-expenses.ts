'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'

type Result = { error: string | null }

export type ChantierExpenseCategory = 'materiel' | 'sous_traitance' | 'location' | 'transport' | 'autre'

export type ChantierExpenseInput = {
  chantierId: string
  category: ChantierExpenseCategory
  label: string
  amountHt: number
  vatRate?: number
  expenseDate?: string
  supplierName?: string | null
  receivedInvoiceId?: string | null
  receiptStoragePath?: string | null
  notes?: string | null
  // Détails optionnels
  quantity?: number | null
  unit?: string | null
  unitPriceHt?: number | null
  materialId?: string | null
  subcategory?: string | null
  // Transport / carburant
  transportKm?: number | null
  transportConsumption?: number | null
  transportFuelPrice?: number | null
  // Location
  rentalItemLabel?: string | null
  rentalStartDate?: string | null
  rentalEndDate?: string | null
}

export async function createChantierExpense(data: ChantierExpenseInput): Promise<Result & { id?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }

  const amountHt = computeAmountHt(data)

  const { data: inserted, error } = await supabase
    .from('chantier_expenses')
    .insert({
      organization_id: orgId,
      chantier_id: data.chantierId,
      category: data.category,
      label: data.label,
      amount_ht: amountHt,
      vat_rate: data.vatRate ?? 20,
      expense_date: data.expenseDate ?? new Date().toISOString().slice(0, 10),
      supplier_name: data.supplierName ?? null,
      received_invoice_id: data.receivedInvoiceId ?? null,
      receipt_storage_path: data.receiptStoragePath ?? null,
      notes: data.notes ?? null,
      created_by: user.id,
      quantity: data.quantity ?? null,
      unit: data.unit ?? null,
      unit_price_ht: data.unitPriceHt ?? null,
      material_id: data.materialId ?? null,
      subcategory: data.subcategory ?? null,
      transport_km: data.transportKm ?? null,
      transport_consumption: data.transportConsumption ?? null,
      transport_fuel_price: data.transportFuelPrice ?? null,
      rental_item_label: data.rentalItemLabel ?? null,
      rental_start_date: data.rentalStartDate ?? null,
      rental_end_date: data.rentalEndDate ?? null,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[createChantierExpense]', error)
    return { error: "Erreur lors de l'enregistrement de la dépense." }
  }

  revalidatePath(`/chantiers/${data.chantierId}`)
  return { error: null, id: inserted.id }
}

export async function updateChantierExpense(
  expenseId: string,
  chantierId: string,
  data: Partial<Omit<ChantierExpenseInput, 'chantierId'>>,
): Promise<Result> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  const update: Record<string, unknown> = {}
  if (data.category !== undefined)             update.category               = data.category
  if (data.label !== undefined)                update.label                  = data.label
  if (data.vatRate !== undefined)              update.vat_rate               = data.vatRate
  if (data.expenseDate !== undefined)          update.expense_date           = data.expenseDate
  if (data.supplierName !== undefined)         update.supplier_name          = data.supplierName
  if (data.receiptStoragePath !== undefined)   update.receipt_storage_path   = data.receiptStoragePath
  if (data.notes !== undefined)                update.notes                  = data.notes
  if (data.quantity !== undefined)             update.quantity               = data.quantity
  if (data.unit !== undefined)                 update.unit                   = data.unit
  if (data.unitPriceHt !== undefined)          update.unit_price_ht          = data.unitPriceHt
  if (data.materialId !== undefined)           update.material_id            = data.materialId
  if (data.subcategory !== undefined)          update.subcategory            = data.subcategory
  if (data.transportKm !== undefined)          update.transport_km           = data.transportKm
  if (data.transportConsumption !== undefined) update.transport_consumption  = data.transportConsumption
  if (data.transportFuelPrice !== undefined)   update.transport_fuel_price   = data.transportFuelPrice
  if (data.rentalItemLabel !== undefined)      update.rental_item_label      = data.rentalItemLabel
  if (data.rentalStartDate !== undefined)      update.rental_start_date      = data.rentalStartDate
  if (data.rentalEndDate !== undefined)        update.rental_end_date        = data.rentalEndDate

  // amount_ht : si fourni explicitement on l'utilise, sinon recalcul si quantity+unitPrice
  if (data.amountHt !== undefined) {
    update.amount_ht = data.amountHt
  } else if (data.quantity !== undefined || data.unitPriceHt !== undefined) {
    const q = data.quantity ?? null
    const u = data.unitPriceHt ?? null
    if (q != null && u != null) update.amount_ht = q * u
  }

  const { error } = await supabase
    .from('chantier_expenses')
    .update(update)
    .eq('id', expenseId)
    .eq('chantier_id', chantierId)

  if (error) {
    console.error('[updateChantierExpense]', error)
    return { error: 'Erreur lors de la mise à jour de la dépense.' }
  }

  revalidatePath(`/chantiers/${chantierId}`)
  return { error: null }
}

export async function deleteChantierExpense(expenseId: string, chantierId: string): Promise<Result> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('chantier_expenses')
    .delete()
    .eq('id', expenseId)
    .eq('chantier_id', chantierId)

  if (error) {
    console.error('[deleteChantierExpense]', error)
    return { error: 'Erreur lors de la suppression de la dépense.' }
  }

  revalidatePath(`/chantiers/${chantierId}`)
  return { error: null }
}

export async function linkReceivedInvoiceToChantier(
  receivedInvoiceId: string,
  chantierId: string | null,
): Promise<Result> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  const { error } = await supabase
    .from('received_invoices')
    .update({ chantier_id: chantierId })
    .eq('id', receivedInvoiceId)
    .eq('organization_id', orgId)

  if (error) {
    console.error('[linkReceivedInvoiceToChantier]', error)
    return { error: 'Erreur lors du rattachement de la facture.' }
  }

  if (chantierId) revalidatePath(`/chantiers/${chantierId}`)
  return { error: null }
}

export async function uploadExpenseReceipt(
  chantierId: string,
  formData: FormData,
): Promise<{ storagePath: string | null; error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { storagePath: null, error: 'Non authentifié.' }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { storagePath: null, error: 'Organisation introuvable.' }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return { storagePath: null, error: 'Fichier manquant.' }
  }

  const ext = file.name.split('.').pop() ?? 'jpg'
  const path = `${orgId}/receipts/${chantierId}/${crypto.randomUUID()}.${ext}`

  const { error } = await supabase.storage
    .from('chantier-photos')
    .upload(path, file, { contentType: file.type, upsert: false })

  if (error) {
    console.error('[uploadExpenseReceipt]', error)
    return { storagePath: null, error: 'Erreur lors de l\'envoi du fichier.' }
  }

  return { storagePath: path, error: null }
}

export async function getReceiptSignedUrl(storagePath: string): Promise<{ url: string | null; error: string | null }> {
  const supabase = await createClient()
  const { data, error } = await supabase.storage
    .from('chantier-photos')
    .createSignedUrl(storagePath, 3600)

  if (error || !data?.signedUrl) {
    return { url: null, error: 'Impossible de générer le lien.' }
  }
  return { url: data.signedUrl, error: null }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function computeAmountHt(data: ChantierExpenseInput): number {
  if (data.amountHt != null && data.amountHt > 0) return data.amountHt
  if (data.quantity != null && data.unitPriceHt != null) {
    return Math.round(data.quantity * data.unitPriceHt * 100) / 100
  }
  return 0
}
