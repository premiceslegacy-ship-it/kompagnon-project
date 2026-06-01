'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { requirePermission } from '@/lib/data/queries/membership'
import type { MaintenanceFrequence, MaintenanceStatus, InterventionStatut, Equipement } from '@/lib/data/queries/maintenance'
import { coerceLegalVatRate, todayParis } from '@/lib/utils'

type Result = { error: string | null }

// ─── Contrats ─────────────────────────────────────────────────────────────────

export type MaintenanceContractInput = {
  client_id?: string | null
  chantier_id?: string | null
  source_quote_id?: string | null
  site_name?: string | null
  site_contact_name?: string | null
  site_contact_email?: string | null
  site_contact_phone?: string | null
  site_address_line1?: string | null
  site_postal_code?: string | null
  site_city?: string | null
  period_cost_labor_ht?: number | null
  period_cost_parts_ht?: number | null
  period_cost_travel_ht?: number | null
  period_cost_other_ht?: number | null
  title: string
  description?: string | null
  status?: MaintenanceStatus
  equipements?: Equipement[]
  frequence: MaintenanceFrequence
  montant_ht?: number | null
  vat_rate?: number
  facturation_auto?: boolean
  auto_send_delay_days?: number | null
  date_debut?: string | null
  date_fin?: string | null
  prochaine_intervention?: string | null
}

