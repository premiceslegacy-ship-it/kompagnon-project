'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { hasPermission } from '@/lib/data/queries/membership'

type Result = { error: string | null }

export async function createJalon(
  chantierId: string,
  data: {
    title: string
    acomptePct: number
    description?: string | null
    position?: number
    taskIds?: string[]
  },
): Promise<{ jalonId: string | null; error: string | null }> {
  if (!(await hasPermission('chantiers.edit'))) return { jalonId: null, error: 'Action non autorisée.' }

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { jalonId: null, error: 'Non authentifié.' }
  const { data: chantier } = await supabase
    .from('chantiers')
    .select('id')
    .eq('id', chantierId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!chantier) return { jalonId: null, error: 'Chantier introuvable ou non autorisé.' }

  if (!data.title?.trim()) return { jalonId: null, error: 'Le titre est requis.' }
  if (data.acomptePct < 0 || data.acomptePct > 100) return { jalonId: null, error: 'Pourcentage invalide (0–100).' }

  // Position par défaut = max + 1
  let position = data.position
  if (position == null) {
    const { data: last } = await supabase
      .from('chantier_jalons')
      .select('position')
      .eq('chantier_id', chantierId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle()
    position = (last?.position ?? -1) + 1
  }

  const { data: jalon, error } = await supabase
    .from('chantier_jalons')
    .insert({
      organization_id: orgId,
      chantier_id: chantierId,
      title: data.title.trim(),
      acompte_pct: data.acomptePct,
      description: data.description ?? null,
      position,
    })
    .select('id')
    .single()

  if (error || !jalon) {
    console.error('[createJalon]', error)
    return { jalonId: null, error: 'Erreur lors de la création du jalon.' }
  }

  if (data.taskIds?.length) {
    await supabase
      .from('chantier_taches')
      .update({ jalon_id: jalon.id })
      .in('id', data.taskIds)
      .eq('chantier_id', chantierId)
  }

  revalidatePath(`/chantiers/${chantierId}`)
  return { jalonId: jalon.id, error: null }
}

export async function updateJalon(
  jalonId: string,
  patch: {
    title?: string
    acomptePct?: number
    description?: string | null
  },
): Promise<Result> {
  if (!(await hasPermission('chantiers.edit'))) return { error: 'Action non autorisée.' }

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }
  const update: Record<string, any> = {}
  if (patch.title !== undefined) update.title = patch.title.trim()
  if (patch.acomptePct !== undefined) {
    if (patch.acomptePct < 0 || patch.acomptePct > 100) return { error: 'Pourcentage invalide (0–100).' }
    update.acompte_pct = patch.acomptePct
  }
  if (patch.description !== undefined) update.description = patch.description

  const { error } = await supabase
    .from('chantier_jalons')
    .update(update)
    .eq('id', jalonId)
    .eq('organization_id', orgId)

  if (error) {
    console.error('[updateJalon]', error)
    return { error: 'Erreur lors de la mise à jour du jalon.' }
  }
  revalidatePath('/chantiers')
  return { error: null }
}

export async function deleteJalon(jalonId: string): Promise<Result> {
  if (!(await hasPermission('chantiers.edit'))) return { error: 'Action non autorisée.' }

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }
  const { error } = await supabase.from('chantier_jalons').delete().eq('id', jalonId).eq('organization_id', orgId)
  if (error) return { error: 'Erreur lors de la suppression du jalon.' }
  revalidatePath('/chantiers')
  return { error: null }
}

export async function reorderJalons(chantierId: string, orderedIds: string[]): Promise<Result> {
  if (!(await hasPermission('chantiers.edit'))) return { error: 'Action non autorisée.' }

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }
  const { data: chantier } = await supabase
    .from('chantiers')
    .select('id')
    .eq('id', chantierId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!chantier) return { error: 'Chantier introuvable ou non autorisé.' }
  for (let i = 0; i < orderedIds.length; i++) {
    await supabase.from('chantier_jalons').update({ position: i }).eq('id', orderedIds[i]).eq('chantier_id', chantierId).eq('organization_id', orgId)
  }
  revalidatePath(`/chantiers/${chantierId}`)
  return { error: null }
}

export async function assignTasksToJalon(
  jalonId: string | null,
  taskIds: string[],
  chantierId: string,
): Promise<Result> {
  if (!(await hasPermission('chantiers.edit'))) return { error: 'Action non autorisée.' }

  if (!taskIds.length) return { error: null }
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }
  const { data: chantier } = await supabase
    .from('chantiers')
    .select('id')
    .eq('id', chantierId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!chantier) return { error: 'Chantier introuvable ou non autorisé.' }
  const { error } = await supabase
    .from('chantier_taches')
    .update({ jalon_id: jalonId })
    .in('id', taskIds)
    .eq('chantier_id', chantierId)
  if (error) return { error: 'Erreur lors de l\'assignation des tâches.' }
  revalidatePath(`/chantiers/${chantierId}`)
  return { error: null }
}

