import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from './clients'

export type ChantierExpense = {
  id: string
  chantier_id: string
  category: 'materiel' | 'sous_traitance' | 'location' | 'transport' | 'autre'
  label: string
  amount_ht: number
  vat_rate: number
  expense_date: string
  supplier_name: string | null
  received_invoice_id: string | null
  receipt_storage_path: string | null
  notes: string | null
  created_by: string | null
  created_at: string
}

export type LaborByMemberEntry = {
  user_id: string | null
  member_id: string | null   // pour les membres fantômes (sans compte auth)
  membership_id: string
  full_name: string | null
  hours: number
  ratePerHour: number | null
  cost: number
}

export type ChantierProfitability = {
  budgetHt: number
  revenueHt: number           // factures émises liées au devis
  costMaterial: number        // dépenses catégorie materiel
  costLabor: number           // somme des coûts par membre
  costSubcontract: number     // sous_traitance
  costOther: number           // location + transport + autre
  costTotal: number
  marginEur: number           // revenueHt - costTotal
  marginPct: number           // marginEur / revenueHt (0 si revenue = 0)
  hoursLogged: number
  expenses: ChantierExpense[]
  laborByMember: LaborByMemberEntry[]
}

export async function getChantierProfitability(chantierId: string): Promise<ChantierProfitability | null> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return null

  // 1. Budget + devis lié
  const { data: chantier } = await supabase
    .from('chantiers')
    .select('budget_ht, quote_id, organization_id')
    .eq('id', chantierId)
    .eq('organization_id', orgId)
    .single()

  if (!chantier) return null

  // 2. Taux horaire org (fallback si membre sans taux défini)
  const { data: org } = await supabase
    .from('organizations')
    .select('default_labor_cost_per_hour, default_hourly_rate')
    .eq('id', orgId)
    .single()

  const orgFallback: number | null = org?.default_labor_cost_per_hour
    ?? (org?.default_hourly_rate ? org.default_hourly_rate * 0.5 : null)

  // 3. Heures par membre + taux individuels
  const { data: pointages } = await supabase
    .from('chantier_pointages')
    .select('user_id, member_id, hours')
    .eq('chantier_id', chantierId)

  // Agréger heures par user_id (auth) ou member_id (fantôme)
  const hoursByUser: Record<string, number> = {}   // clé = user_id
  const hoursByMember: Record<string, number> = {} // clé = member_id
  for (const p of pointages ?? []) {
    if (p.user_id) {
      hoursByUser[p.user_id] = (hoursByUser[p.user_id] ?? 0) + (p.hours ?? 0)
    } else if (p.member_id) {
      hoursByMember[p.member_id] = (hoursByMember[p.member_id] ?? 0) + (p.hours ?? 0)
    }
  }
  const userIds   = Object.keys(hoursByUser)
  const memberIds = Object.keys(hoursByMember)

  // Fetch taux membership + noms pour les users auth
  // + taux horaire des membres d'équipe assignés à ce chantier (profile_id → taux_horaire)
  // + noms + taux des membres fantômes
  const [membershipsRes, profilesRes, equipesMembresRes, fantomeMembresRes] = await Promise.all([
    userIds.length > 0
      ? supabase.from('memberships')
          .select('id, user_id, labor_cost_per_hour')
          .eq('organization_id', orgId)
          .in('user_id', userIds)
      : Promise.resolve({ data: [] as Array<{ id: string; user_id: string; labor_cost_per_hour: number | null }> }),
    userIds.length > 0
      ? supabase.from('profiles')
          .select('id, full_name')
          .in('id', userIds)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string | null }> }),
    supabase
      .from('chantier_equipe_chantiers')
      .select('equipe:chantier_equipes(membres:chantier_equipe_membres(profile_id, taux_horaire))')
      .eq('chantier_id', chantierId),
    memberIds.length > 0
      ? supabase.from('chantier_equipe_membres')
          .select('id, prenom, name, taux_horaire')
          .in('id', memberIds)
      : Promise.resolve({ data: [] as Array<{ id: string; prenom: string | null; name: string; taux_horaire: number | null }> }),
  ])

  // Taux horaire par user_id depuis les membres d'équipe du chantier (profile_id → taux_horaire)
  const equipeTauxByUserId: Record<string, number> = {}
  for (const row of (equipesMembresRes.data ?? []) as any[]) {
    for (const m of (row.equipe?.membres ?? [])) {
      if (m.profile_id && m.taux_horaire != null) {
        equipeTauxByUserId[m.profile_id] = m.taux_horaire
      }
    }
  }

  const memberRateMap: Record<string, { membership_id: string; rate: number | null }> = {}
  for (const m of (membershipsRes.data ?? []) as Array<{ id: string; user_id: string; labor_cost_per_hour: number | null }>) {
    memberRateMap[m.user_id] = { membership_id: m.id, rate: m.labor_cost_per_hour ?? null }
  }
  const nameMap: Record<string, string | null> = {}
  for (const p of (profilesRes.data ?? []) as Array<{ id: string; full_name: string | null }>) {
    nameMap[p.id] = p.full_name ?? null
  }

  // Entrées pour les users auth
  const laborByMember: LaborByMemberEntry[] = Object.entries(hoursByUser).map(([uid, hrs]) => {
    const memberInfo = memberRateMap[uid]
    // Priorité : taux membre équipe > taux membership > taux org
    const rate: number | null = equipeTauxByUserId[uid] ?? memberInfo?.rate ?? orgFallback
    return {
      user_id: uid,
      member_id: null,
      membership_id: memberInfo?.membership_id ?? '',
      full_name: nameMap[uid] ?? null,
      hours: hrs,
      ratePerHour: rate,
      cost: rate != null ? hrs * rate : 0,
    }
  })

  // Entrées pour les membres fantômes (taux depuis chantier_equipe_membres, sinon taux org)
  for (const fm of (fantomeMembresRes.data ?? []) as Array<{ id: string; prenom: string | null; name: string; taux_horaire: number | null }>) {
    const hrs = hoursByMember[fm.id]
    if (!hrs) continue
    const rate: number | null = fm.taux_horaire ?? orgFallback
    laborByMember.push({
      user_id: null,
      member_id: fm.id,
      membership_id: '',
      full_name: `${fm.prenom ?? ''} ${fm.name}`.trim(),
      hours: hrs,
      ratePerHour: rate,
      cost: rate != null ? hrs * rate : 0,
    })
  }

  const hoursLogged = laborByMember.reduce((s, e) => s + e.hours, 0)
  const costLabor   = laborByMember.reduce((s, e) => s + e.cost, 0)

  // 4. Dépenses enregistrées
  const { data: expenses } = await supabase
    .from('chantier_expenses')
    .select('*')
    .eq('chantier_id', chantierId)
    .order('expense_date', { ascending: false })

  const expenseList: ChantierExpense[] = (expenses ?? []).map((e: any) => ({
    id: e.id,
    chantier_id: e.chantier_id,
    category: e.category,
    label: e.label,
    amount_ht: e.amount_ht,
    vat_rate: e.vat_rate,
    expense_date: e.expense_date,
    supplier_name: e.supplier_name,
    received_invoice_id: e.received_invoice_id,
    receipt_storage_path: e.receipt_storage_path,
    notes: e.notes,
    created_by: e.created_by,
    created_at: e.created_at,
  }))

  const costMaterial    = expenseList.filter(e => e.category === 'materiel').reduce((s, e) => s + e.amount_ht, 0)
  const costSubcontract = expenseList.filter(e => e.category === 'sous_traitance').reduce((s, e) => s + e.amount_ht, 0)
  const costOther       = expenseList.filter(e => ['location','transport','autre'].includes(e.category)).reduce((s, e) => s + e.amount_ht, 0)

  // 5. CA facturé : factures liées au chantier (chantier_id direct OU via le devis lié), hors avoirs
  let revenueHt = 0
  {
    const orFilters: string[] = [`chantier_id.eq.${chantierId}`]
    if (chantier.quote_id) orFilters.push(`quote_id.eq.${chantier.quote_id}`)

    const { data: invoices } = await supabase
      .from('invoices')
      .select('id, total_ht, invoice_type')
      .or(orFilters.join(','))
      .eq('organization_id', orgId)
      .neq('status', 'cancelled')

    // Dédupliquer par id (au cas où une facture matche à la fois chantier_id et quote_id)
    const seen = new Set<string>()
    revenueHt = (invoices ?? [])
      .filter((inv: any) => {
        if (seen.has(inv.id)) return false
        seen.add(inv.id)
        return inv.invoice_type !== 'avoir'
      })
      .reduce((sum: number, inv: any) => sum + (inv.total_ht ?? 0), 0)
  }

  const costTotal = costMaterial + costLabor + costSubcontract + costOther
  const marginEur = revenueHt - costTotal
  const marginPct = revenueHt > 0 ? marginEur / revenueHt : 0

  return {
    budgetHt: chantier.budget_ht ?? 0,
    revenueHt,
    costMaterial,
    costLabor,
    costSubcontract,
    costOther,
    costTotal,
    marginEur,
    marginPct,
    hoursLogged,
    expenses: expenseList,
    laborByMember,
  }
}