export async function createMaintenanceContract(input: MaintenanceContractInput): Promise<Result & { id?: string }> {
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié' }

  if (input.facturation_auto) {
    if (!input.client_id) return { error: 'Un client est obligatoire pour activer la facturation automatique.' }
    if (!input.montant_ht || input.montant_ht <= 0) return { error: 'Un montant HT positif est obligatoire pour activer la facturation automatique.' }
  }

  const { data, error } = await supabase
    .from('maintenance_contracts')
    .insert({
      organization_id: orgId,
      created_by: user.id,
      client_id: input.client_id ?? null,
      chantier_id: input.chantier_id ?? null,
      source_quote_id: input.source_quote_id ?? null,
      site_name: clean(input.site_name),
      site_contact_name: clean(input.site_contact_name),
      site_contact_email: clean(input.site_contact_email),
      site_contact_phone: clean(input.site_contact_phone),
      site_address_line1: clean(input.site_address_line1),
      site_postal_code: clean(input.site_postal_code),
      site_city: clean(input.site_city),
      period_cost_labor_ht: normalizeMoney(input.period_cost_labor_ht),
      period_cost_parts_ht: normalizeMoney(input.period_cost_parts_ht),
      period_cost_travel_ht: normalizeMoney(input.period_cost_travel_ht),
      period_cost_other_ht: normalizeMoney(input.period_cost_other_ht),
      title: input.title.trim(),
      description: input.description?.trim() ?? null,
      status: input.status ?? 'actif',
      equipements: input.equipements ?? [],
      frequence: input.frequence,
      montant_ht: input.montant_ht ?? null,
      vat_rate: input.vat_rate ?? 20,
      facturation_auto: input.facturation_auto ?? false,
      auto_send_delay_days: normalizeAutoSendDelay(input.auto_send_delay_days),
      date_debut: input.date_debut ?? null,
      date_fin: input.date_fin ?? null,
      prochaine_intervention: input.prochaine_intervention ?? null,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  const chantierError = await ensureMaintenanceChantierForContract(data.id, orgId, user.id)
  if (chantierError) return { error: chantierError, id: data.id }

  if (input.facturation_auto) {
    const recurringError = await createRecurringFromContract(data.id, orgId, user.id, input)
    if (recurringError) return { error: recurringError, id: data.id }
  }

  revalidatePath('/chantiers/entretien')
  revalidatePath('/chantiers')
  return { error: null, id: data.id }
}

export async function updateMaintenanceContract(contractId: string, input: Partial<MaintenanceContractInput>): Promise<Result> {
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const update: Record<string, unknown> = {}
  if (input.title !== undefined) update.title = input.title.trim()
  if (input.description !== undefined) update.description = input.description?.trim() ?? null
  if (input.status !== undefined) update.status = input.status
  if (input.equipements !== undefined) update.equipements = input.equipements
  if (input.frequence !== undefined) update.frequence = input.frequence
  if (input.montant_ht !== undefined) update.montant_ht = input.montant_ht
  if (input.vat_rate !== undefined) update.vat_rate = input.vat_rate
  if (input.facturation_auto !== undefined) update.facturation_auto = input.facturation_auto
  if (input.auto_send_delay_days !== undefined) update.auto_send_delay_days = normalizeAutoSendDelay(input.auto_send_delay_days)
  if (input.client_id !== undefined) update.client_id = input.client_id
  if (input.chantier_id !== undefined) update.chantier_id = input.chantier_id
  if (input.source_quote_id !== undefined) update.source_quote_id = input.source_quote_id
  if (input.site_name !== undefined) update.site_name = clean(input.site_name)
  if (input.site_contact_name !== undefined) update.site_contact_name = clean(input.site_contact_name)
  if (input.site_contact_email !== undefined) update.site_contact_email = clean(input.site_contact_email)
  if (input.site_contact_phone !== undefined) update.site_contact_phone = clean(input.site_contact_phone)
  if (input.site_address_line1 !== undefined) update.site_address_line1 = clean(input.site_address_line1)
  if (input.site_postal_code !== undefined) update.site_postal_code = clean(input.site_postal_code)
  if (input.site_city !== undefined) update.site_city = clean(input.site_city)
  if (input.period_cost_labor_ht !== undefined) update.period_cost_labor_ht = normalizeMoney(input.period_cost_labor_ht)
  if (input.period_cost_parts_ht !== undefined) update.period_cost_parts_ht = normalizeMoney(input.period_cost_parts_ht)
  if (input.period_cost_travel_ht !== undefined) update.period_cost_travel_ht = normalizeMoney(input.period_cost_travel_ht)
  if (input.period_cost_other_ht !== undefined) update.period_cost_other_ht = normalizeMoney(input.period_cost_other_ht)
  if (input.date_debut !== undefined) update.date_debut = input.date_debut
  if (input.date_fin !== undefined) update.date_fin = input.date_fin
  if (input.prochaine_intervention !== undefined) update.prochaine_intervention = input.prochaine_intervention

  const { error } = await supabase
    .from('maintenance_contracts')
    .update(update)
    .eq('id', contractId)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }

  const chantierError = await ensureMaintenanceChantierForContract(contractId, orgId, user?.id ?? null)
  if (chantierError) return { error: chantierError }

  if (input.facturation_auto === true) {
    const { data: contract } = await supabase
      .from('maintenance_contracts')
      .select(`
        client_id, title, frequence, montant_ht, vat_rate, date_debut, prochaine_intervention,
        recurring_invoice_id, auto_send_delay_days
      `)
      .eq('id', contractId)
      .eq('organization_id', orgId)
      .maybeSingle()

    if (contract && !contract.recurring_invoice_id) {
      const recurringError = await createRecurringFromContract(contractId, orgId, user?.id ?? null, {
        client_id: contract.client_id,
        title: contract.title,
        frequence: contract.frequence,
        montant_ht: contract.montant_ht,
        vat_rate: contract.vat_rate,
        facturation_auto: true,
        date_debut: contract.date_debut,
        prochaine_intervention: contract.prochaine_intervention,
        auto_send_delay_days: contract.auto_send_delay_days,
      })
      if (recurringError) return { error: recurringError }
    }
  }

  await syncRecurringInvoiceFromContract(contractId, orgId)

  revalidatePath('/chantiers/entretien')
  revalidatePath('/chantiers')
  revalidatePath('/finances/recurring')
  return { error: null }
}

export async function deleteMaintenanceContract(contractId: string): Promise<Result> {
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable' }

  const supabase = await createClient()
  const { data: contract } = await supabase
    .from('maintenance_contracts')
    .select('chantier_id')
    .eq('id', contractId)
    .eq('organization_id', orgId)
    .maybeSingle()

  const { error } = await supabase
    .from('maintenance_contracts')
    .update({ status: 'résilié' })
    .eq('id', contractId)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }

  if (contract?.chantier_id) {
    await supabase
      .from('chantiers')
      .update({ status: 'termine', end_date: todayParis() })
      .eq('id', contract.chantier_id)
      .eq('organization_id', orgId)
      .eq('is_maintenance', true)
  }

  revalidatePath('/chantiers/entretien')
  revalidatePath('/chantiers')
  revalidatePath('/dashboard')
  revalidatePath('/rapports')
  return { error: null }
}

// ─── Interventions ────────────────────────────────────────────────────────────

export type InterventionInput = {
  date_intervention: string
  intervenant_id?: string | null
  intervenant_user_id?: string | null
  intervenant_member_id?: string | null
  statut: InterventionStatut
  start_time?: string | null
  end_time?: string | null
  duration_hours?: number | null
  rapport?: string | null
  observations?: string | null
  billable_notes?: string | null
  billable_amount_ht?: number | null
  billable_vat_rate?: number | null
  cost_parts_ht?: number | null
  cost_travel_ht?: number | null
  cost_other_ht?: number | null
  invoice_id?: string | null
}

