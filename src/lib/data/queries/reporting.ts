import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from './clients'

export type MonthSeries = {
  month: number
  label: string
  caHt: number
  caTtc: number
  encaisse: number
  tvaDue: number
}

export type MonthlyReport = {
  year: number
  month: number
  caHt: number
  caTtc: number
  encaisse: number
  tvaDue: number
  beneficeEstime: number
  hasCostData: boolean
  projectedCostHt: number
  projectedMarginHt: number
  projectedMarginPct: number
  hasProjectedCostData: boolean
  chantiersTermines: number
  chantiersEnCours: number
  heuresTotal: number
  nouvellesFactures: number
  facturesPayees: number
  recurringExpectedHt: number
  recurringBilledHt: number
  recurringContractsDue: number
  prevCaHt: number
  prevCaTtc: number
  prevEncaisse: number
  prevTvaDue: number
  prevHeuresTotal: number
}

export type AnnualReport = {
  year: number
  caHt: number
  caTtc: number
  encaisse: number
  tvaDue: number
  beneficeEstime: number
  hasCostData: boolean
  projectedCostHt: number
  projectedMarginHt: number
  projectedMarginPct: number
  hasProjectedCostData: boolean
  chantiersTermines: number
  nouveauxClients: number
  heuresTotal: number
  prevCaHt: number
  prevCaTtc: number
  prevEncaisse: number
  series: MonthSeries[]
  prevSeries: MonthSeries[]
}

export type HoursReportEntry = {
  personName: string
  hours: number
  userId: string | null
  memberId: string | null
}

export type HoursReport = {
  total: number
  byPerson: HoursReportEntry[]
}

export type MaintenanceReport = {
  interventionsDone: number
  hoursTotal: number
  laborCost: number
  partsCost: number
  travelCost: number
  otherCost: number
  revenueHt: number
  marginEur: number
  expectedRevenueHt: number
  expectedCostHt: number
  expectedMarginHt: number
}

export type TopClientEntry = {
  clientId: string
  clientName: string
  caHt: number
  marginEur: number
  chantiersCount: number
}

export type TopChantierEntry = {
  chantierId: string
  chantierTitle: string
  clientName: string | null
  caHt: number
  encaisseHt: number
  encaisseTtc: number
  costTotal: number
  marginEur: number
  marginPct: number
}

export type CustomObjective = {
  id?: string
  label: string
  target: number
  unit: string
  sort_order: number
}

export type AnnualObjectives = {
  id?: string
  year: number
  revenue_ht_target: number | null
  margin_eur_target: number | null
  margin_pct_target: number | null
  chantiers_count_target: number | null
  new_clients_target: number | null
  hours_target: number | null
  customs: CustomObjective[]
}

export type MonthlyObjectives = {
  id?: string
  year: number
  month: number
  revenue_ht_target: number | null
  margin_eur_target: number | null
  margin_pct_target: number | null
  chantiers_count_target: number | null
  hours_target: number | null
  customs: CustomObjective[]
}

const MONTH_LABELS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jui', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc']

type InvoicePaymentLike = {
  total_ht: number | null
  total_ttc: number | null
  total_paid: number | null
  status: string
}

function paidTtc(inv: InvoicePaymentLike): number {
  const totalTtc = inv.total_ttc ?? 0
  const totalPaid = inv.total_paid ?? 0
  if (totalPaid > 0) return Math.min(totalPaid, totalTtc > 0 ? totalTtc : totalPaid)
  if (inv.status === 'paid') return totalTtc
  return 0
}

function paidHt(inv: InvoicePaymentLike): number {
  const totalHt = inv.total_ht ?? 0
  const totalTtc = inv.total_ttc ?? 0
  if (totalTtc <= 0) return inv.status === 'paid' ? totalHt : 0
  return (paidTtc(inv) / totalTtc) * totalHt
}

type InvoiceLineCost = {
  invoice_id: string
  quantity: number | null
  unit_price: number | null
  unit_cost_ht: number | null
  is_internal: boolean | null
}

function invoiceLineInternalCost(line: InvoiceLineCost): number {
  const quantity = Number(line.quantity) || 0
  const unitCost = line.unit_cost_ht != null
    ? Number(line.unit_cost_ht) || 0
    : line.is_internal
      ? Number(line.unit_price) || 0
      : 0
  return quantity * unitCost
}

function periodRange(year: number, month?: number): { firstDay: string; lastDay: string } {
  if (!month) return { firstDay: `${year}-01-01`, lastDay: `${year}-12-31` }
  return {
    firstDay: `${year}-${String(month).padStart(2, '0')}-01`,
    lastDay: new Date(year, month, 0).toISOString().split('T')[0],
  }
}

/**
 * Calcule le coût main d'oeuvre réel depuis une liste de pointages.
 * Priorité : rate_snapshot (taux figé à la saisie) > taux_horaire membre/membership > taux org > 0.
 * Les pointages antérieurs à la migration 102 n'ont pas rate_snapshot et tombent sur le fallback dynamique.
 */
