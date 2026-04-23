'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'

type Result = { error: string | null }

// ─── Chantier ─────────────────────────────────────────────────────────────────

export async function createChantier(data: {
  title: string
  clientId?: string | null
  description?: string | null
  addressLine1?: string | null
  postalCode?: string | null
  city?: string | null
  startDate?: string | null
  estimatedEndDate?: string | null
  budgetHt?: number
  contactName?: string | null
  contactEmail?: string | null
  contactPhone?: string | null
  quoteId?: string | null
  recurrence?: string
  recurrenceTimes?: number
  recurrenceTeamSize?: number | null
  recurrenceDurationH?: number | null
  recurrenceDurationSlots?: number[] | null
  recurrenceNotes?: string | null
}): Promise<{ chantierId: string | null; error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { chantierId: null, error: 'Non authentifié.' }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { chantierId: null, error: 'Organisation introuvable.' }

  if (!data.title?.trim()) {
    return { chantierId: null, error: 'Le titre du chantier est requis.' }
  }

  const { data: chantier, error } = await supabase
    .from('chantiers')
    .insert({
      organization_id: orgId,
      title: data.title.trim(),
      client_id: data.clientId || null,
      description: data.description || null,
      address_line1: data.addressLine1 || null,
      postal_code: data.postalCode || null,
      city: data.city || null,
      start_date: data.startDate || null,
      estimated_end_date: data.estimatedEndDate || null,
      budget_ht: data.budgetHt ?? 0,
      contact_name: data.contactName || null,
      contact_email: data.contactEmail || null,
      contact_phone: data.contactPhone || null,
      quote_id: data.quoteId || null,
      status: (data.startDate && data.startDate > new Date().toISOString().split('T')[0]) ? 'planifie' : 'en_cours',
      created_by: user.id,
      recurrence: data.recurrence ?? 'none',
      recurrence_times: data.recurrenceTimes ?? 1,
      recurrence_team_size: data.recurrenceTeamSize ?? null,
      recurrence_duration_h: data.recurrenceDurationH ?? null,
      recurrence_duration_slots: data.recurrenceDurationSlots ?? null,
      recurrence_notes: data.recurrenceNotes ?? null,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[createChantier]', error)
    return { chantierId: null, error: 'Erreur lors de la création du chantier.' }
  }

  revalidatePath('/chantiers')
  return { chantierId: chantier.id, error: null }
}

/**
 * Crée un chantier depuis un devis accepté.
 * Pré-remplit titre, client, adresse client et budget depuis le devis.
 */
export async function createChantierFromQuote(
  quoteId: string,
): Promise<{ chantierId: string | null; error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { chantierId: null, error: 'Non authentifié.' }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { chantierId: null, error: 'Organisation introuvable.' }

  // Vérifier qu'aucun chantier n'existe déjà pour ce devis
  const { data: existing } = await supabase
    .from('chantiers')
    .select('id')
    .eq('quote_id', quoteId)
    .single()

  if (existing) {
    return { chantierId: existing.id, error: null } // on redirige vers l'existant
  }

  // Charger le devis + client
  const { data: quote } = await supabase
    .from('quotes')
    .select(`
      id, number, title, total_ht, status, client_id,
      client:clients(company_name, address_line1, postal_code, city)
    `)
    .eq('id', quoteId)
    .eq('organization_id', orgId)
    .single()

  if (!quote) return { chantierId: null, error: 'Devis introuvable.' }
  if (quote.status !== 'accepted' && quote.status !== 'converted') {
    return { chantierId: null, error: 'Le devis doit être accepté pour créer un chantier.' }
  }

  const client = quote.client as any
  const title = quote.title ?? `Chantier : devis ${quote.number ?? quoteId.slice(0, 8)}`

  const { data: chantier, error } = await supabase
    .from('chantiers')
    .insert({
      organization_id: orgId,
      quote_id: quoteId,
      client_id: quote.client_id || null,
      title,
      address_line1: client?.address_line1 ?? null,
      postal_code: client?.postal_code ?? null,
      city: client?.city ?? null,
      budget_ht: quote.total_ht ?? 0,
      status: 'en_cours',
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[createChantierFromQuote]', error)
    return { chantierId: null, error: 'Erreur lors de la création du chantier.' }
  }

  revalidatePath('/chantiers')
  revalidatePath('/finances')
  return { chantierId: chantier.id, error: null }
}

export async function updateChantier(
  chantierId: string,
  data: {
    title?: string
    description?: string | null
    status?: string
    addressLine1?: string | null
    postalCode?: string | null
    city?: string | null
    startDate?: string | null
    endDate?: string | null
    estimatedEndDate?: string | null
    budgetHt?: number
    contactName?: string | null
    contactEmail?: string | null
    contactPhone?: string | null
    quoteId?: string | null
  },
): Promise<Result> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  const { error } = await supabase
    .from('chantiers')
    .update({
      ...(data.title !== undefined && { title: data.title }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.status !== undefined && { status: data.status }),
      ...(data.addressLine1 !== undefined && { address_line1: data.addressLine1 }),
      ...(data.postalCode !== undefined && { postal_code: data.postalCode }),
      ...(data.city !== undefined && { city: data.city }),
      ...(data.startDate !== undefined && { start_date: data.startDate }),
      ...(data.endDate !== undefined && { end_date: data.endDate }),
      ...(data.estimatedEndDate !== undefined && { estimated_end_date: data.estimatedEndDate }),
      ...(data.budgetHt !== undefined && { budget_ht: data.budgetHt }),
      ...(data.contactName !== undefined && { contact_name: data.contactName }),
      ...(data.contactEmail !== undefined && { contact_email: data.contactEmail }),
      ...(data.contactPhone !== undefined && { contact_phone: data.contactPhone }),
      ...(data.quoteId !== undefined && { quote_id: data.quoteId }),
    })
    .eq('id', chantierId)
    .eq('organization_id', orgId)

  if (error) {
    console.error('[updateChantier]', error)
    return { error: 'Erreur lors de la mise à jour du chantier.' }
  }

  revalidatePath('/chantiers')
  revalidatePath(`/chantiers/${chantierId}`)
  return { error: null }
}

export async function deleteChantier(chantierId: string): Promise<Result> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  const { error } = await supabase
    .from('chantiers')
    .update({ is_archived: true })
    .eq('id', chantierId)
    .eq('organization_id', orgId)

  if (error) return { error: 'Erreur lors de la suppression.' }

  revalidatePath('/chantiers')
  return { error: null }
}