export async function createIntervention(contractId: string, input: InterventionInput): Promise<Result & { id?: string }> {
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié' }

  const { data, error } = await supabase
    .from('maintenance_interventions')
    .insert({
      maintenance_contract_id: contractId,
      organization_id: orgId,
      created_by: user.id,
      date_intervention: input.date_intervention,
      intervenant_id: input.intervenant_member_id ?? input.intervenant_id ?? null,
      intervenant_user_id: input.intervenant_user_id ?? null,
      intervenant_member_id: input.intervenant_member_id ?? input.intervenant_id ?? null,
      statut: input.statut,
      start_time: input.start_time || null,
      end_time: input.end_time || null,
      duration_hours: normalizeHours(input.duration_hours),
      rapport: input.rapport?.trim() ?? null,
      observations: input.observations?.trim() ?? null,
      billable_notes: input.billable_notes?.trim() ?? null,
      billable_amount_ht: normalizeMoneyOrNull(input.billable_amount_ht),
      billable_vat_rate: coerceLegalVatRate(input.billable_vat_rate, 20),
      cost_parts_ht: normalizeMoney(input.cost_parts_ht),
      cost_travel_ht: normalizeMoney(input.cost_travel_ht),
      cost_other_ht: normalizeMoney(input.cost_other_ht),
      invoice_id: input.invoice_id ?? null,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  if (input.statut === 'planifiée') {
    await updateNextIntervention(contractId, orgId, input.date_intervention)
  }

  const productionError = await syncInterventionProduction(data.id, orgId)
  if (productionError) return { error: productionError, id: data.id }

  revalidatePath('/chantiers/entretien')
  return { error: null, id: data.id }
}

export async function updateIntervention(interventionId: string, input: Partial<InterventionInput>): Promise<Result> {
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable' }

  const supabase = await createClient()

  const update: Record<string, unknown> = {}
  if (input.date_intervention !== undefined) update.date_intervention = input.date_intervention
  if (input.intervenant_id !== undefined) update.intervenant_id = input.intervenant_id
  if (input.intervenant_user_id !== undefined) update.intervenant_user_id = input.intervenant_user_id
  if (input.intervenant_member_id !== undefined) {
    update.intervenant_member_id = input.intervenant_member_id
    update.intervenant_id = input.intervenant_member_id
  }
  if (input.statut !== undefined) update.statut = input.statut
  if (input.start_time !== undefined) update.start_time = input.start_time || null
  if (input.end_time !== undefined) update.end_time = input.end_time || null
  if (input.duration_hours !== undefined) update.duration_hours = normalizeHours(input.duration_hours)
  if (input.rapport !== undefined) update.rapport = input.rapport?.trim() ?? null
  if (input.observations !== undefined) update.observations = input.observations?.trim() ?? null
  if (input.billable_notes !== undefined) update.billable_notes = input.billable_notes?.trim() ?? null
  if (input.billable_amount_ht !== undefined) update.billable_amount_ht = normalizeMoneyOrNull(input.billable_amount_ht)
  if (input.billable_vat_rate !== undefined) update.billable_vat_rate = coerceLegalVatRate(input.billable_vat_rate, 20)
  if (input.cost_parts_ht !== undefined) update.cost_parts_ht = normalizeMoney(input.cost_parts_ht)
  if (input.cost_travel_ht !== undefined) update.cost_travel_ht = normalizeMoney(input.cost_travel_ht)
  if (input.cost_other_ht !== undefined) update.cost_other_ht = normalizeMoney(input.cost_other_ht)
  if (input.invoice_id !== undefined) update.invoice_id = input.invoice_id

  const { error } = await supabase
    .from('maintenance_interventions')
    .update(update)
    .eq('id', interventionId)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }

  const productionError = await syncInterventionProduction(interventionId, orgId)
  if (productionError) return { error: productionError }

  revalidatePath('/chantiers/entretien')
  return { error: null }
}

export async function deleteIntervention(interventionId: string): Promise<Result> {
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable' }

  const supabase = await createClient()
  const { data: intervention } = await supabase
    .from('maintenance_interventions')
    .select('chantier_pointage_id, contract:maintenance_contracts(chantier_id)')
    .eq('id', interventionId)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (intervention?.chantier_pointage_id) {
    await supabase.from('chantier_pointages').delete().eq('id', intervention.chantier_pointage_id)
  }
  await supabase.from('chantier_pointages').delete().eq('maintenance_intervention_id', interventionId)
  await supabase.from('chantier_expenses').delete().eq('maintenance_intervention_id', interventionId)

  const { error } = await supabase
    .from('maintenance_interventions')
    .delete()
    .eq('id', interventionId)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }

  const chantierId = Array.isArray((intervention as any)?.contract)
    ? (intervention as any).contract[0]?.chantier_id
    : (intervention as any)?.contract?.chantier_id
  revalidatePath('/chantiers/entretien')
  if (chantierId) revalidatePath(`/chantiers/${chantierId}`)
  return { error: null }
}