async function calcLaborCost(
  supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>,
  orgId: string,
  pointages: Array<{ hours: number | null; user_id: string | null; member_id: string | null; rate_snapshot?: number | null }>
): Promise<number> {
  if (!pointages.length) return 0

  // Pointages sans snapshot — besoin de résoudre les taux dynamiquement
  const withoutSnapshot = pointages.filter(p => p.rate_snapshot == null)

  const userIds = [...new Set(withoutSnapshot.filter(p => p.user_id).map(p => p.user_id!))]
  const memberIds = [...new Set(withoutSnapshot.filter(p => p.member_id).map(p => p.member_id!))]

  const needFallback = withoutSnapshot.length > 0

  const [orgRes, membershipsRes, fantomesRes] = await Promise.all([
    needFallback
      ? supabase
          .from('organizations')
          .select('default_labor_cost_per_hour, default_hourly_rate')
          .eq('id', orgId)
          .single()
      : Promise.resolve({ data: null }),

    userIds.length > 0
      ? supabase
          .from('memberships')
          .select('user_id, labor_cost_per_hour')
          .eq('organization_id', orgId)
          .in('user_id', userIds)
      : Promise.resolve({ data: [] as Array<{ user_id: string; labor_cost_per_hour: number | null }> }),

    memberIds.length > 0
      ? supabase
          .from('chantier_equipe_membres')
          .select('id, taux_horaire')
          .in('id', memberIds)
      : Promise.resolve({ data: [] as Array<{ id: string; taux_horaire: number | null }> }),
  ])

  const orgFallback: number =
    orgRes.data?.default_labor_cost_per_hour
    ?? (orgRes.data?.default_hourly_rate ? orgRes.data.default_hourly_rate * 0.5 : 0)
    ?? 0

  const membershipRateByUserId: Record<string, number> = {}
  for (const m of membershipsRes.data ?? []) {
    if (m.labor_cost_per_hour != null) membershipRateByUserId[m.user_id] = m.labor_cost_per_hour
  }

  const fantomeRateById: Record<string, number> = {}
  for (const fm of fantomesRes.data ?? []) {
    if (fm.taux_horaire != null) fantomeRateById[fm.id] = fm.taux_horaire
  }

  let total = 0
  for (const p of pointages) {
    const hours = p.hours ?? 0
    // Snapshot figé en priorité
    if (p.rate_snapshot != null) {
      total += hours * p.rate_snapshot
      continue
    }
    // Fallback dynamique pour les anciens pointages
    let rate = orgFallback
    if (p.user_id) rate = membershipRateByUserId[p.user_id] ?? orgFallback
    else if (p.member_id) rate = fantomeRateById[p.member_id] ?? orgFallback
    total += hours * rate
  }
  return total
}

function emptyMonthSeries(): MonthSeries[] {
  return Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    label: MONTH_LABELS[i],
    caHt: 0,
    caTtc: 0,
    encaisse: 0,
    tvaDue: 0,
  }))
}

function buildSeries(
  invoices: Array<{ issue_date: string | null; total_ht: number | null; total_ttc: number | null; total_tva: number | null; total_paid: number | null; status: string }>,
  year: number
): MonthSeries[] {
  const series = emptyMonthSeries()
  for (const inv of invoices) {
    if (!inv.issue_date) continue
    const d = new Date(inv.issue_date)
    if (d.getFullYear() !== year) continue
    const m = d.getMonth()
    series[m].caHt += inv.total_ht ?? 0
    series[m].caTtc += inv.total_ttc ?? 0
    series[m].tvaDue += inv.total_tva ?? 0
    series[m].encaisse += paidTtc(inv)
  }
  return series
}