// ─── Tâches ──────────────────────────────────────────────────────────────────

export async function createTache(
  chantierId: string,
  data: { title: string; description?: string | null; dueDate?: string | null },
): Promise<{ tacheId: string | null; error: string | null }> {
  const supabase = await createClient()

  // Récupérer le max position actuel
  const { data: maxPos } = await supabase
    .from('chantier_taches')
    .select('position')
    .eq('chantier_id', chantierId)
    .order('position', { ascending: false })
    .limit(1)
    .single()

  const nextPos = maxPos ? (maxPos.position ?? 0) + 1 : 0

  const { data: tache, error } = await supabase.from('chantier_taches').insert({
    chantier_id: chantierId,
    title: data.title.trim(),
    description: data.description || null,
    due_date: data.dueDate || null,
    status: 'a_faire',
    position: nextPos,
  }).select('id').single()

  if (error) {
    console.error('[createTache]', error)
    return { tacheId: null, error: 'Erreur lors de la création de la tâche.' }
  }

  revalidatePath(`/chantiers/${chantierId}`)
  return { tacheId: tache.id, error: null }
}

export async function updateTache(
  tacheId: string,
  chantierId: string,
  data: { title?: string; description?: string | null; progressNote?: string | null; status?: string; dueDate?: string | null; position?: number },
): Promise<Result> {
  const supabase = await createClient()

  const update: Record<string, unknown> = {}
  if (data.title !== undefined) update.title = data.title
  if (data.description !== undefined) update.description = data.description
  if (data.progressNote !== undefined) update.progress_note = data.progressNote
  if (data.status !== undefined) {
    update.status = data.status
    update.completed_at = data.status === 'termine' ? new Date().toISOString() : null
  }
  if (data.dueDate !== undefined) update.due_date = data.dueDate
  if (data.position !== undefined) update.position = data.position

  const { error } = await supabase
    .from('chantier_taches')
    .update(update)
    .eq('id', tacheId)

  if (error) {
    console.error('[updateTache]', error)
    return { error: 'Erreur lors de la mise à jour de la tâche.' }
  }

  revalidatePath(`/chantiers/${chantierId}`)
  return { error: null }
}