export async function uploadMaintenanceInterventionPhoto(
  interventionId: string,
  formData: FormData,
): Promise<{
  error: string | null
  photo?: { id: string; storage_path: string; title: string | null; caption: string | null; url: string | null }
}> {
  const denied = await requirePermission('chantiers.edit')
  if (denied) return { error: denied }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }

  const { data: intervention } = await supabase
    .from('maintenance_interventions')
    .select('id, organization_id, maintenance_contract_id, contract:maintenance_contracts!inner(chantier_id)')
    .eq('id', interventionId)
    .eq('organization_id', orgId)
    .single()

  if (!intervention) return { error: 'Intervention introuvable.' }

  const contract = Array.isArray((intervention as any).contract) ? (intervention as any).contract[0] : (intervention as any).contract
  const chantierId = contract?.chantier_id
  if (!chantierId) return { error: "Le contrat doit être rattaché à un chantier pour ajouter des photos." }

  const file = formData.get('file') as File | null
  if (!file) return { error: 'Aucun fichier fourni.' }

  const title = ((formData.get('title') as string | null) ?? '').trim() || null
  const caption = ((formData.get('caption') as string | null) ?? '').trim() || null
  const ext = file.name.split('.').pop() ?? 'jpg'
  const path = `${orgId}/${chantierId}/maintenance-${interventionId}-${Date.now()}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('chantier-photos')
    .upload(path, file, { upsert: false })

  if (uploadError) {
    console.error('[uploadMaintenanceInterventionPhoto]', uploadError)
    return { error: "Erreur lors de l'upload de la photo." }
  }

  const { data: inserted, error: insertError } = await supabase
    .from('chantier_photos')
    .insert({
      chantier_id: chantierId,
      maintenance_intervention_id: interventionId,
      uploaded_by: user.id,
      storage_path: path,
      title,
      caption,
      include_in_report: true,
    })
    .select('id, storage_path, title, caption')
    .single()

  if (insertError || !inserted) {
    await supabase.storage.from('chantier-photos').remove([path])
    return { error: "Erreur lors de l'enregistrement de la photo." }
  }

  const { data: signedData } = await supabase.storage.from('chantier-photos').createSignedUrl(path, 3600)

  revalidatePath('/chantiers/entretien')
  return {
    error: null,
    photo: {
      id: inserted.id,
      storage_path: inserted.storage_path,
      title: inserted.title ?? null,
      caption: inserted.caption ?? null,
      url: signedData?.signedUrl ?? null,
    },
  }
}

export async function billMaintenanceIntervention(
  interventionId: string,
  invoiceId?: string | null,
): Promise<{ invoiceId: string | null; error: string | null }> {
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { invoiceId: null, error: 'Organisation introuvable' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { invoiceId: null, error: 'Non authentifié' }

  const { data: intervention, error: ivError } = await supabase
    .from('maintenance_interventions')
    .select(`
      id, date_intervention, statut, rapport, observations, billable_notes,
      billable_amount_ht, billable_vat_rate, invoice_id,
      contract:maintenance_contracts(id, title, client_id, chantier_id, montant_ht, vat_rate)
    `)
    .eq('id', interventionId)
    .eq('organization_id', orgId)
    .single()

  if (ivError || !intervention) return { invoiceId: null, error: 'Intervention introuvable.' }
  if (intervention.invoice_id) return { invoiceId: intervention.invoice_id, error: null }

  const contract = Array.isArray((intervention as any).contract)
    ? (intervention as any).contract[0]
    : (intervention as any).contract
  if (!contract?.client_id) return { invoiceId: null, error: 'Un client est obligatoire pour facturer une intervention.' }
  if (!contract?.chantier_id) return { invoiceId: null, error: 'Le contrat doit être rattaché à un chantier maintenance.' }

  const amountHt = normalizeMoneyOrNull((intervention as any).billable_amount_ht) ?? normalizeMoneyOrNull(contract.montant_ht) ?? 0
  const vatRate = coerceLegalVatRate((intervention as any).billable_vat_rate ?? contract.vat_rate, 20)
  const description = ((intervention as any).billable_notes as string | null)?.trim()
    || `Intervention d'entretien - ${contract.title} - ${formatDateFr((intervention as any).date_intervention)}`
  const targetInvoiceId = invoiceId || await createMaintenanceInvoiceDraft(supabase, {
    orgId,
    userId: user.id,
    clientId: contract.client_id,
    chantierId: contract.chantier_id,
    title: `Intervention entretien - ${contract.title}`,
    amountHt,
    vatRate,
    description,
  })

  if (!targetInvoiceId) return { invoiceId: null, error: 'Erreur lors de la création de la facture.' }

  if (invoiceId) {
    const addError = await addMaintenanceLineToInvoice(supabase, orgId, targetInvoiceId, description, amountHt, vatRate)
    if (addError) return { invoiceId: null, error: addError }
  }

  const { error: updateError } = await supabase
    .from('maintenance_interventions')
    .update({ invoice_id: targetInvoiceId, billed_at: new Date().toISOString() })
    .eq('id', interventionId)
    .eq('organization_id', orgId)

  if (updateError) return { invoiceId: null, error: updateError.message }

  revalidatePath('/chantiers/entretien')
  revalidatePath('/finances')
  return { invoiceId: targetInvoiceId, error: null }
}

