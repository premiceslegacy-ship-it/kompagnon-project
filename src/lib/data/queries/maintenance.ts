'use server'

import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from './clients'
import { hasPermission } from '@/lib/data/queries/membership'

// ─── Types ────────────────────────────────────────────────────────────────────

export type MaintenanceStatus = 'actif' | 'suspendu' | 'résilié' | 'terminé'
export type MaintenanceFrequence = 'mensuelle' | 'bimestrielle' | 'trimestrielle' | 'semestrielle' | 'annuelle' | 'sur_demande'
export type InterventionStatut = 'planifiée' | 'réalisée' | 'annulée'

export type Equipement = {
  nom: string
  ref?: string
  localisation?: string
}

export type MaintenanceContract = {
  id: string
  organization_id: string
  client_id: string | null
  chantier_id: string | null
  source_quote_id: string | null
  site_name: string | null
  site_contact_name: string | null
  site_contact_email: string | null
  site_contact_phone: string | null
  site_address_line1: string | null
  site_postal_code: string | null
  site_city: string | null
  period_cost_labor_ht: number
  period_cost_parts_ht: number
  period_cost_travel_ht: number
  period_cost_other_ht: number
  title: string
  description: string | null
  status: MaintenanceStatus
  equipements: Equipement[]
  frequence: MaintenanceFrequence
  montant_ht: number | null
  vat_rate: number
  facturation_auto: boolean
  auto_send_delay_days: number | null
  recurring_invoice_id: string | null
  date_debut: string | null
  date_fin: string | null
  prochaine_intervention: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  client: {
    id: string
    company_name: string | null
    first_name: string | null
    last_name: string | null
    email: string | null
  } | null
  chantier: { id: string; title: string } | null
  interventions_count: number
}

export type MaintenanceIntervention = {
  id: string
  maintenance_contract_id: string
  organization_id: string
  date_intervention: string
  intervenant_id: string | null
  intervenant_user_id: string | null
  intervenant_member_id: string | null
  statut: InterventionStatut
  start_time: string | null
  end_time: string | null
  duration_hours: number | null
  rapport: string | null
  observations: string | null
  billable_notes: string | null
  billable_amount_ht: number | null
  billable_vat_rate: number
  cost_parts_ht: number
  cost_travel_ht: number
  cost_other_ht: number
  invoice_id: string | null
  billed_at: string | null
  chantier_pointage_id: string | null
  hours_logged: number
  labor_cost_ht: number
  created_by: string | null
  created_at: string
  intervenant: { id: string; prenom: string | null; name: string; profile_id?: string | null } | null
  intervenant_profile: { id: string; full_name: string | null; email: string | null } | null
  invoice: { id: string; number: string | null; status?: string | null; total_ht?: number | null } | null
  photos?: MaintenanceInterventionPhoto[]
}

export type MaintenanceContractExpense = {
  id: string
  expense_date: string
  amount_ht: number
  category: string
  label: string
  maintenance_intervention_id: string | null
}

export type RecurringInvoiceInstance = {
  id: string
  invoice_id: string | null
  scheduled_date: string
  status: string
  amount_ht: number
  invoice_status: string | null
  invoice_total_ht: number | null
}

export type MaintenanceInterventionPhoto = {
  id: string
  storage_path: string
  title: string | null
  caption: string | null
  url: string | null
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function fetchMaintenanceContracts(): Promise<MaintenanceContract[]> {
  if (!await hasPermission('chantiers.view')) return []

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('maintenance_contracts')
    .select(`
      *,
      client:clients(id, company_name, first_name, last_name, email),
      chantier:chantiers!maintenance_contracts_chantier_id_fkey(id, title),
      interventions_count:maintenance_interventions(count)
    `)
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('fetchMaintenanceContracts error:', error)
    return []
  }

  return (data ?? []).map((row) => ({
    ...row,
    equipements: Array.isArray(row.equipements) ? row.equipements : [],
    interventions_count: (row.interventions_count as unknown as { count: number }[])?.[0]?.count ?? 0,
  }))
}