export async function completeJalon(jalonId: string, report: string): Promise<Result> {
  if (!(await hasPermission('chantiers.edit'))) return { error: 'Action non autorisée.' }

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }
  const { error } = await supabase
    .from('chantier_jalons')
    .update({
      status: 'completed',
      completion_report: report,
      completed_at: new Date().toISOString(),
    })
    .eq('id', jalonId)
    .eq('organization_id', orgId)
  if (error) return { error: 'Erreur lors de la validation du jalon.' }
  revalidatePath('/chantiers')
  return { error: null }
}

/**
 * Génère une facture pour un jalon completé.
 * Montant = budget_ht × acompte_pct%.
 * Si le chantier a un devis, utilise quote.total_ht comme base, sinon chantier.budget_ht.
 */
export async function generateJalonInvoice(jalonId: string): Promise<{ invoiceId: string | null; error: string | null }> {
  if (!(await hasPermission('chantiers.edit'))) return { invoiceId: null, error: 'Action non autorisée.' }
  if (!(await hasPermission('invoices.create'))) return { invoiceId: null, error: 'Action non autorisée.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { invoiceId: null, error: 'Non authentifié.' }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { invoiceId: null, error: 'Organisation introuvable.' }

  const { data: jalon } = await supabase
    .from('chantier_jalons')
    .select('id, chantier_id, title, acompte_pct, status, invoice_id')
    .eq('id', jalonId)
    .eq('organization_id', orgId)
    .single()

  if (!jalon) return { invoiceId: null, error: 'Jalon introuvable.' }
  if (jalon.status === 'invoiced' && jalon.invoice_id) {
    return { invoiceId: jalon.invoice_id, error: null }
  }
  if (jalon.status !== 'completed') {
    return { invoiceId: null, error: 'Le jalon doit être marqué comme complété avant la facturation.' }
  }

  const { data: chantier } = await supabase
    .from('chantiers')
    .select('id, title, budget_ht, quote_id, client_id')
    .eq('id', jalon.chantier_id)
    .eq('organization_id', orgId)
    .single()

  if (!chantier) return { invoiceId: null, error: 'Chantier introuvable.' }

  // Base : devis lié si dispo, sinon budget chantier
  let baseHt = chantier.budget_ht ?? 0
  let quoteCurrency: string | null = null
  let paymentConditions: string | null = null
  if (chantier.quote_id) {
    const { data: quote } = await supabase
      .from('quotes')
      .select('total_ht, currency, payment_conditions')
      .eq('id', chantier.quote_id)
      .eq('organization_id', orgId)
      .single()
    if (quote) {
      baseHt = quote.total_ht ?? baseHt
      quoteCurrency = quote.currency
      paymentConditions = quote.payment_conditions
    }
  }

  const ratio = (jalon.acompte_pct ?? 0) / 100
  const netHt = Math.round(baseHt * ratio * 100) / 100

  // VAT à 20% par défaut (la facture sera éditable)
  const vatRate = 20
  const totalTva = Math.round(netHt * (vatRate / 100) * 100) / 100
  const totalTtc = Math.round((netHt + totalTva) * 100) / 100

  const title = `Acompte ${jalon.acompte_pct}% - ${jalon.title}`
  const notesClient = `Acompte au titre du jalon "${jalon.title}" (${jalon.acompte_pct}% du chantier "${chantier.title}").`

  const { data: invoice, error: createErr } = await supabase
    .from('invoices')
    .insert({
      organization_id: orgId,
      client_id: chantier.client_id ?? null,
      quote_id: chantier.quote_id ?? null,
      chantier_id: chantier.id,
      invoice_type: 'situation',
      title,
      currency: quoteCurrency ?? 'EUR',
      status: 'draft',
      created_by: user.id,
      total_ht: netHt,
      total_tva: totalTva,
      total_ttc: totalTtc,
      payment_conditions: paymentConditions,
      notes_client: notesClient,
    })
    .select('id')
    .single()

  if (createErr || !invoice) {
    console.error('[generateJalonInvoice]', createErr)
    return { invoiceId: null, error: 'Erreur lors de la création de la facture.' }
  }

  // Une ligne unique : description = titre du jalon
  await supabase.from('invoice_items').insert({
    invoice_id: invoice.id,
    description: jalon.title,
    quantity: 1,
    unit: 'forfait',
    unit_price: netHt,
    vat_rate: vatRate,
    position: 0,
  })

  // Marquer le jalon comme facturé
  await supabase
    .from('chantier_jalons')
    .update({ status: 'invoiced', invoice_id: invoice.id })
    .eq('id', jalonId)

  revalidatePath(`/chantiers/${jalon.chantier_id}`)
  revalidatePath('/finances')
  return { invoiceId: invoice.id, error: null }
}