// ─── Helpers privés ───────────────────────────────────────────────────────────

async function updateNextIntervention(contractId: string, orgId: string, date: string) {
  const supabase = await createClient()
  await supabase
    .from('maintenance_contracts')
    .update({ prochaine_intervention: date })
    .eq('id', contractId)
    .eq('organization_id', orgId)
}

async function ensureMaintenanceChantierForContract(
  contractId: string,
  orgId: string,
  userId: string | null,
): Promise<string | null> {
  const supabase = await createClient()
  const { data: contract, error } = await supabase
    .from('maintenance_contracts')
    .select(`
      id, client_id, chantier_id, source_quote_id, title, description,
      site_name, site_contact_name, site_contact_email, site_contact_phone,
      site_address_line1, site_postal_code, site_city,
      period_cost_labor_ht, period_cost_parts_ht, period_cost_travel_ht, period_cost_other_ht,
      status, date_debut, date_fin, montant_ht, created_by,
      client:clients(address_line1, postal_code, city)
    `)
    .eq('id', contractId)
    .eq('organization_id', orgId)
    .single()

  if (error || !contract) return error?.message ?? 'Contrat introuvable.'

  const client = Array.isArray((contract as any).client) ? (contract as any).client[0] : (contract as any).client

  if ((contract as any).chantier_id) {
    const { error: markError } = await supabase
      .from('chantiers')
      .update({
        status: maintenanceChantierStatus((contract as any).status),
        is_maintenance: true,
        maintenance_contract_id: contractId,
        quote_id: (contract as any).source_quote_id ?? null,
        client_id: (contract as any).client_id ?? null,
        address_line1: (contract as any).site_address_line1 ?? client?.address_line1 ?? null,
        postal_code: (contract as any).site_postal_code ?? client?.postal_code ?? null,
        city: (contract as any).site_city ?? client?.city ?? null,
      })
      .eq('id', (contract as any).chantier_id)
      .eq('organization_id', orgId)
    return markError?.message ?? null
  }

  if ((contract as any).source_quote_id) {
    const { data: existingFromQuote } = await supabase
      .from('chantiers')
      .select('id')
      .eq('organization_id', orgId)
      .eq('quote_id', (contract as any).source_quote_id)
      .maybeSingle()
    if (existingFromQuote?.id) {
      const { error: linkExistingError } = await supabase
        .from('maintenance_contracts')
        .update({ chantier_id: existingFromQuote.id })
        .eq('id', contractId)
        .eq('organization_id', orgId)
      if (linkExistingError) return linkExistingError.message
      const { error: markExistingError } = await supabase
        .from('chantiers')
        .update({
          status: maintenanceChantierStatus((contract as any).status),
          is_maintenance: true,
          maintenance_contract_id: contractId,
          client_id: (contract as any).client_id ?? null,
          address_line1: (contract as any).site_address_line1 ?? client?.address_line1 ?? null,
          postal_code: (contract as any).site_postal_code ?? client?.postal_code ?? null,
          city: (contract as any).site_city ?? client?.city ?? null,
        })
        .eq('id', existingFromQuote.id)
        .eq('organization_id', orgId)
      return markExistingError?.message ?? null
    }
  }

  const { data: chantier, error: chantierError } = await supabase
    .from('chantiers')
    .insert({
      organization_id: orgId,
      quote_id: (contract as any).source_quote_id ?? null,
      client_id: (contract as any).client_id ?? null,
      title: maintenanceRecurringTitle((contract as any).title),
      description: (contract as any).description ?? null,
      status: ['résilié', 'terminé'].includes((contract as any).status) ? 'termine' : 'en_cours',
      address_line1: (contract as any).site_address_line1 ?? client?.address_line1 ?? null,
      postal_code: (contract as any).site_postal_code ?? client?.postal_code ?? null,
      city: (contract as any).site_city ?? client?.city ?? null,
      start_date: (contract as any).date_debut ?? null,
      end_date: (contract as any).date_fin ?? null,
      budget_ht: (contract as any).montant_ht ?? 0,
      is_maintenance: true,
      maintenance_contract_id: contractId,
      created_by: userId ?? (contract as any).created_by ?? null,
    })
    .select('id')
    .single()

  if (chantierError || !chantier) return chantierError?.message ?? 'Erreur création chantier entretien.'

  const { error: linkError } = await supabase
    .from('maintenance_contracts')
    .update({ chantier_id: chantier.id })
    .eq('id', contractId)
    .eq('organization_id', orgId)

  return linkError?.message ?? null
}