export async function reorderTaches(
  chantierId: string,
  orderedIds: string[],
): Promise<Result> {
  const supabase = await createClient()

  // Met à jour les positions en batch
  const updates = orderedIds.map((id, idx) =>
    supabase
      .from('chantier_taches')
      .update({ position: idx })
      .eq('id', id)
      .eq('chantier_id', chantierId),
  )

  const results = await Promise.all(updates)
  const failed = results.find(r => r.error)
  if (failed?.error) {
    console.error('[reorderTaches]', failed.error)
    return { error: 'Erreur lors du réordonnancement.' }
  }

  revalidatePath(`/chantiers/${chantierId}`)
  return { error: null }
}

export async function deleteTache(tacheId: string, chantierId: string): Promise<Result> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('chantier_taches')
    .delete()
    .eq('id', tacheId)

  if (error) return { error: 'Erreur lors de la suppression de la tâche.' }

  revalidatePath(`/chantiers/${chantierId}`)
  return { error: null }
}

// ─── Pointages ───────────────────────────────────────────────────────────────

export async function createPointage(
  chantierId: string,
  data: {
    date: string
    hours: number
    tacheId?: string | null
    description?: string | null
    start_time?: string | null
  },
): Promise<Result> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  if (data.hours <= 0 || data.hours > 24) {
    return { error: 'Le nombre d\'heures doit être compris entre 0.5 et 24.' }
  }

  const { error } = await supabase.from('chantier_pointages').insert({
    chantier_id: chantierId,
    user_id: user.id,
    date: data.date,
    hours: data.hours,
    tache_id: data.tacheId || null,
    description: data.description || null,
    start_time: data.start_time ?? null,
  })

  if (error) {
    console.error('[createPointage]', error)
    return { error: 'Erreur lors de l\'enregistrement du pointage.' }
  }

  revalidatePath(`/chantiers/${chantierId}`)
  return { error: null }
}

export async function deletePointage(pointageId: string, chantierId: string): Promise<Result> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('chantier_pointages')
    .delete()
    .eq('id', pointageId)

  if (error) return { error: 'Erreur lors de la suppression du pointage.' }

  revalidatePath(`/chantiers/${chantierId}`)
  return { error: null }
}

// ─── Notes ───────────────────────────────────────────────────────────────────

export async function createChantierNote(
  chantierId: string,
  content: string,
): Promise<Result> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  if (!content?.trim()) return { error: 'La note ne peut pas être vide.' }

  const { error } = await supabase.from('chantier_notes').insert({
    chantier_id: chantierId,
    author_id: user.id,
    content: content.trim(),
  })

  if (error) {
    console.error('[createChantierNote]', error)
    return { error: 'Erreur lors de la création de la note.' }
  }

  revalidatePath(`/chantiers/${chantierId}`)
  return { error: null }
}

export async function deleteChantierNote(noteId: string, chantierId: string): Promise<Result> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  const { error } = await supabase
    .from('chantier_notes')
    .delete()
    .eq('id', noteId)
    .eq('author_id', user.id) // seul l'auteur peut supprimer sa note

  if (error) return { error: 'Erreur lors de la suppression de la note.' }

  revalidatePath(`/chantiers/${chantierId}`)
  return { error: null }
}

// ─── Photos ──────────────────────────────────────────────────────────────────

