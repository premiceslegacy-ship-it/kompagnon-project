import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from './clients'
import { hasPermission } from './membership'

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
  created_by_name?: string | null
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
  budgetCostMaterial: number  // coût d'achat budgété (unit_cost_ht × qty) lignes material du devis
  budgetCostLabor: number     // coût interne budgété (unit_cost_ht × qty) lignes labor du devis
  budgetCostTotal: number     // budgetCostMaterial + budgetCostLabor
  revenueHt: number           // factures émises liées au devis
  collectedRevenueHt: number  // part HT encaissée des factures liées
  costMaterial: number        // dépenses catégorie materiel
  costLabor: number           // somme des coûts par membre
  costSubcontract: number     // sous_traitance
  costOther: number           // location + transport + autre
  costTotal: number
  marginEur: number           // collectedRevenueHt - costTotal
  marginPct: number           // marginEur / collectedRevenueHt (0 si encaissé = 0)
  hoursLogged: number
  expenses: ChantierExpense[]
  laborByMember: LaborByMemberEntry[]
  ownExpensesOnly?: boolean   // vrai si l'utilisateur ne voit que ses propres dépenses
}

export async function getChantierProfitability(chantierId: string): Promise<ChantierProfitability | null> {
  const [canView, canCreate] = await Promise.all([
    hasPermission('chantiers.expenses.view'),
    hasPermission('chantiers.expenses.create'),
  ])
  if (!canView && !canCreate) return null

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return null

  // Si l'utilisateur peut créer des dépenses mais pas les voir toutes, on filtre sur ses propres dépenses
  const { data: { user } } = await supabase.auth.getUser()
  const ownExpensesOnly = !canView && canCreate

  // 1. Budget + devis lié
  const { data: chantier } = await supabase
    .from('chantiers')
    .select('budget_ht, quote_id, organization_id')
    .eq('id', chantierId)
    .eq('organization_id', orgId)
    .single()

  if (!chantier) return null

  // 2. Budgets de coûts réels depuis les lignes du devis (unit_cost_ht × quantity)
  let budgetCostMaterial = 0
  let budgetCostLabor = 0
  if (chantier.quote_id) {
    const { data: quoteItems } = await supabase
      .from('quote_items')
      .select('type, quantity, unit_cost_ht')
      .eq('quote_id', chantier.quote_id)
      .not('unit_cost_ht', 'is', null)
    for (const item of quoteItems ?? []) {
      const cost = (item.unit_cost_ht as number) * (item.quantity as number)
      if (item.type === 'material') budgetCostMaterial += cost
      else if (item.type === 'labor') budgetCostLabor += cost
    }
  }
  const budgetCostTotal = budgetCostMaterial + budgetCostLabor

  // 3. Taux horaire org (fallback si membre sans taux défini)
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
    .select('user_id, member_id, hours, rate_snapshot')
    .eq('chantier_id', chantierId)

  // Agréger heures et coût par user_id / member_id
  // rate_snapshot prioritaire — fallback dynamique pour les anciens pointages
  const hoursByUser: Record<string, number> = {}
  const costByUser: Record<string, number> = {}
  const hoursByMember: Record<string, number> = {}
  const costByMember: Record<string, number> = {}

  // Identifiants sans snapshot (besoin du taux dynamique)
  const userIdsNoSnapshot = new Set<string>()
  const memberIdsNoSnapshot = new Set<string>()

  for (const p of pointages ?? []) {
    const hrs = p.hours ?? 0
    if (p.user_id) {
      hoursByUser[p.user_id] = (hoursByUser[p.user_id] ?? 0) + hrs
      if (p.rate_snapshot != null) {
        costByUser[p.user_id] = (costByUser[p.user_id] ?? 0) + hrs * p.rate_snapshot
      } else {
        userIdsNoSnapshot.add(p.user_id)
      }
    } else if (p.member_id) {
      hoursByMember[p.member_id] = (hoursByMember[p.member_id] ?? 0) + hrs
      if (p.rate_snapshot != null) {
        costByMember[p.member_id] = (costByMember[p.member_id] ?? 0) + hrs * p.rate_snapshot
      } else {
        memberIdsNoSnapshot.add(p.member_id)
      }
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
  // rate_snapshot couvre les pointages récents ; fallback dynamique pour les anciens
  const laborByMember: LaborByMemberEntry[] = Object.entries(hoursByUser).map(([uid, hrs]) => {
    const memberInfo = memberRateMap[uid]
    const dynamicRate: number | null = equipeTauxByUserId[uid] ?? memberInfo?.rate ?? orgFallback
    // Coût = snapshot accumulé + heures sans snapshot × taux dynamique actuel
    const costFromSnapshot = costByUser[uid] ?? 0
    const hrsNoSnapshot = userIdsNoSnapshot.has(uid)
      ? (pointages ?? []).filter(p => p.user_id === uid && p.rate_snapshot == null).reduce((s, p) => s + (p.hours ?? 0), 0)
      : 0
    const cost = costFromSnapshot + (dynamicRate != null ? hrsNoSnapshot * dynamicRate : 0)
    return {
      user_id: uid,
      member_id: null,
      membership_id: memberInfo?.membership_id ?? '',
      full_name: nameMap[uid] ?? null,
      hours: hrs,
      ratePerHour: dynamicRate,
      cost,
    }
  })

  // Entrées pour les membres fantômes
  for (const fm of (fantomeMembresRes.data ?? []) as Array<{ id: string; prenom: string | null; name: string; taux_horaire: number | null }>) {
    const hrs = hoursByMember[fm.id]
    if (!hrs) continue
    const dynamicRate: number | null = fm.taux_horaire ?? orgFallback
    const costFromSnapshot = costByMember[fm.id] ?? 0
    const hrsNoSnapshot = memberIdsNoSnapshot.has(fm.id)
      ? (pointages ?? []).filter(p => p.member_id === fm.id && p.rate_snapshot == null).reduce((s, p) => s + (p.hours ?? 0), 0)
      : 0
    const cost = costFromSnapshot + (dynamicRate != null ? hrsNoSnapshot * dynamicRate : 0)
    laborByMember.push({
      user_id: null,
      member_id: fm.id,
      membership_id: '',
      full_name: `${fm.prenom ?? ''} ${fm.name}`.trim(),
      hours: hrs,
      ratePerHour: dynamicRate,
      cost,
    })
  }

  const hoursLogged = laborByMember.reduce((s, e) => s + e.hours, 0)
  const costLabor   = laborByMember.reduce((s, e) => s + e.cost, 0)

  // 4. Dépenses enregistrées (filtrées par créateur si l'utilisateur ne peut voir que les siennes)
  let expensesQuery = supabase
    .from('chantier_expenses')
    .select('*')
    .eq('chantier_id', chantierId)
    .order('expense_date', { ascending: false })
  if (ownExpensesOnly && user?.id) {
    expensesQuery = expensesQuery.eq('created_by', user.id)
  }
  const { data: expenses } = await expensesQuery

  // Résoudre les noms des créateurs de dépenses
  const creatorIds = [...new Set((expenses ?? []).map((e: any) => e.created_by).filter(Boolean))]
  const creatorNameMap: Record<string, string | null> = {}
  if (creatorIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', creatorIds)
    for (const p of profiles ?? []) {
      creatorNameMap[p.id] = (p as any).full_name ?? null
    }
  }

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
    created_by_name: e.created_by ? (creatorNameMap[e.created_by] ?? null) : null,
    created_at: e.created_at,
  }))

  const costMaterial    = expenseList.filter(e => e.category === 'materiel').reduce((s, e) => s + e.amount_ht, 0)
  const costSubcontract = expenseList.filter(e => e.category === 'sous_traitance').reduce((s, e) => s + e.amount_ht, 0)
  const costOther       = expenseList.filter(e => ['location','transport','autre'].includes(e.category)).reduce((s, e) => s + e.amount_ht, 0)

  // 5. CA facturé et encaissé : factures liées au chantier (chantier_id direct OU via le devis lié), hors avoirs
  let revenueHt = 0
  let collectedRevenueHt = 0
  {
    const orFilters: string[] = [`chantier_id.eq.${chantierId}`]
    if (chantier.quote_id) orFilters.push(`quote_id.eq.${chantier.quote_id}`)

    const { data: invoices } = await supabase
      .from('invoices')
      .select('id, total_ht, total_ttc, total_paid, invoice_type, status')
      .or(orFilters.join(','))
      .eq('organization_id', orgId)
      .neq('status', 'cancelled')

    // Dédupliquer par id (au cas où une facture matche à la fois chantier_id et quote_id)
    const seen = new Set<string>()
    const allValid = (invoices ?? []).filter((inv: any) => {
      if (seen.has(inv.id)) return false
      seen.add(inv.id)
      return inv.invoice_type !== 'avoir' && inv.invoice_type !== 'acompte'
    })
    // Si des situations/soldes existent, exclure les factures standard liées via quote_id
    // (elles ont été remplacées par le mode situations et ne doivent pas être doublonnées)
    const hasSituations = allValid.some((inv: any) => inv.invoice_type === 'situation' || inv.invoice_type === 'solde')
    const revenueInvoices = allValid.filter((inv: any) => !hasSituations || inv.invoice_type !== 'standard')
    revenueHt = revenueInvoices.reduce((sum: number, inv: any) => sum + (inv.total_ht ?? 0), 0)
    collectedRevenueHt = revenueInvoices.reduce((sum: number, inv: any) => {
      const totalHt = inv.total_ht ?? 0
      const totalTtc = inv.total_ttc ?? 0
      if (inv.status === 'paid') return sum + totalHt
      if (inv.status === 'partial' && totalTtc > 0) return sum + ((inv.total_paid ?? 0) / totalTtc) * totalHt
      return sum
    }, 0)
  }

  // En mode "propres dépenses uniquement", on ne calcule pas les agrégats financiers globaux
  if (ownExpensesOnly) {
    return {
      budgetHt: 0,
      budgetCostMaterial: 0,
      budgetCostLabor: 0,
      budgetCostTotal: 0,
      revenueHt: 0,
      collectedRevenueHt: 0,
      costMaterial: 0,
      costLabor: 0,
      costSubcontract: 0,
      costOther: 0,
      costTotal: 0,
      marginEur: 0,
      marginPct: 0,
      hoursLogged,
      expenses: expenseList,
      laborByMember: [],
      ownExpensesOnly: true,
    }
  }

  const costTotal = costMaterial + costLabor + costSubcontract + costOther
  const marginEur = collectedRevenueHt - costTotal
  const marginPct = collectedRevenueHt > 0 ? marginEur / collectedRevenueHt : 0

  return {
    budgetHt: chantier.budget_ht ?? 0,
    budgetCostMaterial,
    budgetCostLabor,
    budgetCostTotal,
    revenueHt,
    collectedRevenueHt,
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
    ownExpensesOnly: false,
  }
}