async function syncInterventionProduction(interventionId: string, orgId: string): Promise<string | null> {
  const supabase = await createClient()
  const { data: intervention, error } = await supabase
    .from('maintenance_interventions')
    .select(`
      id, date_intervention, statut,
      intervenant_user_id, intervenant_member_id, start_time, duration_hours,
      rapport, observations, chantier_pointage_id,
      cost_parts_ht, cost_travel_ht, cost_other_ht,
      contract:maintenance_contracts(chantier_id, title)
    `)
    .eq('id', interventionId)
    .eq('organization_id', orgId)
    .single()

  if (error || !intervention) return error?.message ?? 'Intervention introuvable.'
  const contract = Array.isArray((intervention as any).contract)
    ? (intervention as any).contract[0]
    : (intervention as any).contract
  const chantierId = contract?.chantier_id
  if (!chantierId) return null

  const duration = normalizeHours((intervention as any).duration_hours)
  const hasPerson = Boolean((intervention as any).intervenant_user_id || (intervention as any).intervenant_member_id)
  if ((intervention as any).statut === 'réalisée' && duration && hasPerson) {
    const rateSnapshot = await resolvePointageRate(
      supabase,
      orgId,
      (intervention as any).intervenant_user_id ?? null,
      (intervention as any).intervenant_member_id ?? null,
    )
    const pointagePayload = {
      chantier_id: chantierId,
      user_id: (intervention as any).intervenant_user_id ?? null,
      member_id: (intervention as any).intervenant_member_id ?? null,
      date: (intervention as any).date_intervention,
      hours: duration,
      description: buildPointageDescription(intervention as any, contract.title),
      start_time: (intervention as any).start_time ?? null,
      rate_snapshot: rateSnapshot,
      maintenance_intervention_id: interventionId,
    }

    const existingPointageId = (intervention as any).chantier_pointage_id
      || await findPointageForIntervention(supabase, interventionId)
    if (existingPointageId) {
      const { error: ptError } = await supabase
        .from('chantier_pointages')
        .update(pointagePayload)
        .eq('id', existingPointageId)
      if (ptError) return ptError.message
      if (!(intervention as any).chantier_pointage_id) {
        await supabase.from('maintenance_interventions').update({ chantier_pointage_id: existingPointageId }).eq('id', interventionId)
      }
    } else {
      const { data: inserted, error: ptError } = await supabase
        .from('chantier_pointages')
        .insert(pointagePayload)
        .select('id')
        .single()
      if (ptError || !inserted) return ptError?.message ?? 'Erreur création pointage.'
      await supabase.from('maintenance_interventions').update({ chantier_pointage_id: inserted.id }).eq('id', interventionId)
    }
  } else {
    const existingPointageId = (intervention as any).chantier_pointage_id
      || await findPointageForIntervention(supabase, interventionId)
    if (existingPointageId) {
      await supabase.from('chantier_pointages').delete().eq('id', existingPointageId)
      await supabase.from('maintenance_interventions').update({ chantier_pointage_id: null }).eq('id', interventionId)
    }
  }

  await syncInterventionExpenses(supabase, orgId, chantierId, intervention as any)
  revalidatePath(`/chantiers/${chantierId}`)
  revalidatePath('/chantiers/heures')
  return null
}

async function syncInterventionExpenses(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  orgId: string,
  chantierId: string,
  intervention: Record<string, any>,
) {
  await supabase.from('chantier_expenses').delete().eq('maintenance_intervention_id', intervention.id)
  if (intervention.statut !== 'réalisée') return

  const rows = [
    { category: 'materiel', label: 'Pièces entretien', amount: normalizeMoney(intervention.cost_parts_ht) },
    { category: 'transport', label: 'Déplacement entretien', amount: normalizeMoney(intervention.cost_travel_ht) },
    { category: 'autre', label: 'Autres coûts entretien', amount: normalizeMoney(intervention.cost_other_ht) },
  ].filter(row => row.amount > 0)

  if (!rows.length) return
  await supabase.from('chantier_expenses').insert(rows.map(row => ({
    organization_id: orgId,
    chantier_id: chantierId,
    maintenance_intervention_id: intervention.id,
    category: row.category,
    label: row.label,
    amount_ht: row.amount,
    vat_rate: 20,
    expense_date: intervention.date_intervention,
    notes: buildPointageDescription(intervention, 'Entretien'),
  })))
}

async function findPointageForIntervention(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  interventionId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('chantier_pointages')
    .select('id')
    .eq('maintenance_intervention_id', interventionId)
    .maybeSingle()
  return data?.id ?? null
}

