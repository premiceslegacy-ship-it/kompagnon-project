'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'

type Result = { error: string | null }

export type SupplierInput = {
  name: string
  contact_name?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  siret?: string | null
  payment_terms?: string | null
  notes?: string | null
}

export type ImportSuppliersState = {
  error: string | null
  imported: number
  skipped: number
  skipped_reasons: string[]
}

export async function createSupplier(data: SupplierInput): Promise<{ id: string | null; error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { id: null, error: 'Non authentifié.' }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { id: null, error: 'Organisation introuvable.' }

  if (!data.name?.trim()) return { id: null, error: 'Le nom du fournisseur est requis.' }

  const { data: row, error } = await supabase
    .from('suppliers')
    .insert({
      organization_id: orgId,
      name: data.name.trim(),
      contact_name: data.contact_name?.trim() || null,
      email: data.email?.trim() || null,
      phone: data.phone?.trim() || null,
      address: data.address?.trim() || null,
      siret: data.siret?.trim() || null,
      payment_terms: data.payment_terms?.trim() || null,
      notes: data.notes?.trim() || null,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[createSupplier]', error)
    return { id: null, error: 'Erreur lors de la création du fournisseur.' }
  }

  revalidatePath('/catalog')
  return { id: row.id, error: null }
}

export async function updateSupplier(supplierId: string, data: Partial<SupplierInput>): Promise<Result> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }

  const updates: Record<string, unknown> = {}
  if (data.name !== undefined) updates.name = data.name.trim()
  if (data.contact_name !== undefined) updates.contact_name = data.contact_name?.trim() || null
  if (data.email !== undefined) updates.email = data.email?.trim() || null
  if (data.phone !== undefined) updates.phone = data.phone?.trim() || null
  if (data.address !== undefined) updates.address = data.address?.trim() || null
  if (data.siret !== undefined) updates.siret = data.siret?.trim() || null
  if (data.payment_terms !== undefined) updates.payment_terms = data.payment_terms?.trim() || null
  if (data.notes !== undefined) updates.notes = data.notes?.trim() || null

  const { error } = await supabase
    .from('suppliers')
    .update(updates)
    .eq('id', supplierId)
    .eq('organization_id', orgId)

  if (error) {
    console.error('[updateSupplier]', error)
    return { error: 'Erreur lors de la mise à jour.' }
  }

  revalidatePath('/catalog')
  return { error: null }
}

export async function deleteSupplier(supplierId: string): Promise<Result> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }

  const { error } = await supabase
    .from('suppliers')
    .update({ is_active: false })
    .eq('id', supplierId)
    .eq('organization_id', orgId)

  if (error) {
    console.error('[deleteSupplier]', error)
    return { error: 'Erreur lors de la suppression.' }
  }

  revalidatePath('/catalog')
  return { error: null }
}

export async function importSuppliers(
  _prevState: ImportSuppliersState,
  formData: FormData,
): Promise<ImportSuppliersState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.', imported: 0, skipped: 0, skipped_reasons: [] }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.', imported: 0, skipped: 0, skipped_reasons: [] }

  const rawData = formData.get('items_json') as string
  if (!rawData) return { error: 'Aucune donnée à importer.', imported: 0, skipped: 0, skipped_reasons: [] }

  let rows: Record<string, string>[]
  try { rows = JSON.parse(rawData) } catch {
    return { error: 'Format de données invalide.', imported: 0, skipped: 0, skipped_reasons: [] }
  }

  const skippedReasons: string[] = []
  const toInsert = rows
    .map((row, i) => {
      if (!row.name?.trim()) {
        skippedReasons.push(`Ligne ${i + 1} ignorée : nom manquant`)
        return null
      }
      return {
        organization_id: orgId,
        name: row.name.trim(),
        contact_name: row.contact_name?.trim() || null,
        email: row.email?.trim() || null,
        phone: row.phone?.trim() || null,
        address: row.address?.trim() || null,
        siret: row.siret?.trim() || null,
        payment_terms: row.payment_terms?.trim() || null,
        notes: row.notes?.trim() || null,
      }
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)

  const skipped = rows.length - toInsert.length
  if (toInsert.length === 0) {
    return { error: 'Aucun fournisseur valide (colonne "name" requise).', imported: 0, skipped, skipped_reasons: skippedReasons }
  }

  const { error } = await supabase.from('suppliers').insert(toInsert)
  if (error) {
    console.error('[importSuppliers]', error)
    return { error: "Erreur lors de l'import en base de données.", imported: 0, skipped, skipped_reasons: skippedReasons }
  }

  await supabase.from('import_jobs').insert({
    organization_id: orgId,
    type: 'suppliers',
    status: toInsert.length > 0 ? 'completed' : 'failed',
    file_name: formData.get('file_name') as string | null,
    total_rows: rows.length,
    imported_rows: toInsert.length,
    skipped_rows: skipped,
    error_rows: skipped,
    error_details: skippedReasons.length > 0 ? skippedReasons : null,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    created_by: user.id,
  })

  revalidatePath('/catalog')
  return { error: null, imported: toInsert.length, skipped, skipped_reasons: skippedReasons }
}