export async function uploadChantierPhoto(
  chantierId: string,
  orgId: string,
  formData: FormData,
): Promise<{ error: string | null; photo?: { id: string; storage_path: string; caption: string | null; taken_at: string; created_at: string; uploaded_by_name: string; url: string | null } }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  const file = formData.get('file') as File | null
  if (!file) return { error: 'Aucun fichier fourni.' }

  const caption = (formData.get('caption') as string | null) ?? null
  const tacheId = (formData.get('tacheId') as string | null) || null

  const ext = file.name.split('.').pop() ?? 'jpg'
  const path = `${orgId}/${chantierId}/${Date.now()}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('chantier-photos')
    .upload(path, file, { upsert: false })

  if (uploadError) {
    console.error('[uploadChantierPhoto]', uploadError)
    return { error: 'Erreur lors de l\'upload de la photo.' }
  }

  const { data: inserted, error: insertError } = await supabase
    .from('chantier_photos')
    .insert({ chantier_id: chantierId, uploaded_by: user.id, tache_id: tacheId, storage_path: path, caption })
    .select('id, storage_path, caption, taken_at, created_at')
    .single()

  if (insertError || !inserted) {
    await supabase.storage.from('chantier-photos').remove([path])
    return { error: 'Erreur lors de l\'enregistrement de la photo.' }
  }

  const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user.id).single()
  const { data: signedData } = await supabase.storage.from('chantier-photos').createSignedUrl(path, 3600)

  revalidatePath(`/chantiers/${chantierId}`)
  return {
    error: null,
    photo: {
      id: inserted.id,
      storage_path: inserted.storage_path,
      caption: inserted.caption,
      taken_at: inserted.taken_at,
      created_at: inserted.created_at,
      uploaded_by_name: profile?.full_name ?? 'Moi',
      url: signedData?.signedUrl ?? null,
    },
  }
}

export async function deleteChantierPhoto(photoId: string, chantierId: string): Promise<Result> {
  const supabase = await createClient()

  const { data: photo } = await supabase
    .from('chantier_photos')
    .select('storage_path')
    .eq('id', photoId)
    .single()

  if (photo?.storage_path) {
    await supabase.storage.from('chantier-photos').remove([photo.storage_path])
  }

  const { error } = await supabase
    .from('chantier_photos')
    .delete()
    .eq('id', photoId)

  if (error) return { error: 'Erreur lors de la suppression de la photo.' }

  revalidatePath(`/chantiers/${chantierId}`)
  return { error: null }
}

export async function updateChantierPhotoCaption(
  photoId: string,
  chantierId: string,
  caption: string | null,
): Promise<Result> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('chantier_photos')
    .update({ caption })
    .eq('id', photoId)

  if (error) return { error: 'Erreur lors de la mise à jour de la description.' }

  revalidatePath(`/chantiers/${chantierId}`)
  return { error: null }
}

// ─── Situation de travaux ─────────────────────────────────────────────────────

/**
 * Génère une facture de situation (facturation partielle sur avancement chantier).
 * - Basée sur le devis lié au chantier
 * - invoice_type = 'situation'
 * - Déduit les acomptes déjà facturés pour calculer le reste dû
 */
export async function generateSituationInvoice(
  chantierId: string,
  progressRate: number, // avancement en % (ex: 60 pour 60% du devis)
): Promise<{ invoiceId: string | null; error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { invoiceId: null, error: 'Non authentifié.' }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { invoiceId: null, error: 'Organisation introuvable.' }

  if (progressRate <= 0 || progressRate > 100) {
    return { invoiceId: null, error: 'Taux d\'avancement invalide (1–100%).' }
  }

  // Charger le chantier + devis lié
  const { data: chantier } = await supabase
    .from('chantiers')
    .select('id, title, quote_id, client_id')
    .eq('id', chantierId)
    .eq('organization_id', orgId)
    .single()

  if (!chantier) return { invoiceId: null, error: 'Chantier introuvable.' }
  if (!chantier.quote_id) {
    return { invoiceId: null, error: 'Ce chantier n\'est pas lié à un devis. Impossible de générer une situation.' }
  }

  // Charger le devis
  const { data: quote } = await supabase
    .from('quotes')
    .select(`
      id, number, title, total_ht, total_tva, total_ttc, currency, payment_conditions,
      items:quote_items(description, quantity, unit, unit_price, vat_rate, position)
    `)
    .eq('id', chantier.quote_id)
    .eq('organization_id', orgId)
    .single()

  if (!quote) return { invoiceId: null, error: 'Devis lié introuvable.' }

  // Calculer le montant déjà facturé via acomptes/situations précédentes
  const { data: previousInvoices } = await supabase
    .from('invoices')
    .select('total_ht, invoice_type')
    .eq('quote_id', chantier.quote_id)
    .eq('organization_id', orgId)
    .in('invoice_type', ['acompte', 'situation'])
    .in('status', ['draft', 'sent', 'paid'])

  const alreadyBilledHt = previousInvoices?.reduce((s, inv) => s + (inv.total_ht ?? 0), 0) ?? 0

  const ratio = progressRate / 100
  const situationHt = Math.round((quote.total_ht ?? 0) * ratio * 100) / 100
  const situationTva = Math.round((quote.total_tva ?? 0) * ratio * 100) / 100
  const situationTtc = Math.round((quote.total_ttc ?? 0) * ratio * 100) / 100

  // Le montant de cette situation = situation cumulée - déjà facturé
  const thisInvoiceHt = Math.max(0, Math.round((situationHt - alreadyBilledHt) * 100) / 100)

  const quoteNum = quote.number ?? chantier.quote_id.slice(0, 8)
  const title = `Situation ${progressRate}% · ${quote.title ?? `Devis ${quoteNum}`}`
  const notesClient = `Situation de travaux à ${progressRate}% d'avancement sur devis n° ${quoteNum}${alreadyBilledHt > 0 ? ` (déduction des acomptes versés : ${alreadyBilledHt.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })} HT)` : ''}`

  const { data: invoice, error: createErr } = await supabase
    .from('invoices')
    .insert({
      organization_id: orgId,
      client_id: chantier.client_id ?? null,
      quote_id: chantier.quote_id,
      invoice_type: 'situation',
      title,
      currency: quote.currency ?? 'EUR',
      status: 'draft',
      created_by: user.id,
      total_ht: Math.max(0, thisInvoiceHt),
      total_tva: Math.max(0, Math.round((situationTva - (alreadyBilledHt * (situationTva / (situationHt || 1)))) * 100) / 100),
      total_ttc: Math.max(0, Math.round((situationTtc - (alreadyBilledHt * ((quote.total_ttc ?? 0) / (quote.total_ht || 1)))) * 100) / 100),
      payment_conditions: quote.payment_conditions ?? null,
      notes_client: notesClient,
    })
    .select('id')
    .single()

  if (createErr || !invoice) {
    console.error('[generateSituationInvoice]', createErr)
    return { invoiceId: null, error: 'Erreur lors de la création de la facture de situation.' }
  }

  // Copier les lignes du devis au taux d'avancement
  const items = (quote.items ?? []) as any[]
  if (items.length > 0) {
    const rows = items.map((item: any, idx: number) => ({
      invoice_id: invoice.id,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unit_price: Math.round(item.unit_price * ratio * 100) / 100,
      vat_rate: item.vat_rate,
      position: idx,
    }))
    await supabase.from('invoice_items').insert(rows)
  }

  revalidatePath('/finances')
  revalidatePath(`/chantiers/${chantierId}`)
  return { invoiceId: invoice.id, error: null }
}