async function resolvePointageRate(
  supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>,
  orgId: string,
  userId: string | null,
  memberId: string | null,
): Promise<number | null> {
  const [orgRes, membershipRes, membreRes] = await Promise.all([
    supabase
      .from('organizations')
      .select('default_labor_cost_per_hour, default_hourly_rate')
      .eq('id', orgId)
      .single(),
    userId
      ? supabase
          .from('memberships')
          .select('labor_cost_per_hour')
          .eq('organization_id', orgId)
          .eq('user_id', userId)
          .single()
      : Promise.resolve({ data: null }),
    memberId
      ? supabase
          .from('chantier_equipe_membres')
          .select('taux_horaire')
          .eq('id', memberId)
          .single()
      : Promise.resolve({ data: null }),
  ])

  const orgFallback: number | null =
    orgRes.data?.default_labor_cost_per_hour
    ?? (orgRes.data?.default_hourly_rate ? orgRes.data.default_hourly_rate * 0.5 : null)

  if (memberId) return (membreRes.data as any)?.taux_horaire ?? orgFallback
  if (userId) return (membershipRes.data as any)?.labor_cost_per_hour ?? orgFallback
  return orgFallback
}

async function createMaintenanceInvoiceDraft(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  input: {
    orgId: string
    userId: string
    clientId: string
    chantierId: string
    title: string
    description: string
    amountHt: number
    vatRate: number
  },
): Promise<string | null> {
  const totalTva = roundMoney(input.amountHt * (input.vatRate / 100))
  const { data: invoice, error } = await supabase
    .from('invoices')
    .insert({
      organization_id: input.orgId,
      client_id: input.clientId,
      chantier_id: input.chantierId,
      title: input.title,
      currency: 'EUR',
      status: 'draft',
      invoice_type: 'standard',
      generation_source: 'maintenance_intervention',
      issue_date: todayParis(),
      due_date: todayParis(),
      total_ht: input.amountHt,
      total_tva: totalTva,
      total_ttc: roundMoney(input.amountHt + totalTva),
      created_by: input.userId,
    })
    .select('id')
    .single()
  if (error || !invoice) return null

  await supabase.from('invoice_items').insert({
    invoice_id: invoice.id,
    description: input.description,
    quantity: 1,
    unit: 'forfait',
    unit_price: input.amountHt,
    vat_rate: input.vatRate,
    position: 0,
  })
  return invoice.id
}

async function addMaintenanceLineToInvoice(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  orgId: string,
  invoiceId: string,
  description: string,
  amountHt: number,
  vatRate: number,
): Promise<string | null> {
  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, status')
    .eq('id', invoiceId)
    .eq('organization_id', orgId)
    .single()
  if (!invoice) return 'Facture introuvable.'
  if (invoice.status !== 'draft') return 'Seules les factures brouillon peuvent être complétées.'

  const { count } = await supabase
    .from('invoice_items')
    .select('id', { count: 'exact', head: true })
    .eq('invoice_id', invoiceId)

  const { error } = await supabase.from('invoice_items').insert({
    invoice_id: invoiceId,
    description,
    quantity: 1,
    unit: 'forfait',
    unit_price: amountHt,
    vat_rate: vatRate,
    position: count ?? 0,
  })
  if (error) return error.message
  await recalculateInvoiceTotals(supabase, orgId, invoiceId)
  return null
}

async function recalculateInvoiceTotals(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  orgId: string,
  invoiceId: string,
) {
  const { data: items } = await supabase
    .from('invoice_items')
    .select('quantity, unit_price, vat_rate, is_internal')
    .eq('invoice_id', invoiceId)
  const clientItems = (items ?? []).filter((i: any) => !i.is_internal)
  const totalHt = roundMoney(clientItems.reduce((s: number, i: any) => s + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0))
  const totalTva = roundMoney(clientItems.reduce((s: number, i: any) => s + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0) * ((Number(i.vat_rate) || 0) / 100), 0))
  await supabase
    .from('invoices')
    .update({ total_ht: totalHt, total_tva: totalTva, total_ttc: roundMoney(totalHt + totalTva) })
    .eq('id', invoiceId)
    .eq('organization_id', orgId)
}

function getRecurringFrequency(frequence: MaintenanceFrequence): string {
  switch (frequence) {
    case 'mensuelle':
      return 'monthly'
    case 'trimestrielle':
      return 'quarterly'
    case 'bimestrielle':
    case 'semestrielle':
    case 'annuelle':
    case 'sur_demande':
      return 'custom'
  }
}

function maintenanceChantierStatus(status: MaintenanceStatus): 'en_cours' | 'suspendu' | 'termine' {
  if (status === 'suspendu') return 'suspendu'
  if (status === 'résilié' || status === 'terminé') return 'termine'
  return 'en_cours'
}