export async function fetchMaintenanceContractDetail(contractId: string): Promise<{
  contract: MaintenanceContract | null
  interventions: MaintenanceIntervention[]
  expenses: MaintenanceContractExpense[]
  recurringInstances: RecurringInvoiceInstance[]
}> {
  if (!await hasPermission('chantiers.view')) return { contract: null, interventions: [], expenses: [], recurringInstances: [] }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { contract: null, interventions: [], expenses: [], recurringInstances: [] }

  const supabase = await createClient()

  const [contractRes, interventionsRes] = await Promise.all([
    supabase
      .from('maintenance_contracts')
      .select(`
        *,
        client:clients(id, company_name, first_name, last_name, email),
        chantier:chantiers!maintenance_contracts_chantier_id_fkey(id, title),
        interventions_count:maintenance_interventions(count)
      `)
      .eq('id', contractId)
      .eq('organization_id', orgId)
      .single(),
    supabase
      .from('maintenance_interventions')
      .select(`
        *,
        intervenant:chantier_equipe_membres!maintenance_interventions_intervenant_member_id_fkey(id, prenom, name, profile_id),
        intervenant_profile:profiles!maintenance_interventions_intervenant_user_id_fkey(id, full_name, email),
        invoice:invoices(id, number, status, total_ht)
      `)
      .eq('maintenance_contract_id', contractId)
      .eq('organization_id', orgId)
      .order('date_intervention', { ascending: false }),
  ])

  if (contractRes.error) {
    console.error('fetchMaintenanceContractDetail error:', contractRes.error)
    return { contract: null, interventions: [], expenses: [], recurringInstances: [] }
  }

  const contract = {
    ...contractRes.data,
    equipements: Array.isArray(contractRes.data.equipements) ? contractRes.data.equipements : [],
    interventions_count: (contractRes.data.interventions_count as unknown as { count: number }[])?.[0]?.count ?? 0,
  } as MaintenanceContract

  const rawInterventions = (interventionsRes.data ?? []) as MaintenanceIntervention[]
  const interventionIds = rawInterventions.map(iv => iv.id)
  const pointageByIntervention: Record<string, { hours: number; cost: number }> = {}
  const photosByIntervention: Record<string, MaintenanceInterventionPhoto[]> = {}

  if (interventionIds.length > 0) {
    const [{ data: pointages }, { data: photoRows }] = await Promise.all([
      supabase
        .from('chantier_pointages')
        .select('maintenance_intervention_id, hours, rate_snapshot')
        .in('maintenance_intervention_id', interventionIds),
      supabase
        .from('chantier_photos')
        .select('id, maintenance_intervention_id, storage_path, title, caption')
        .in('maintenance_intervention_id', interventionIds)
        .order('created_at', { ascending: true }),
    ])

    for (const p of pointages ?? []) {
      const key = (p as any).maintenance_intervention_id
      if (!key) continue
      const hours = Number((p as any).hours ?? 0)
      const rate = Number((p as any).rate_snapshot ?? 0)
      pointageByIntervention[key] ??= { hours: 0, cost: 0 }
      pointageByIntervention[key].hours += hours
      pointageByIntervention[key].cost += hours * rate
    }

    const paths = (photoRows ?? []).map((p: any) => p.storage_path).filter(Boolean)
    const urlMap = new Map<string, string>()
    if (paths.length > 0) {
      const { data: signed } = await supabase.storage.from('chantier-photos').createSignedUrls(paths, 3600)
      signed?.forEach(item => { if (item.path && item.signedUrl) urlMap.set(item.path, item.signedUrl) })
    }

    for (const photo of photoRows ?? []) {
      const key = (photo as any).maintenance_intervention_id
      if (!key) continue
      const path = (photo as any).storage_path
      photosByIntervention[key] ??= []
      photosByIntervention[key].push({
        id: (photo as any).id,
        storage_path: path,
        title: (photo as any).title ?? null,
        caption: (photo as any).caption ?? null,
        url: urlMap.get(path) ?? null,
      })
    }
  }

  let expenses: MaintenanceContractExpense[] = []
  if (contract.chantier_id) {
    const { data: expenseRows } = await supabase
      .from('chantier_expenses')
      .select('id, expense_date, amount_ht, category, label, maintenance_intervention_id')
      .eq('chantier_id', contract.chantier_id)
      .order('expense_date', { ascending: false })

    expenses = (expenseRows ?? []) as MaintenanceContractExpense[]
  }

  // Instances de facturation récurrente (une par période)
  let recurringInstances: RecurringInvoiceInstance[] = []
  if (contract.recurring_invoice_id) {
    const { data: schedules } = await supabase
      .from('invoice_schedules')
      .select('id, invoice_id, scheduled_date, status, amount_ht, invoice:invoices(status, total_ht)')
      .eq('recurring_invoice_id', contract.recurring_invoice_id)
      .order('scheduled_date', { ascending: false })

    recurringInstances = (schedules ?? []).map((s: any) => {
      const inv = Array.isArray(s.invoice) ? s.invoice[0] : s.invoice
      return {
        id: s.id,
        invoice_id: s.invoice_id,
        scheduled_date: s.scheduled_date,
        status: s.status,
        amount_ht: s.amount_ht ?? 0,
        invoice_status: inv?.status ?? null,
        invoice_total_ht: inv?.total_ht ?? null,
      }
    })
  }

  return {
    contract,
    interventions: rawInterventions.map(iv => ({
      ...iv,
      hours_logged: pointageByIntervention[iv.id]?.hours ?? 0,
      labor_cost_ht: pointageByIntervention[iv.id]?.cost ?? 0,
      photos: photosByIntervention[iv.id] ?? [],
    })),
    expenses,
    recurringInstances,
  }
}