// ─── Équipes ──────────────────────────────────────────────────────────────────

export async function createEquipe(data: {
  name: string
  color?: string
  description?: string | null
}): Promise<{ equipeId: string | null; error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { equipeId: null, error: 'Non authentifié.' }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { equipeId: null, error: 'Organisation introuvable.' }

  if (!data.name?.trim()) {
    return { equipeId: null, error: 'Le nom de l\'équipe est requis.' }
  }

  const { data: equipe, error } = await supabase
    .from('chantier_equipes')
    .insert({
      organization_id: orgId,
      name: data.name.trim(),
      color: data.color ?? '#6366f1',
      description: data.description ?? null,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[createEquipe]', error)
    return { equipeId: null, error: 'Erreur lors de la création de l\'équipe.' }
  }

  revalidatePath('/chantiers')
  return { equipeId: equipe.id, error: null }
}

export async function updateEquipe(
  equipeId: string,
  data: {
    name?: string
    color?: string
    description?: string | null
  },
): Promise<Result> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('chantier_equipes')
    .update({
      ...(data.name !== undefined && { name: data.name.trim() }),
      ...(data.color !== undefined && { color: data.color }),
      ...(data.description !== undefined && { description: data.description }),
    })
    .eq('id', equipeId)

  if (error) {
    console.error('[updateEquipe]', error)
    return { error: 'Erreur lors de la mise à jour de l\'équipe.' }
  }

  revalidatePath('/chantiers')
  return { error: null }
}