function getRecurringCustomDays(frequence: MaintenanceFrequence): number | null {
  switch (frequence) {
    case 'bimestrielle':
      return 60
    case 'semestrielle':
      return 183
    case 'annuelle':
    case 'sur_demande':
      return 365
    case 'mensuelle':
    case 'trimestrielle':
      return null
  }
}

async function createRecurringFromContract(
  contractId: string,
  orgId: string,
  userId: string | null,
  input: MaintenanceContractInput,
): Promise<string | null> {
  if (!input.client_id || !input.montant_ht) return 'Paramètres de facturation récurrente incomplets.'

  const supabase = await createClient()
  const frequency = getRecurringFrequency(input.frequence)
  const customDays = getRecurringCustomDays(input.frequence)
  const nextSendDate = input.prochaine_intervention ?? input.date_debut ?? todayParis()
  const title = maintenanceRecurringTitle(input.title)
  const label = maintenanceContractLabel(input.title)

  const { data: rec, error: recError } = await supabase
    .from('recurring_invoices')
    .insert({
      organization_id: orgId,
      created_by: userId,
      client_id: input.client_id,
      title,
      frequency,
      custom_interval_days: customDays,
      next_send_date: nextSendDate,
      requires_confirmation: true,
      confirmation_delay_days: 3,
      auto_send_delay_days: normalizeAutoSendDelay(input.auto_send_delay_days),
      base_amount_ht: input.montant_ht,
      is_active: true,
    })
    .select('id')
    .single()

  if (recError || !rec) return recError?.message ?? 'Erreur lors de la création de la facturation récurrente.'

  const { error: itemError } = await supabase.from('recurring_invoice_items').insert({
    recurring_invoice_id: rec.id,
    description: `Contrat d'entretien - ${label}`,
    quantity: 1,
    unit: 'forfait',
    unit_price: input.montant_ht,
    vat_rate: input.vat_rate ?? 20,
    position: 0,
  })
  if (itemError) return itemError.message

  const { error: linkError } = await supabase
    .from('maintenance_contracts')
    .update({ recurring_invoice_id: rec.id })
    .eq('id', contractId)
    .eq('organization_id', orgId)
  return linkError?.message ?? null
}

async function syncRecurringInvoiceFromContract(contractId: string, orgId: string) {
  const supabase = await createClient()
  const { data: contract } = await supabase
    .from('maintenance_contracts')
    .select('id, title, montant_ht, vat_rate, recurring_invoice_id, facturation_auto, auto_send_delay_days')
    .eq('id', contractId)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!contract?.recurring_invoice_id || !contract.facturation_auto || !contract.montant_ht) return
  const title = maintenanceRecurringTitle(contract.title)
  const label = maintenanceContractLabel(contract.title)

  await supabase
    .from('recurring_invoices')
    .update({
      title,
      base_amount_ht: contract.montant_ht,
      auto_send_delay_days: normalizeAutoSendDelay((contract as any).auto_send_delay_days),
    })
    .eq('id', contract.recurring_invoice_id)
    .eq('organization_id', orgId)

  const { data: item } = await supabase
    .from('recurring_invoice_items')
    .select('id')
    .eq('recurring_invoice_id', contract.recurring_invoice_id)
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle()

  const row = {
    recurring_invoice_id: contract.recurring_invoice_id,
    description: `Contrat d'entretien - ${label}`,
    quantity: 1,
    unit: 'forfait',
    unit_price: contract.montant_ht,
    vat_rate: contract.vat_rate ?? 20,
    position: 0,
  }

  if (item?.id) {
    await supabase.from('recurring_invoice_items').update(row).eq('id', item.id)
  } else {
    await supabase.from('recurring_invoice_items').insert(row)
  }
}

function buildPointageDescription(intervention: Record<string, any>, contractTitle: string) {
  const base = maintenanceRecurringTitle(contractTitle)
  const detail = intervention.rapport || intervention.observations
  return detail ? `${base} - ${String(detail).slice(0, 180)}` : base
}

function maintenanceRecurringTitle(rawTitle: string | null | undefined) {
  return `Entretien - ${maintenanceContractLabel(rawTitle)}`
}

function maintenanceContractLabel(rawTitle: string | null | undefined) {
  const title = (rawTitle ?? '').trim() || 'Contrat'
  const label = title
    .replace(/^entretien\s*[—-]\s*/i, '')
    .replace(/^contrat d['’]entretien\s*[—-]\s*/i, '')
    .trim()
  return label || 'Contrat'
}

function normalizeMoney(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return 0
  return roundMoney(n)
}

function normalizeAutoSendDelay(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n)
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeMoneyOrNull(value: unknown): number | null {
  const n = normalizeMoney(value)
  return n > 0 ? n : null
}

function normalizeHours(value: unknown): number | null {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n * 100) / 100
}

function roundMoney(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100
}

function formatDateFr(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString('fr-FR')
}