export async function getMonthlyReport(year: number, month: number): Promise<MonthlyReport | null> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return null

  const firstDay = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).toISOString().split('T')[0]

  const prevDate = new Date(year, month - 2, 1)
  const prevYear = prevDate.getFullYear()
  const prevMonth = prevDate.getMonth() + 1
  const prevFirstDay = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`
  const prevLastDay = new Date(prevYear, prevMonth, 0).toISOString().split('T')[0]

  // Tous les chantiers de l'org (pour filtrer pointages qui n'ont pas organization_id)
  const [{ data: allOrgChantiers }, { data: activeMaintenanceContracts }] = await Promise.all([
    supabase
      .from('chantiers')
      .select('id, status, end_date, is_maintenance, maintenance_contract_id')
      .eq('organization_id', orgId),
    supabase
      .from('maintenance_contracts')
      .select('id')
      .eq('organization_id', orgId)
      .eq('status', 'actif'),
  ])

  const activeMaintenanceIds = new Set((activeMaintenanceContracts ?? []).map(c => c.id))
  const reportableChantiers = (allOrgChantiers ?? []).filter(c =>
    !c.is_maintenance || !c.maintenance_contract_id || activeMaintenanceIds.has(c.maintenance_contract_id)
  )
  const orgChantierIds = reportableChantiers.map(c => c.id)

  const chantiersTerminesIds = reportableChantiers
    .filter(c => c.status === 'termine' && c.end_date && c.end_date >= firstDay && c.end_date <= lastDay)
    .map(c => c.id)
  const chantiersEnCoursIds = reportableChantiers
    .filter(c => c.status === 'en_cours')
    .map(c => c.id)

  const prevChantiersTerminesIds = reportableChantiers
    .filter(c => c.status === 'termine' && c.end_date && c.end_date >= prevFirstDay && c.end_date <= prevLastDay)
    .map(c => c.id)

  const [
    { data: invoices },
    { data: prevInvoices },
    { data: pointages },
    { data: prevPointages },
    { data: expenses },
    { data: periodicChantiers },
    { data: periodicInvoices },
  ] = await Promise.all([
    supabase
      .from('invoices')
      .select('id, total_ht, total_ttc, total_tva, total_paid, status, invoice_type')
      .eq('organization_id', orgId)
      .in('status', ['sent', 'partial', 'paid'])
      .gte('issue_date', firstDay)
      .lte('issue_date', lastDay),

    supabase
      .from('invoices')
      .select('id, total_ht, total_ttc, total_tva, total_paid, status, invoice_type')
      .eq('organization_id', orgId)
      .in('status', ['sent', 'partial', 'paid'])
      .gte('issue_date', prevFirstDay)
      .lte('issue_date', prevLastDay),

    // Heures dont la date de pointage tombe dans le mois
    orgChantierIds.length > 0
      ? supabase
          .from('chantier_pointages')
          .select('hours, user_id, member_id, rate_snapshot')
          .in('chantier_id', orgChantierIds)
          .gte('date', firstDay)
          .lte('date', lastDay)
      : Promise.resolve({ data: [] as Array<{ hours: number | null; user_id: string | null; member_id: string | null; rate_snapshot: number | null }> }),

    orgChantierIds.length > 0
      ? supabase
          .from('chantier_pointages')
          .select('hours, user_id, member_id, rate_snapshot')
          .in('chantier_id', orgChantierIds)
          .gte('date', prevFirstDay)
          .lte('date', prevLastDay)
      : Promise.resolve({ data: [] as Array<{ hours: number | null; user_id: string | null; member_id: string | null; rate_snapshot: number | null }> }),

    // Depenses dont la expense_date tombe dans le mois
    orgChantierIds.length > 0
      ? supabase
          .from('chantier_expenses')
          .select('amount_ht')
          .in('chantier_id', orgChantierIds)
          .gte('expense_date', firstDay)
          .lte('expense_date', lastDay)
      : Promise.resolve({ data: [] as Array<{ amount_ht: number | null }> }),

    supabase
      .from('chantiers')
      .select('id, montant_periode_ht')
      .eq('organization_id', orgId)
      .eq('is_archived', false)
      .neq('periode_facturation', 'none')
      .not('montant_periode_ht', 'is', null)
      .gte('prochaine_facturation', firstDay)
      .lte('prochaine_facturation', lastDay),

    supabase
      .from('invoices')
      .select('total_ht')
      .eq('organization_id', orgId)
      .eq('generation_source', 'chantier_period')
      .neq('status', 'cancelled')
      .gte('issue_date', firstDay)
      .lte('issue_date', lastDay),
  ])

  const chantiersDuMois = reportableChantiers.filter(c =>
    c.status === 'en_cours' ||
    (c.status === 'termine' && c.end_date && c.end_date >= firstDay && c.end_date <= lastDay)
  )

  const validInvoices = (invoices ?? []).filter(i => i.invoice_type !== 'avoir')
  const caHt = validInvoices.reduce((s, i) => s + (i.total_ht ?? 0), 0)
  const caTtc = validInvoices.reduce((s, i) => s + (i.total_ttc ?? 0), 0)
  const tvaDue = validInvoices.reduce((s, i) => s + (i.total_tva ?? 0), 0)
  const encaisse = validInvoices.reduce((s, i) => s + paidTtc(i), 0)
  const validInvoiceIds = validInvoices.map((i: any) => i.id).filter(Boolean)
  const { data: projectedCostLines } = validInvoiceIds.length > 0
    ? await supabase
        .from('invoice_items')
        .select('invoice_id, quantity, unit_price, unit_cost_ht, is_internal')
        .in('invoice_id', validInvoiceIds)
    : { data: [] as InvoiceLineCost[] }
  const projectedCostHt = (projectedCostLines ?? []).reduce((s, line) => s + invoiceLineInternalCost(line as InvoiceLineCost), 0)
  const hasProjectedCostData = projectedCostHt > 0
  const projectedMarginHt = caHt - projectedCostHt
  const projectedMarginPct = caHt > 0 ? projectedMarginHt / caHt : 0
  const nouvellesFactures = validInvoices.length
  const facturesPayees = validInvoices.filter(i => i.status === 'paid').length
  const recurringExpectedHt = (periodicChantiers ?? []).reduce((s, c) => s + (c.montant_periode_ht ?? 0), 0)
  const recurringBilledHt = (periodicInvoices ?? []).reduce((s, i) => s + (i.total_ht ?? 0), 0)
  const recurringContractsDue = periodicChantiers?.length ?? 0

  const prevValid = (prevInvoices ?? []).filter(i => i.invoice_type !== 'avoir')
  const prevCaHt = prevValid.reduce((s, i) => s + (i.total_ht ?? 0), 0)
  const prevCaTtc = prevValid.reduce((s, i) => s + (i.total_ttc ?? 0), 0)
  const prevTvaDue = prevValid.reduce((s, i) => s + (i.total_tva ?? 0), 0)
  const prevEncaisse = prevValid.reduce((s, i) => s + paidTtc(i), 0)

  const chantiersTermines = chantiersDuMois.filter(c => c.status === 'termine').length
  const chantiersEnCours = chantiersDuMois.filter(c => c.status === 'en_cours').length

  const heuresTotal = (pointages ?? []).reduce((s, p) => s + (p.hours ?? 0), 0)
  const prevHeuresTotal = (prevPointages ?? []).reduce((s, p) => s + (p.hours ?? 0), 0)

  const expensesCost = (expenses ?? []).reduce((s, e) => s + (e.amount_ht ?? 0), 0)
  // Coût main d'oeuvre avec taux individuels (membership > fantome > org fallback)
  const laborCost = await calcLaborCost(supabase, orgId, pointages ?? [])
  const totalCosts = expensesCost + laborCost
  const hasCostData = expensesCost > 0 || heuresTotal > 0
  const beneficeEstime = caHt - totalCosts

  return {
    year, month, caHt, caTtc, encaisse, tvaDue, beneficeEstime, hasCostData,
    projectedCostHt, projectedMarginHt, projectedMarginPct, hasProjectedCostData,
    chantiersTermines, chantiersEnCours, heuresTotal,
    nouvellesFactures, facturesPayees, recurringExpectedHt, recurringBilledHt, recurringContractsDue,
    prevCaHt, prevCaTtc, prevEncaisse, prevTvaDue, prevHeuresTotal,
  }
}

export async function getAnnualReport(year: number): Promise<AnnualReport | null> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return null

  const firstDay = `${year}-01-01`
  const lastDay = `${year}-12-31`
  const prevFirstDay = `${year - 1}-01-01`
  const prevLastDay = `${year - 1}-12-31`

  // Tous les chantiers de l'org (pour filtrer pointages qui n'ont pas organization_id)
  const [{ data: allChantiers }, { data: activeMaintenanceContracts }] = await Promise.all([
    supabase
      .from('chantiers')
      .select('id, status, end_date, created_at, is_maintenance, maintenance_contract_id')
      .eq('organization_id', orgId),
    supabase
      .from('maintenance_contracts')
      .select('id')
      .eq('organization_id', orgId)
      .eq('status', 'actif'),
  ])

  const activeMaintenanceIds = new Set((activeMaintenanceContracts ?? []).map(c => c.id))
  const reportableChantiers = (allChantiers ?? []).filter(c =>
    !c.is_maintenance || !c.maintenance_contract_id || activeMaintenanceIds.has(c.maintenance_contract_id)
  )
  const allChantierIds = reportableChantiers.map(c => c.id)

  const chantiersAnnee = reportableChantiers.filter(c =>
    (c.created_at && c.created_at >= firstDay && c.created_at <= lastDay) ||
    (c.end_date && c.end_date >= firstDay && c.end_date <= lastDay) ||
    c.status === 'en_cours'
  )

  const [
    { data: invoices },
    { data: prevInvoices },
    { data: newClients },
    { data: pointages },
    { data: expenses },
  ] = await Promise.all([
    supabase
      .from('invoices')
      .select('id, total_ht, total_ttc, total_tva, total_paid, status, invoice_type, issue_date')
      .eq('organization_id', orgId)
      .in('status', ['sent', 'partial', 'paid'])
      .gte('issue_date', firstDay)
      .lte('issue_date', lastDay),

    supabase
      .from('invoices')
      .select('id, total_ht, total_ttc, total_tva, total_paid, status, invoice_type, issue_date')
      .eq('organization_id', orgId)
      .in('status', ['sent', 'partial', 'paid'])
      .gte('issue_date', prevFirstDay)
      .lte('issue_date', prevLastDay),

    supabase
      .from('clients')
      .select('id')
      .eq('organization_id', orgId)
      .gte('created_at', firstDay)
      .lte('created_at', lastDay),

    // Heures dont la date de pointage tombe dans l'annee
    allChantierIds.length > 0
      ? supabase
          .from('chantier_pointages')
          .select('hours, user_id, member_id, rate_snapshot')
          .in('chantier_id', allChantierIds)
          .gte('date', firstDay)
          .lte('date', lastDay)
      : Promise.resolve({ data: [] as Array<{ hours: number | null; user_id: string | null; member_id: string | null; rate_snapshot: number | null }> }),

    // Depenses dont la expense_date tombe dans l'annee
    allChantierIds.length > 0
      ? supabase
          .from('chantier_expenses')
          .select('amount_ht')
          .in('chantier_id', allChantierIds)
          .gte('expense_date', firstDay)
          .lte('expense_date', lastDay)
      : Promise.resolve({ data: [] as Array<{ amount_ht: number | null }> }),
  ])

  const validInv = (invoices ?? []).filter(i => i.invoice_type !== 'avoir')
  const caHt = validInv.reduce((s, i) => s + (i.total_ht ?? 0), 0)
  const caTtc = validInv.reduce((s, i) => s + (i.total_ttc ?? 0), 0)
  const tvaDue = validInv.reduce((s, i) => s + (i.total_tva ?? 0), 0)
  const encaisse = validInv.reduce((s, i) => s + paidTtc(i), 0)
  const validInvoiceIds = validInv.map((i: any) => i.id).filter(Boolean)
  const { data: projectedCostLines } = validInvoiceIds.length > 0
    ? await supabase
        .from('invoice_items')
        .select('invoice_id, quantity, unit_price, unit_cost_ht, is_internal')
        .in('invoice_id', validInvoiceIds)
    : { data: [] as InvoiceLineCost[] }
  const projectedCostHt = (projectedCostLines ?? []).reduce((s, line) => s + invoiceLineInternalCost(line as InvoiceLineCost), 0)
  const hasProjectedCostData = projectedCostHt > 0
  const projectedMarginHt = caHt - projectedCostHt
  const projectedMarginPct = caHt > 0 ? projectedMarginHt / caHt : 0

  const prevValid = (prevInvoices ?? []).filter(i => i.invoice_type !== 'avoir')
  const prevCaHt = prevValid.reduce((s, i) => s + (i.total_ht ?? 0), 0)
  const prevCaTtc = prevValid.reduce((s, i) => s + (i.total_ttc ?? 0), 0)
  const prevEncaisse = prevValid.reduce((s, i) => s + paidTtc(i), 0)

  const chantiersTermines = chantiersAnnee.filter(c =>
    c.status === 'termine' && c.end_date && c.end_date >= firstDay && c.end_date <= lastDay
  ).length

  const heuresTotal = (pointages ?? []).reduce((s, p) => s + (p.hours ?? 0), 0)
  const expensesCost = (expenses ?? []).reduce((s, e) => s + (e.amount_ht ?? 0), 0)
  // Coût main d'oeuvre avec taux individuels
  const laborCost = await calcLaborCost(supabase, orgId, pointages ?? [])
  const totalCosts = expensesCost + laborCost
  const hasCostData = expensesCost > 0 || heuresTotal > 0
  const beneficeEstime = caHt - totalCosts

  const series = buildSeries(validInv as any, year)
  const prevSeries = buildSeries(prevValid as any, year - 1)

  return {
    year, caHt, caTtc, encaisse, tvaDue, beneficeEstime, hasCostData,
    projectedCostHt, projectedMarginHt, projectedMarginPct, hasProjectedCostData,
    chantiersTermines,
    nouveauxClients: newClients?.length ?? 0,
    heuresTotal,
    prevCaHt, prevCaTtc, prevEncaisse,
    series, prevSeries,
  }
}

export async function getHoursReport(year: number, month?: number): Promise<HoursReport | null> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return null

  const firstDay = month
    ? `${year}-${String(month).padStart(2, '0')}-01`
    : `${year}-01-01`
  const lastDay = month
    ? new Date(year, month, 0).toISOString().split('T')[0]
    : `${year}-12-31`

  // chantier_pointages n'a pas de organization_id — on filtre via les chantiers de l'org
  const { data: orgChantiers } = await supabase
    .from('chantiers')
    .select('id')
    .eq('organization_id', orgId)

  const orgCids = (orgChantiers ?? []).map(c => c.id)
  if (!orgCids.length) return { total: 0, byPerson: [] }

  const { data: pointages } = await supabase
    .from('chantier_pointages')
    .select('hours, user_id, member_id')
    .in('chantier_id', orgCids)
    .gte('date', firstDay)
    .lte('date', lastDay)

  if (!pointages?.length) return { total: 0, byPerson: [] }

  const byUser: Record<string, number> = {}
  const byMember: Record<string, number> = {}
  for (const p of pointages) {
    if (p.user_id) byUser[p.user_id] = (byUser[p.user_id] ?? 0) + (p.hours ?? 0)
    else if (p.member_id) byMember[p.member_id] = (byMember[p.member_id] ?? 0) + (p.hours ?? 0)
  }

  const userIds = Object.keys(byUser)
  const memberIds = Object.keys(byMember)

  const [profilesRes, membresRes] = await Promise.all([
    userIds.length > 0
      ? supabase.from('profiles').select('id, full_name').in('id', userIds)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string | null }> }),
    memberIds.length > 0
      ? supabase.from('chantier_equipe_membres').select('id, prenom, name').in('id', memberIds)
      : Promise.resolve({ data: [] as Array<{ id: string; prenom: string | null; name: string }> }),
  ])

  const byPerson: HoursReportEntry[] = [
    ...Object.entries(byUser).map(([uid, hours]) => {
      const p = (profilesRes.data ?? []).find(p => p.id === uid)
      return { personName: p?.full_name ?? 'Inconnu', hours, userId: uid, memberId: null }
    }),
    ...Object.entries(byMember).map(([mid, hours]) => {
      const m = (membresRes.data ?? []).find(m => m.id === mid)
      const name = m ? `${m.prenom ?? ''} ${m.name}`.trim() : 'Inconnu'
      return { personName: name, hours, userId: null, memberId: mid }
    }),
  ].sort((a, b) => b.hours - a.hours)

  const total = byPerson.reduce((s, e) => s + e.hours, 0)
  return { total, byPerson }
}

export async function getMaintenanceReport(year: number, month?: number): Promise<MaintenanceReport | null> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return null

  const { firstDay, lastDay } = periodRange(year, month)

  // Seuls les contrats actifs entrent dans le rapport — résiliés/suspendus/terminés exclus
  const { data: activeContracts } = await supabase
    .from('maintenance_contracts')
    .select('id, recurring_invoice_id, chantier_id')
    .eq('organization_id', orgId)
    .eq('status', 'actif')

  const activeContractIds = (activeContracts ?? []).map(c => c.id)
  const activeChantierIds = (activeContracts ?? [])
    .map(c => c.chantier_id)
    .filter(Boolean) as string[]
  const activeRecurringIds = (activeContracts ?? [])
    .map(c => c.recurring_invoice_id)
    .filter(Boolean) as string[]

  if (!activeContractIds.length) {
    const expected = await getMaintenanceExpectedPeriod(supabase, orgId)
    return { interventionsDone: 0, hoursTotal: 0, laborCost: 0, partsCost: 0, travelCost: 0, otherCost: 0, revenueHt: 0, marginEur: 0, ...expected }
  }

  const [{ data: interventions }, { data: schedules }, expected] = await Promise.all([
    supabase
      .from('maintenance_interventions')
      .select('id, statut, date_intervention, invoice_id')
      .eq('organization_id', orgId)
      .in('maintenance_contract_id', activeContractIds),
    activeRecurringIds.length ? supabase
      .from('invoice_schedules')
      .select('invoice_id')
      .eq('organization_id', orgId)
      .in('recurring_invoice_id', activeRecurringIds)
      .not('invoice_id', 'is', null) : Promise.resolve({ data: [] }),
    getMaintenanceExpectedPeriod(supabase, orgId),
  ])

  const interventionIds = (interventions ?? []).map(iv => iv.id)
  const invoiceIds = [...new Set([
    ...(interventions ?? []).map(iv => iv.invoice_id).filter(Boolean),
    ...(schedules ?? []).map(s => s.invoice_id).filter(Boolean),
  ])] as string[]

  const [{ data: pointages }, { data: expenses }, { data: invoices }] = await Promise.all([
    interventionIds.length ? supabase
      .from('chantier_pointages')
      .select('hours, user_id, member_id, rate_snapshot')
      .in('maintenance_intervention_id', interventionIds)
      .gte('date', firstDay)
      .lte('date', lastDay) : Promise.resolve({ data: [] }),

    activeChantierIds.length ? supabase
      .from('chantier_expenses')
      .select('amount_ht, category')
      .in('chantier_id', activeChantierIds)
      .gte('expense_date', firstDay)
      .lte('expense_date', lastDay) : Promise.resolve({ data: [] }),

    invoiceIds.length ? supabase
      .from('invoices')
      .select('total_ht, invoice_type')
      .eq('organization_id', orgId)
      .in('id', invoiceIds)
      .in('status', ['sent', 'partial', 'paid'])
      .gte('issue_date', firstDay)
      .lte('issue_date', lastDay) : Promise.resolve({ data: [] }),
  ])

  const hoursTotal = (pointages ?? []).reduce((s, p) => s + (p.hours ?? 0), 0)
  const laborCost = await calcLaborCost(supabase, orgId, pointages ?? [])
  const partsCost = (expenses ?? []).filter(e => e.category === 'materiel').reduce((s, e) => s + (e.amount_ht ?? 0), 0)
  const travelCost = (expenses ?? []).filter(e => e.category === 'transport').reduce((s, e) => s + (e.amount_ht ?? 0), 0)
  const otherCost = (expenses ?? []).filter(e => e.category !== 'materiel' && e.category !== 'transport').reduce((s, e) => s + (e.amount_ht ?? 0), 0)
  const revenueHt = (invoices ?? [])
    .filter(i => i.invoice_type !== 'avoir')
    .reduce((s, i) => s + (i.total_ht ?? 0), 0)

  return {
    interventionsDone: (interventions ?? []).filter(iv => (
      iv.statut === 'réalisée' &&
      (iv.date_intervention ?? '') >= firstDay &&
      (iv.date_intervention ?? '') <= lastDay
    )).length,
    hoursTotal,
    laborCost,
    partsCost,
    travelCost,
    otherCost,
    revenueHt,
    marginEur: revenueHt - laborCost - partsCost - travelCost - otherCost,
    ...expected,
  }
}

async function getMaintenanceExpectedPeriod(
  supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>,
  orgId: string,
): Promise<Pick<MaintenanceReport, 'expectedRevenueHt' | 'expectedCostHt' | 'expectedMarginHt'>> {
  const { data: contracts } = await supabase
    .from('maintenance_contracts')
    .select('montant_ht, period_cost_labor_ht, period_cost_parts_ht, period_cost_travel_ht, period_cost_other_ht')
    .eq('organization_id', orgId)
    .eq('status', 'actif')

  const expectedRevenueHt = (contracts ?? []).reduce((s, c) => s + (c.montant_ht ?? 0), 0)
  const expectedCostHt = (contracts ?? []).reduce(
    (s, c) => s + (c.period_cost_labor_ht ?? 0) + (c.period_cost_parts_ht ?? 0) + (c.period_cost_travel_ht ?? 0) + (c.period_cost_other_ht ?? 0),
    0,
  )
  return {
    expectedRevenueHt,
    expectedCostHt,
    expectedMarginHt: expectedRevenueHt - expectedCostHt,
  }
}

export async function getTopClients(year: number, month?: number, limit = 10): Promise<TopClientEntry[]> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  const { firstDay, lastDay } = periodRange(year, month)

  const [{ data: invoices }, { data: expenses }, { data: chantiers }] = await Promise.all([
    supabase
      .from('invoices')
      .select('client_id, total_ht, invoice_type')
      .eq('organization_id', orgId)
      .in('status', ['sent', 'partial', 'paid'])
      .gte('issue_date', firstDay)
      .lte('issue_date', lastDay)
      .not('client_id', 'is', null),

    supabase
      .from('chantier_expenses')
      .select('amount_ht, chantier_id')
      .eq('organization_id', orgId)
      .gte('expense_date', firstDay)
      .lte('expense_date', lastDay),

    // Tous les chantiers avec client (actifs dans la période)
    supabase
      .from('chantiers')
      .select('id, client_id, status, created_at, end_date')
      .eq('organization_id', orgId)
      .not('client_id', 'is', null)
      .neq('status', 'annule'),
  ])

  const chantiersActifs = (chantiers ?? []).filter(c =>
    c.status === 'en_cours' ||
    (c.created_at && c.created_at >= firstDay && c.created_at <= lastDay) ||
    (c.end_date && c.end_date >= firstDay && c.end_date <= lastDay)
  )

  const chantierClientMap: Record<string, string> = {}
  const chantierCountByClient: Record<string, number> = {}
  for (const c of chantiersActifs) {
    if (c.client_id) {
      chantierClientMap[c.id] = c.client_id
      chantierCountByClient[c.client_id] = (chantierCountByClient[c.client_id] ?? 0) + 1
    }
  }

  const caByClient: Record<string, number> = {}
  const costByClient: Record<string, number> = {}

  for (const inv of invoices ?? []) {
    if (inv.invoice_type === 'avoir' || !inv.client_id) continue
    caByClient[inv.client_id] = (caByClient[inv.client_id] ?? 0) + (inv.total_ht ?? 0)
  }

  for (const exp of expenses ?? []) {
    const clientId = chantierClientMap[exp.chantier_id]
    if (!clientId) continue
    costByClient[clientId] = (costByClient[clientId] ?? 0) + (exp.amount_ht ?? 0)
  }

  const clientIds = [...new Set(Object.keys(caByClient))]
  if (!clientIds.length) return []

  const { data: clients } = await supabase
    .from('clients')
    .select('id, company_name, contact_name, first_name, last_name')
    .in('id', clientIds)

  const nameMap: Record<string, string> = {}
  for (const c of clients ?? []) {
    nameMap[c.id] = c.company_name
      ?? c.contact_name
      ?? [c.first_name, c.last_name].filter(Boolean).join(' ')
      ?? 'Client inconnu'
  }

  return clientIds
    .map(id => ({
      clientId: id,
      clientName: nameMap[id] ?? 'Client inconnu',
      caHt: caByClient[id] ?? 0,
      marginEur: (caByClient[id] ?? 0) - (costByClient[id] ?? 0),
      chantiersCount: chantierCountByClient[id] ?? 0,
    }))
    .sort((a, b) => b.caHt - a.caHt)
    .slice(0, limit)
}

export async function getTopChantiers(year: number, month?: number, limit = 10): Promise<TopChantierEntry[]> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  const { firstDay, lastDay } = periodRange(year, month)

  // Tous les chantiers non annulés de l'org. Le filtre final garde seulement
  // ceux qui ont du CA ou des coûts dans la période demandée.
  const { data: allOrgChantiers } = await supabase
    .from('chantiers')
    .select('id, title, client_id, quote_id, status, created_at, end_date')
    .eq('organization_id', orgId)
    .eq('is_archived', false)
    .neq('status', 'annule')

  const chantiers = allOrgChantiers ?? []

  if (!chantiers.length) return []

  const chantierIds = chantiers.map(c => c.id)
  const quoteIds = chantiers.map(c => c.quote_id).filter(Boolean) as string[]
  const clientIds = [...new Set(chantiers.map(c => c.client_id).filter(Boolean))] as string[]

  const invoiceFilter = [
    `chantier_id.in.(${chantierIds.join(',')})`,
    quoteIds.length ? `quote_id.in.(${quoteIds.join(',')})` : null,
  ].filter(Boolean).join(',')

  const [invoicesRes, expensesRes, pointagesRes, clientsRes, orgRes] = await Promise.all([
    supabase
      .from('invoices')
      .select('id, chantier_id, quote_id, total_ht, total_ttc, total_paid, invoice_type, status')
      .eq('organization_id', orgId)
      .in('status', ['sent', 'partial', 'paid'])
      .gte('issue_date', firstDay)
      .lte('issue_date', lastDay)
      .or(invoiceFilter),

    supabase
      .from('chantier_expenses')
      .select('chantier_id, amount_ht')
      .in('chantier_id', chantierIds)
      .gte('expense_date', firstDay)
      .lte('expense_date', lastDay),

    supabase
      .from('chantier_pointages')
      .select('chantier_id, hours')
      .in('chantier_id', chantierIds)
      .gte('date', firstDay)
      .lte('date', lastDay),

    clientIds.length > 0
      ? supabase
          .from('clients')
          .select('id, company_name, contact_name, first_name, last_name')
          .in('id', clientIds)
      : Promise.resolve({ data: [] as any[] }),

    supabase
      .from('organizations')
      .select('default_labor_cost_per_hour, default_hourly_rate')
      .eq('id', orgId)
      .single(),
  ])

  const orgFallbackRate = orgRes.data?.default_labor_cost_per_hour
    ?? (orgRes.data?.default_hourly_rate ? orgRes.data.default_hourly_rate * 0.5 : null)
    ?? 0

  const clientNameMap: Record<string, string> = {}
  for (const c of clientsRes.data ?? []) {
    clientNameMap[c.id] = c.company_name
      ?? c.contact_name
      ?? [c.first_name, c.last_name].filter(Boolean).join(' ')
      ?? 'Client inconnu'
  }

  const quoteToChantier: Record<string, string> = {}
  for (const c of chantiers) {
    if (c.quote_id) quoteToChantier[c.quote_id] = c.id
  }

  const seenInvoices = new Set<string>()
  const invoicesByChantier: Record<string, Array<{
    id: string
    total_ht: number | null
    total_ttc: number | null
    total_paid: number | null
    invoice_type: string | null
    status: string
  }>> = {}
  for (const inv of invoicesRes.data ?? []) {
    const cid = inv.chantier_id ?? (inv.quote_id ? quoteToChantier[inv.quote_id] : null)
    if (!cid || !chantierIds.includes(cid)) continue
    const key = inv.id
    if (seenInvoices.has(key)) continue
    seenInvoices.add(key)
    if (inv.invoice_type === 'avoir' || inv.invoice_type === 'acompte') continue
    invoicesByChantier[cid] = [...(invoicesByChantier[cid] ?? []), inv]
  }

  const caByChantier: Record<string, number> = {}
  const encaisseHtByChantier: Record<string, number> = {}
  const encaisseTtcByChantier: Record<string, number> = {}
  for (const [cid, chantierInvoices] of Object.entries(invoicesByChantier)) {
    const hasSituations = chantierInvoices.some(inv => inv.invoice_type === 'situation' || inv.invoice_type === 'solde')
    const revenueInvoices = chantierInvoices.filter(inv => !hasSituations || inv.invoice_type !== 'standard')
    caByChantier[cid] = revenueInvoices.reduce((sum, inv) => sum + (inv.total_ht ?? 0), 0)
    encaisseHtByChantier[cid] = revenueInvoices.reduce((sum, inv) => sum + paidHt(inv), 0)
    encaisseTtcByChantier[cid] = revenueInvoices.reduce((sum, inv) => sum + paidTtc(inv), 0)
  }

  const expCostByChantier: Record<string, number> = {}
  for (const exp of expensesRes.data ?? []) {
    expCostByChantier[exp.chantier_id] = (expCostByChantier[exp.chantier_id] ?? 0) + (exp.amount_ht ?? 0)
  }

  const laborCostByChantier: Record<string, number> = {}
  for (const p of pointagesRes.data ?? []) {
    laborCostByChantier[p.chantier_id] = (laborCostByChantier[p.chantier_id] ?? 0) + (p.hours ?? 0) * orgFallbackRate
  }

  return chantiers
    .map(c => {
      const caHt = caByChantier[c.id] ?? 0
      const encaisseHt = encaisseHtByChantier[c.id] ?? 0
      const costTotal = (expCostByChantier[c.id] ?? 0) + (laborCostByChantier[c.id] ?? 0)
      const marginEur = caHt - costTotal
      const marginPct = caHt > 0 ? marginEur / caHt : 0
      return {
        chantierId: c.id,
        chantierTitle: c.title ?? 'Sans titre',
        clientName: c.client_id ? (clientNameMap[c.client_id] ?? null) : null,
        caHt,
        encaisseHt,
        encaisseTtc: encaisseTtcByChantier[c.id] ?? 0,
        costTotal,
        marginEur,
        marginPct,
      }
    })
    .filter(c => c.caHt > 0 || c.costTotal > 0)
    .sort((a, b) => b.marginEur - a.marginEur)
    .slice(0, limit)
}

export type MemberWithoutRate = {
  personName: string
  userId: string | null
  memberId: string | null
  hoursTotal: number
}

/**
 * Retourne les membres qui ont des pointages mais sans taux horaire résolvable.
 * Utilisé pour afficher un avertissement dans la page Rapports.
 */
export async function getMembersWithoutRate(): Promise<MemberWithoutRate[]> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  const { data: orgChantiers } = await supabase
    .from('chantiers')
    .select('id')
    .eq('organization_id', orgId)

  const orgCids = (orgChantiers ?? []).map(c => c.id)
  if (!orgCids.length) return []

  const { data: pointages } = await supabase
    .from('chantier_pointages')
    .select('hours, user_id, member_id, rate_snapshot')
    .in('chantier_id', orgCids)

  if (!pointages?.length) return []

  // Agréger heures par personne, en séparant les pointages sans snapshot
  const hoursByUser: Record<string, number> = {}
  const hoursByMember: Record<string, number> = {}
  const userIdsNoSnapshot = new Set<string>()
  const memberIdsNoSnapshot = new Set<string>()

  for (const p of pointages) {
    const hrs = p.hours ?? 0
    if (p.user_id) {
      hoursByUser[p.user_id] = (hoursByUser[p.user_id] ?? 0) + hrs
      if (p.rate_snapshot == null) userIdsNoSnapshot.add(p.user_id)
    } else if (p.member_id) {
      hoursByMember[p.member_id] = (hoursByMember[p.member_id] ?? 0) + hrs
      if (p.rate_snapshot == null) memberIdsNoSnapshot.add(p.member_id)
    }
  }

  // Parmi ceux sans snapshot, vérifier s'ils ont un taux dynamique
  const userIds = [...userIdsNoSnapshot]
  const memberIds = [...memberIdsNoSnapshot]

  const [orgRes, membershipsRes, fantomesRes, profilesRes, membresRes] = await Promise.all([
    supabase
      .from('organizations')
      .select('default_labor_cost_per_hour, default_hourly_rate')
      .eq('id', orgId)
      .single(),
    userIds.length > 0
      ? supabase.from('memberships').select('user_id, labor_cost_per_hour').eq('organization_id', orgId).in('user_id', userIds)
      : Promise.resolve({ data: [] as Array<{ user_id: string; labor_cost_per_hour: number | null }> }),
    memberIds.length > 0
      ? supabase.from('chantier_equipe_membres').select('id, prenom, name, taux_horaire').in('id', memberIds)
      : Promise.resolve({ data: [] as Array<{ id: string; prenom: string | null; name: string; taux_horaire: number | null }> }),
    userIds.length > 0
      ? supabase.from('profiles').select('id, full_name').in('id', userIds)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string | null }> }),
    memberIds.length > 0
      ? supabase.from('chantier_equipe_membres').select('id, prenom, name').in('id', memberIds)
      : Promise.resolve({ data: [] as Array<{ id: string; prenom: string | null; name: string }> }),
  ])

  const orgFallback = orgRes.data?.default_labor_cost_per_hour
    ?? (orgRes.data?.default_hourly_rate ? orgRes.data.default_hourly_rate * 0.5 : null)

  // Si un taux org global existe, personne n'est "sans taux"
  if (orgFallback != null) return []

  const membershipRateByUserId: Record<string, number | null> = {}
  for (const m of membershipsRes.data ?? []) {
    membershipRateByUserId[m.user_id] = m.labor_cost_per_hour
  }

  const fantomeTauxById: Record<string, number | null> = {}
  for (const fm of fantomesRes.data ?? []) {
    fantomeTauxById[fm.id] = fm.taux_horaire
  }

  const result: MemberWithoutRate[] = []

  for (const uid of userIdsNoSnapshot) {
    const rate = membershipRateByUserId[uid]
    if (rate == null) {
      const profile = (profilesRes.data ?? []).find(p => p.id === uid)
      result.push({
        personName: profile?.full_name ?? 'Membre inconnu',
        userId: uid,
        memberId: null,
        hoursTotal: hoursByUser[uid] ?? 0,
      })
    }
  }

  for (const mid of memberIdsNoSnapshot) {
    const rate = fantomeTauxById[mid]
    if (rate == null) {
      const m = (membresRes.data ?? []).find(m => m.id === mid)
      const name = m ? `${m.prenom ?? ''} ${m.name}`.trim() : 'Intervenant inconnu'
      result.push({
        personName: name,
        userId: null,
        memberId: mid,
        hoursTotal: hoursByMember[mid] ?? 0,
      })
    }
  }

  return result.sort((a, b) => b.hoursTotal - a.hoursTotal)
}

export async function getAnnualObjectives(year: number): Promise<AnnualObjectives | null> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return null

  const { data: obj } = await supabase
    .from('org_annual_objectives')
    .select('*')
    .eq('organization_id', orgId)
    .eq('year', year)
    .single()

  if (!obj) return { year, revenue_ht_target: null, margin_eur_target: null, margin_pct_target: null, chantiers_count_target: null, new_clients_target: null, hours_target: null, customs: [] }

  const { data: customs } = await supabase
    .from('org_annual_objective_customs')
    .select('*')
    .eq('objective_id', obj.id)
    .order('sort_order')

  return {
    id: obj.id,
    year: obj.year,
    revenue_ht_target: obj.revenue_ht_target,
    margin_eur_target: obj.margin_eur_target,
    margin_pct_target: obj.margin_pct_target,
    chantiers_count_target: obj.chantiers_count_target,
    new_clients_target: obj.new_clients_target,
    hours_target: obj.hours_target,
    customs: (customs ?? []).map(c => ({
      id: c.id,
      label: c.label,
      target: c.target,
      unit: c.unit ?? '',
      sort_order: c.sort_order,
    })),
  }
}

export async function getMonthlyObjectives(year: number, month: number): Promise<MonthlyObjectives | null> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return null

  const { data: obj } = await supabase
    .from('org_monthly_objectives')
    .select('*')
    .eq('organization_id', orgId)
    .eq('year', year)
    .eq('month', month)
    .single()

  if (!obj) return { year, month, revenue_ht_target: null, margin_eur_target: null, margin_pct_target: null, chantiers_count_target: null, hours_target: null, customs: [] }

  const { data: customs } = await supabase
    .from('org_monthly_objective_customs')
    .select('*')
    .eq('objective_id', obj.id)
    .order('sort_order')

  return {
    id: obj.id,
    year: obj.year,
    month: obj.month,
    revenue_ht_target: obj.revenue_ht_target,
    margin_eur_target: obj.margin_eur_target,
    margin_pct_target: obj.margin_pct_target,
    chantiers_count_target: obj.chantiers_count_target,
    hours_target: obj.hours_target,
    customs: (customs ?? []).map(c => ({
      id: c.id,
      label: c.label,
      target: c.target,
      unit: c.unit ?? '',
      sort_order: c.sort_order,
    })),
  }
}

export async function upsertMonthlyObjectives(
  year: number,
  month: number,
  data: Omit<MonthlyObjectives, 'year' | 'month' | 'customs'> & { customs: CustomObjective[] }
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable' }

  const { data: upserted, error } = await supabase
    .from('org_monthly_objectives')
    .upsert({
      organization_id: orgId,
      year,
      month,
      revenue_ht_target: data.revenue_ht_target,
      margin_eur_target: data.margin_eur_target,
      margin_pct_target: data.margin_pct_target,
      chantiers_count_target: data.chantiers_count_target,
      hours_target: data.hours_target,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'organization_id,year,month' })
    .select('id')
    .single()

  if (error || !upserted) return { error: error?.message ?? 'Erreur upsert' }

  const objId = upserted.id
  await supabase.from('org_monthly_objective_customs').delete().eq('objective_id', objId)

  if (data.customs.length > 0) {
    const { error: customError } = await supabase
      .from('org_monthly_objective_customs')
      .insert(data.customs.map((c, i) => ({
        objective_id: objId,
        organization_id: orgId,
        label: c.label,
        target: c.target,
        unit: c.unit,
        sort_order: i,
      })))
    if (customError) return { error: customError.message }
  }

  return { error: null }
}

export async function upsertAnnualObjectives(
  year: number,
  data: Omit<AnnualObjectives, 'year' | 'customs'> & { customs: CustomObjective[] }
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable' }

  const { data: upserted, error } = await supabase
    .from('org_annual_objectives')
    .upsert({
      organization_id: orgId,
      year,
      revenue_ht_target: data.revenue_ht_target,
      margin_eur_target: data.margin_eur_target,
      margin_pct_target: data.margin_pct_target,
      chantiers_count_target: data.chantiers_count_target,
      new_clients_target: data.new_clients_target,
      hours_target: data.hours_target,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'organization_id,year' })
    .select('id')
    .single()

  if (error || !upserted) return { error: error?.message ?? 'Erreur upsert' }

  const objId = upserted.id

  await supabase.from('org_annual_objective_customs').delete().eq('objective_id', objId)

  if (data.customs.length > 0) {
    const { error: customError } = await supabase
      .from('org_annual_objective_customs')
      .insert(data.customs.map((c, i) => ({
        objective_id: objId,
        organization_id: orgId,
        label: c.label,
        target: c.target,
        unit: c.unit,
        sort_order: i,
      })))
    if (customError) return { error: customError.message }
  }

  return { error: null }
}