export async function deleteEquipe(equipeId: string): Promise<Result> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  const { error } = await supabase
    .from('chantier_equipes')
    .delete()
    .eq('id', equipeId)

  if (error) {
    console.error('[deleteEquipe]', error)
    return { error: 'Erreur lors de la suppression de l\'équipe.' }
  }

  revalidatePath('/chantiers')
  return { error: null }
}

export async function addEquipeMembre(
  equipeId: string,
  data: {
    name: string
    roleLabel?: string | null
  },
): Promise<{ membreId: string | null; error: string | null }> {
  const supabase = await createClient()

  if (!data.name?.trim()) {
    return { membreId: null, error: 'Le nom du membre est requis.' }
  }

  const { data: membre, error } = await supabase
    .from('chantier_equipe_membres')
    .insert({
      equipe_id: equipeId,
      name: data.name.trim(),
      role_label: data.roleLabel ?? null,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[addEquipeMembre]', error)
    return { membreId: null, error: 'Erreur lors de l\'ajout du membre.' }
  }

  revalidatePath('/chantiers')
  return { membreId: membre.id, error: null }
}

export async function removeEquipeMembre(membreId: string): Promise<Result> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('chantier_equipe_membres')
    .delete()
    .eq('id', membreId)

  if (error) {
    console.error('[removeEquipeMembre]', error)
    return { error: 'Erreur lors de la suppression du membre.' }
  }

  revalidatePath('/chantiers')
  return { error: null }
}

export async function assignEquipeToChantier(
  chantierId: string,
  equipeId: string,
): Promise<Result> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('chantier_equipe_chantiers')
    .upsert(
      { chantier_id: chantierId, equipe_id: equipeId },
      { onConflict: 'chantier_id,equipe_id', ignoreDuplicates: true },
    )

  if (error) {
    console.error('[assignEquipeToChantier]', error)
    return { error: 'Erreur lors de l\'assignation de l\'équipe au chantier.' }
  }

  revalidatePath(`/chantiers/${chantierId}`)
  return { error: null }
}

export async function removeEquipeFromChantier(
  chantierId: string,
  equipeId: string,
): Promise<Result> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('chantier_equipe_chantiers')
    .delete()
    .eq('chantier_id', chantierId)
    .eq('equipe_id', equipeId)

  if (error) {
    console.error('[removeEquipeFromChantier]', error)
    return { error: 'Erreur lors du retrait de l\'équipe du chantier.' }
  }

  revalidatePath(`/chantiers/${chantierId}`)
  return { error: null }
}

// ─── Planning prévisionnel ─────────────────────────────────────────────────────

export async function createChantierPlanning(
  chantierId: string,
  data: {
    plannedDate: string
    startTime?: string | null
    endTime?: string | null
    equipeId?: string | null
    label: string
    teamSize?: number
    notes?: string | null
  },
): Promise<{ planningId: string | null; error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { planningId: null, error: 'Non authentifié.' }

  if (!data.label?.trim()) return { planningId: null, error: 'Un libellé est requis.' }
  if (!data.plannedDate)    return { planningId: null, error: 'Une date est requise.' }

  const { data: row, error } = await supabase
    .from('chantier_plannings')
    .insert({
      chantier_id:  chantierId,
      planned_date: data.plannedDate,
      start_time:   data.startTime  || null,
      end_time:     data.endTime    || null,
      equipe_id:    data.equipeId   || null,
      label:        data.label.trim(),
      team_size:    data.teamSize   ?? 1,
      notes:        data.notes      || null,
      created_by:   user.id,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[createChantierPlanning]', error)
    return { planningId: null, error: 'Erreur lors de la création du planning.' }
  }

  revalidatePath(`/chantiers/${chantierId}`)
  return { planningId: row.id, error: null }
}

export async function deleteChantierPlanning(planningId: string, chantierId: string): Promise<Result> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('chantier_plannings')
    .delete()
    .eq('id', planningId)

  if (error) {
    console.error('[deleteChantierPlanning]', error)
    return { error: 'Erreur lors de la suppression.' }
  }

  revalidatePath(`/chantiers/${chantierId}`)
  return { error: null }
}
