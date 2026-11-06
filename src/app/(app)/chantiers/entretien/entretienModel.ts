// @atelier-migrated
// Entretien récurrent : calculs et formulaires purs (aucun accès réseau, aucun état React).

import type {
  Equipement, InterventionStatut, MaintenanceContract, MaintenanceContractExpense, MaintenanceFrequence,
  MaintenanceIntervention, MaintenanceStatus, RecurringInvoiceInstance,
} from '@/lib/data/queries/maintenance'
import type { QuoteStub } from '@/lib/data/queries/quotes'
import type { IndividualMember } from '@/lib/data/queries/members'
import type { TeamMember } from '@/lib/data/queries/team'
import type { CatalogLaborRate, CatalogMaterial, PrestationType } from '@/lib/data/queries/catalog'
import type { StatusPillStatus } from '@/components/ui/StatusPill'

// ─── Formats ──────────────────────────────────────────────────────────────────

export const fmtMoney = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)

export const fmtDate = (iso: string) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

export const fmtDateShort = (iso: string) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })

export const fmtHours = (hours: number) => {
  const h = Math.floor(hours)
  const min = Math.round((hours - h) * 60)
  return min === 0 ? `${h}h` : `${h}h${String(min).padStart(2, '0')}`
}

export const fmtPct = (ratio: number, digits = 0) => `${(ratio * 100).toFixed(digits).replace('.', ',')} %`

/** Date du jour au format AAAA-MM-JJ, en heure locale (toISOString décale d'un jour après minuit à Paris). */
export function todayStr(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function computeDurationHours(start: string, end: string): number | null {
  if (!start || !end) return null
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  if (![sh, sm, eh, em].every(Number.isFinite)) return null
  const startMin = sh * 60 + sm
  let endMin = eh * 60 + em
  if (endMin <= startMin) endMin += 24 * 60
  const diff = endMin - startMin
  if (diff <= 0 || diff > 24 * 60) return null
  return Math.round((diff / 60) * 100) / 100
}

export function mapsUrl(parts: Array<string | null | undefined>) {
  const address = parts.filter(Boolean).join(' ')
  return address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : null
}

export function clientDisplayName(c: MaintenanceContract['client']): string | null {
  if (!c) return null
  return c.company_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Client'
}

// ─── Libellés ─────────────────────────────────────────────────────────────────

export const FREQUENCE_LABELS: Record<MaintenanceFrequence, string> = {
  mensuelle: 'Mensuelle',
  bimestrielle: 'Bimestrielle',
  trimestrielle: 'Trimestrielle',
  semestrielle: 'Semestrielle',
  annuelle: 'Annuelle',
  sur_demande: 'Sur demande',
}

export const CONTRACT_STATUS: Record<MaintenanceStatus, { label: string; pill: StatusPillStatus }> = {
  actif: { label: 'Actif', pill: 'success' },
  suspendu: { label: 'Suspendu', pill: 'wait' },
  résilié: { label: 'Résilié', pill: 'danger' },
  terminé: { label: 'Terminé', pill: 'neutral' },
}

export const INTERVENTION_STATUS: Record<InterventionStatut, { label: string; pill: StatusPillStatus }> = {
  planifiée: { label: 'Planifiée', pill: 'wait' },
  réalisée: { label: 'Réalisée', pill: 'success' },
  annulée: { label: 'Annulée', pill: 'danger' },
}

export const CONTRACT_FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: 'Actifs' },
  { key: 'suspendu', label: 'Suspendus' },
  { key: 'résilié', label: 'Résiliés' },
  { key: 'terminé', label: 'Terminés' },
]

/** « Actifs » = contrats actifs uniquement ; les autres statuts ont leur propre filtre. */
export function filterContracts(contracts: MaintenanceContract[], tab: string, search: string): MaintenanceContract[] {
  let list = tab === 'all' ? contracts.filter(c => c.status === 'actif') : contracts.filter(c => c.status === tab)
  const q = search.trim().toLowerCase()
  if (q) {
    list = list.filter(c =>
      c.title.toLowerCase().includes(q) ||
      (c.client?.company_name ?? '').toLowerCase().includes(q) ||
      [c.client?.first_name, c.client?.last_name].filter(Boolean).join(' ').toLowerCase().includes(q),
    )
  }
  return list
}

// ─── Intervenants ─────────────────────────────────────────────────────────────

export type IntervenantOption = { id: string; label: string; group: 'moi' | 'app' | 'terrain' }

/** Liste unifiée : moi, membres de l'application, intervenants terrain. */
export function buildIntervenants(
  currentUserId: string | null,
  currentUserName: string | null,
  teamMembers: TeamMember[],
  ghostMembers: IndividualMember[],
): IntervenantOption[] {
  const list: IntervenantOption[] = []
  if (currentUserId && currentUserName) list.push({ id: currentUserId, label: currentUserName, group: 'moi' })
  for (const m of teamMembers) {
    if (m.user_id === currentUserId) continue
    list.push({ id: m.user_id, label: m.full_name || m.email, group: 'app' })
  }
  for (const m of ghostMembers) list.push({ id: m.id, label: [m.prenom, m.name].filter(Boolean).join(' '), group: 'terrain' })
  return list
}

/** Nom affiché : d'abord la jointure (terrain), puis le profil, puis la liste unifiée. */
export function intervenantName(iv: MaintenanceIntervention, intervenants: { id: string; label: string }[]): string | null {
  if (iv.intervenant) return [iv.intervenant.prenom, iv.intervenant.name].filter(Boolean).join(' ')
  if (iv.intervenant_profile?.full_name) return iv.intervenant_profile.full_name
  const id = iv.intervenant_user_id ?? iv.intervenant_member_id ?? iv.intervenant_id
  return id ? intervenants.find(i => i.id === id)?.label ?? null : null
}

// ─── Formulaire contrat ───────────────────────────────────────────────────────

export type ContractForm = {
  client_id: string
  chantier_id: string
  source_quote_id: string
  site_name: string
  site_contact_name: string
  site_contact_email: string
  site_contact_phone: string
  site_address_line1: string
  site_postal_code: string
  site_city: string
  period_cost_labor_ht: string
  period_cost_parts_ht: string
  period_cost_travel_ht: string
  period_cost_other_ht: string
  title: string
  description: string
  status: MaintenanceStatus
  frequence: MaintenanceFrequence
  montant_ht: string
  vat_rate: number
  facturation_auto: boolean
  auto_send_delay_days: string
  date_debut: string
  date_fin: string
  prochaine_intervention: string
  equipements: Equipement[]
}

export const blankContract = (): ContractForm => ({
  client_id: '',
  chantier_id: '',
  title: '',
  description: '',
  status: 'actif',
  frequence: 'annuelle',
  montant_ht: '',
  vat_rate: 20,
  facturation_auto: false,
  auto_send_delay_days: '',
  date_debut: '',
  date_fin: '',
  prochaine_intervention: '',
  source_quote_id: '',
  site_name: '',
  site_contact_name: '',
  site_contact_email: '',
  site_contact_phone: '',
  site_address_line1: '',
  site_postal_code: '',
  site_city: '',
  period_cost_labor_ht: '',
  period_cost_parts_ht: '',
  period_cost_travel_ht: '',
  period_cost_other_ht: '',
  equipements: [],
})

export function contractToForm(c: MaintenanceContract): ContractForm {
  return {
    client_id: c.client_id ?? '',
    chantier_id: c.chantier_id ?? '',
    source_quote_id: c.source_quote_id ?? '',
    site_name: c.site_name ?? '',
    site_contact_name: c.site_contact_name ?? '',
    site_contact_email: c.site_contact_email ?? '',
    site_contact_phone: c.site_contact_phone ?? '',
    site_address_line1: c.site_address_line1 ?? '',
    site_postal_code: c.site_postal_code ?? '',
    site_city: c.site_city ?? '',
    period_cost_labor_ht: c.period_cost_labor_ht ? String(c.period_cost_labor_ht) : '',
    period_cost_parts_ht: c.period_cost_parts_ht ? String(c.period_cost_parts_ht) : '',
    period_cost_travel_ht: c.period_cost_travel_ht ? String(c.period_cost_travel_ht) : '',
    period_cost_other_ht: c.period_cost_other_ht ? String(c.period_cost_other_ht) : '',
    title: c.title,
    description: c.description ?? '',
    status: c.status,
    frequence: c.frequence,
    montant_ht: c.montant_ht !== null ? String(c.montant_ht) : '',
    vat_rate: c.vat_rate,
    facturation_auto: c.facturation_auto,
    auto_send_delay_days: c.auto_send_delay_days != null ? String(c.auto_send_delay_days) : '',
    date_debut: c.date_debut ?? '',
    date_fin: c.date_fin ?? '',
    prochaine_intervention: c.prochaine_intervention ?? '',
    equipements: c.equipements ?? [],
  }
}

/** Choisir un devis source reprend titre, montant, contact, adresse et coût interne. */
export function applyQuoteToContractForm(form: ContractForm, quote: QuoteStub | undefined, quoteId: string): ContractForm {
  return {
    ...form,
    source_quote_id: quoteId,
    title: quote?.title ? `Entretien - ${quote.title}` : form.title,
    montant_ht: quote?.total_ht != null ? String(quote.total_ht) : form.montant_ht,
    site_contact_name: quote?.client_contact_name ?? form.site_contact_name,
    site_contact_email: quote?.client_contact_email ?? form.site_contact_email,
    site_contact_phone: quote?.client_contact_phone ?? form.site_contact_phone,
    site_address_line1: quote?.client_address_line1 ?? form.site_address_line1,
    site_postal_code: quote?.client_postal_code ?? form.site_postal_code,
    site_city: quote?.client_city ?? form.site_city,
    period_cost_labor_ht: '',
    period_cost_parts_ht: '',
    period_cost_travel_ht: '',
    period_cost_other_ht: quote?.internal_cost_total_ht ? String(quote.internal_cost_total_ht) : form.period_cost_other_ht,
  }
}

export function contractPayload(form: ContractForm, editing: boolean) {
  return {
    client_id: form.client_id || null,
    chantier_id: form.chantier_id || null,
    source_quote_id: form.source_quote_id || null,
    site_name: form.site_name || null,
    site_contact_name: form.site_contact_name || null,
    site_contact_email: form.site_contact_email || null,
    site_contact_phone: form.site_contact_phone || null,
    site_address_line1: form.site_address_line1 || null,
    site_postal_code: form.site_postal_code || null,
    site_city: form.site_city || null,
    period_cost_labor_ht: form.period_cost_labor_ht ? parseFloat(form.period_cost_labor_ht) : 0,
    period_cost_parts_ht: form.period_cost_parts_ht ? parseFloat(form.period_cost_parts_ht) : 0,
    period_cost_travel_ht: form.period_cost_travel_ht ? parseFloat(form.period_cost_travel_ht) : 0,
    period_cost_other_ht: form.period_cost_other_ht ? parseFloat(form.period_cost_other_ht) : 0,
    title: form.title,
    description: form.description || null,
    status: form.status,
    equipements: form.equipements,
    frequence: form.frequence,
    montant_ht: form.montant_ht ? parseFloat(form.montant_ht) : null,
    vat_rate: form.vat_rate,
    facturation_auto: form.facturation_auto,
    auto_send_delay_days: form.facturation_auto && form.auto_send_delay_days ? parseInt(form.auto_send_delay_days, 10) : null,
    date_debut: form.date_debut || null,
    date_fin: form.date_fin || null,
    prochaine_intervention: editing ? (form.prochaine_intervention || null) : null,
  }
}

// ─── Formulaire intervention ──────────────────────────────────────────────────

export type TravelMode = 'manual' | 'calculated'

export type InterventionForm = {
  date_intervention: string
  intervenant_id: string
  statut: InterventionStatut
  start_time: string
  end_time: string
  duration_hours: string
  rapport: string
  observations: string
  billable_notes: string
  billable_amount_ht: string
  billable_vat_rate: number
  cost_parts_ht: string
  cost_travel_ht: string
  cost_other_ht: string
  travel_km: string
  travel_fuel_price_per_liter: string
  travel_fuel_consumption_per_100km: string
  travel_mode: TravelMode
}

export const blankIntervention = (): InterventionForm => ({
  date_intervention: todayStr(),
  intervenant_id: '',
  statut: 'planifiée',
  start_time: '',
  end_time: '',
  duration_hours: '',
  rapport: '',
  observations: '',
  billable_notes: '',
  billable_amount_ht: '',
  billable_vat_rate: 20,
  cost_parts_ht: '',
  cost_travel_ht: '',
  cost_other_ht: '',
  travel_km: '',
  travel_fuel_price_per_liter: '',
  travel_fuel_consumption_per_100km: '',
  travel_mode: 'manual',
})

/** Nouvelle intervention : montant, TVA et coûts de référence repris du contrat. */
export function interventionDefaults(contract: MaintenanceContract | null): InterventionForm {
  return {
    ...blankIntervention(),
    billable_amount_ht: contract?.montant_ht != null ? String(contract.montant_ht) : '',
    billable_vat_rate: contract?.vat_rate ?? 20,
    cost_parts_ht: contract?.period_cost_parts_ht ? String(contract.period_cost_parts_ht) : '',
    cost_travel_ht: contract?.period_cost_travel_ht ? String(contract.period_cost_travel_ht) : '',
    cost_other_ht: contract?.period_cost_other_ht ? String(contract.period_cost_other_ht) : '',
  }
}

export function interventionToForm(iv: MaintenanceIntervention): InterventionForm {
  return {
    date_intervention: iv.date_intervention,
    intervenant_id: iv.intervenant_user_id ?? iv.intervenant_member_id ?? iv.intervenant_id ?? '',
    statut: iv.statut,
    start_time: iv.start_time ? iv.start_time.slice(0, 5) : '',
    end_time: iv.end_time ? iv.end_time.slice(0, 5) : '',
    duration_hours: iv.duration_hours != null ? String(iv.duration_hours) : '',
    rapport: iv.rapport ?? '',
    observations: iv.observations ?? '',
    billable_notes: iv.billable_notes ?? '',
    billable_amount_ht: iv.billable_amount_ht != null ? String(iv.billable_amount_ht) : '',
    billable_vat_rate: iv.billable_vat_rate ?? 20,
    cost_parts_ht: iv.cost_parts_ht ? String(iv.cost_parts_ht) : '',
    cost_travel_ht: iv.cost_travel_ht ? String(iv.cost_travel_ht) : '',
    cost_other_ht: iv.cost_other_ht ? String(iv.cost_other_ht) : '',
    travel_km: '',
    travel_fuel_price_per_liter: '',
    travel_fuel_consumption_per_100km: '',
    travel_mode: 'manual',
  }
}

export function interventionPayload(form: InterventionForm, intervenants: IntervenantOption[]) {
  const selected = intervenants.find(i => i.id === form.intervenant_id)
  const duration = form.duration_hours
    ? parseFloat(form.duration_hours)
    : computeDurationHours(form.start_time, form.end_time)
  return {
    date_intervention: form.date_intervention,
    intervenant_id: selected?.group === 'terrain' ? form.intervenant_id : null,
    intervenant_user_id: selected && selected.group !== 'terrain' ? form.intervenant_id : null,
    intervenant_member_id: selected?.group === 'terrain' ? form.intervenant_id : null,
    statut: form.statut,
    start_time: form.start_time || null,
    end_time: form.end_time || null,
    duration_hours: duration,
    rapport: form.rapport || null,
    observations: form.observations || null,
    billable_notes: form.billable_notes || null,
    billable_amount_ht: form.billable_amount_ht ? parseFloat(form.billable_amount_ht) : null,
    billable_vat_rate: form.billable_vat_rate,
    cost_parts_ht: form.cost_parts_ht ? parseFloat(form.cost_parts_ht) : 0,
    cost_travel_ht: form.cost_travel_ht ? parseFloat(form.cost_travel_ht) : 0,
    cost_other_ht: form.cost_other_ht ? parseFloat(form.cost_other_ht) : 0,
  }
}

const num = (s: string) => parseFloat(s.replace(',', '.'))

/** Coût du déplacement : km × conso/100 × prix du litre, arrondi au centime. Null si une valeur manque. */
export function travelCost(km: string, pricePerLiter: string, consumptionPer100: string): number | null {
  const d = num(km), p = num(pricePerLiter), c = num(consumptionPer100)
  if (!Number.isFinite(d) || !Number.isFinite(p) || !Number.isFinite(c) || c <= 0) return null
  return Math.round(d * (c / 100) * p * 100) / 100
}

/** Met à jour un champ du calcul kilométrique et recalcule le coût (inchangé tant que les trois valeurs ne sont pas toutes là). */
export function withTravelField(
  form: InterventionForm,
  field: 'travel_km' | 'travel_fuel_price_per_liter' | 'travel_fuel_consumption_per_100km',
  value: string,
): InterventionForm {
  const next = { ...form, [field]: value }
  const cost = travelCost(next.travel_km, next.travel_fuel_price_per_liter, next.travel_fuel_consumption_per_100km)
  return cost !== null ? { ...next, cost_travel_ht: String(cost) } : next
}

/** Changer l'heure de début ou de fin recalcule la durée si elle est déterminable. */
export function withTimeField(form: InterventionForm, field: 'start_time' | 'end_time', value: string): InterventionForm {
  const start = field === 'start_time' ? value : form.start_time
  const end = field === 'end_time' ? value : form.end_time
  const duration = computeDurationHours(start, end)
  return { ...form, [field]: value, duration_hours: duration ? String(duration) : form.duration_hours }
}

// ─── Marge prévue par période ─────────────────────────────────────────────────

export type ExpectedCostCategory = 'labor' | 'parts' | 'travel' | 'other'
export type ExpectedBudgetForm = Record<ExpectedCostCategory, string>
export type BudgetSource = 'material' | 'labor' | 'prestation' | 'manual'

export type CatalogBudgetDraft = {
  source: BudgetSource
  catalogId: string
  category: ExpectedCostCategory
  label: string
  quantity: string
  unit: string
  unitCost: string
}

export const COST_CATEGORIES: ExpectedCostCategory[] = ['labor', 'parts', 'travel', 'other']

export const COST_CATEGORY_META: Record<ExpectedCostCategory, { label: string; detail: string }> = {
  labor: { label: 'Main-d’œuvre', detail: 'Temps prévu par période, au coût interne.' },
  parts: { label: 'Produits / pièces', detail: 'Consommables, pièces ou achats récurrents.' },
  travel: { label: 'Déplacement', detail: 'Carburant, trajet, péage ou frais de route.' },
  other: { label: 'Autres coûts', detail: 'Sous-traitance, forfaits ou coûts non classés.' },
}

export const BUDGET_SOURCE_LABELS: Record<BudgetSource, string> = {
  material: 'Produits / services',
  labor: 'Main-d’œuvre',
  prestation: 'Prestations',
  manual: 'Libre',
}

export function formatMoneyInput(value: number | null | undefined) {
  return value && value > 0 ? String(value) : ''
}

export function parseMoneyInput(value: string) {
  const n = parseFloat(value.replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function contractExpectedBudget(c: MaintenanceContract): ExpectedBudgetForm {
  return {
    labor: formatMoneyInput(c.period_cost_labor_ht),
    parts: formatMoneyInput(c.period_cost_parts_ht),
    travel: formatMoneyInput(c.period_cost_travel_ht),
    other: formatMoneyInput(c.period_cost_other_ht),
  }
}

export function expectedBudgetTotals(form: ExpectedBudgetForm) {
  const labor = parseMoneyInput(form.labor)
  const parts = parseMoneyInput(form.parts)
  const travel = parseMoneyInput(form.travel)
  const other = parseMoneyInput(form.other)
  return { labor, parts, travel, other, total: labor + parts + travel + other }
}

export function expectedCostOf(c: MaintenanceContract): number {
  return (c.period_cost_labor_ht ?? 0) + (c.period_cost_parts_ht ?? 0) + (c.period_cost_travel_ht ?? 0) + (c.period_cost_other_ht ?? 0)
}

/** Ton d'une marge : ≥ 20 % bon, ≥ 5 % à surveiller, en dessous à risque. */
export function marginStatus(pct: number): StatusPillStatus {
  if (pct >= 0.2) return 'success'
  if (pct >= 0.05) return 'wait'
  return 'danger'
}

export function emptyBudgetDraft(): CatalogBudgetDraft {
  return { source: 'material', catalogId: '', category: 'parts', label: '', quantity: '1', unit: '', unitCost: '' }
}

export function budgetDraftForSource(source: BudgetSource): CatalogBudgetDraft {
  return { ...emptyBudgetDraft(), source, category: source === 'labor' ? 'labor' : 'parts' }
}

/** Choisir une ligne du catalogue remplit libellé, unité, coût et catégorie. */
export function applyCatalogItem(
  draft: CatalogBudgetDraft,
  source: BudgetSource,
  catalogId: string,
  catalog: { materials: CatalogMaterial[]; laborRates: CatalogLaborRate[]; prestationTypes: PrestationType[] },
): CatalogBudgetDraft {
  if (!catalogId) {
    return { ...draft, source, catalogId: '', label: '', unit: '', unitCost: '', category: source === 'labor' ? 'labor' : 'parts' }
  }
  if (source === 'material') {
    const item = catalog.materials.find(m => m.id === catalogId)
    if (!item) return draft
    return {
      ...draft, source, catalogId,
      category: item.item_kind === 'service' ? 'other' : 'parts',
      label: item.name,
      unit: item.unit ?? draft.unit,
      unitCost: String(item.purchase_price ?? item.sale_price ?? 0),
    }
  }
  if (source === 'labor') {
    const item = catalog.laborRates.find(l => l.id === catalogId)
    if (!item) return draft
    return {
      ...draft, source, catalogId,
      category: 'labor',
      label: item.designation,
      unit: item.unit ?? draft.unit ?? 'h',
      unitCost: String(item.cost_rate ?? item.purchase_price ?? item.rate ?? 0),
    }
  }
  if (source === 'prestation') {
    const item = catalog.prestationTypes.find(p => p.id === catalogId)
    if (!item) return draft
    return {
      ...draft, source, catalogId,
      category: 'other',
      label: item.name,
      unit: item.unit ?? draft.unit ?? 'forfait',
      unitCost: String(item.base_cost_ht ?? 0),
    }
  }
  return draft
}

/** Montant d'une ligne de coût prévu : quantité × coût unitaire, au centime. */
export function budgetDraftAmount(draft: CatalogBudgetDraft): number {
  const quantity = parseFloat(draft.quantity.replace(',', '.')) || 0
  const unitCost = parseFloat(draft.unitCost.replace(',', '.')) || 0
  return Math.round(quantity * unitCost * 100) / 100
}

// ─── Suivi facturation et marge par période ───────────────────────────────────

export type PeriodRow = {
  period: string
  label: string
  interventions: number
  revenueHt: number
  billedRevenueHt: number
  paidRevenueHt: number
  draftRevenueHt: number
  pendingRevenueHt: number
  actualCostHt: number
  laborCostHt: number
  partsCostHt: number
  travelCostHt: number
  otherCostHt: number
  expectedRevenueHt: number
  expectedCostHt: number
  marginEur: number
  marginPct: number
  invoiceId: string | null
}

export function isIssuedInvoiceStatus(status: string | null | undefined) {
  return status === 'sent' || status === 'partial' || status === 'paid'
}

function invoiceRevenueForIntervention(iv: MaintenanceIntervention, fallbackRevenue: number) {
  return iv.invoice?.total_ht ?? iv.billable_amount_ht ?? fallbackRevenue
}

export function buildMaintenancePeriodRows(
  c: MaintenanceContract,
  interventions: MaintenanceIntervention[],
  expenses: MaintenanceContractExpense[],
  recurringInstances: RecurringInvoiceInstance[],
  now: Date = new Date(),
): PeriodRow[] {
  const expectedRevenue = c.montant_ht ?? 0
  const expectedCost = expectedCostOf(c)
  const rows: Record<string, PeriodRow> = {}

  const ensure = (key: string) => {
    rows[key] ??= {
      period: key,
      label: new Date(`${key}-01T00:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
      interventions: 0,
      revenueHt: 0,
      billedRevenueHt: 0,
      paidRevenueHt: 0,
      draftRevenueHt: 0,
      pendingRevenueHt: 0,
      actualCostHt: 0,
      laborCostHt: 0,
      partsCostHt: 0,
      travelCostHt: 0,
      otherCostHt: 0,
      expectedRevenueHt: expectedRevenue,
      expectedCostHt: expectedCost,
      marginEur: expectedRevenue - expectedCost,
      marginPct: expectedRevenue > 0 ? (expectedRevenue - expectedCost) / expectedRevenue : 0,
      invoiceId: null,
    }
    return rows[key]
  }

  ensure(todayStr(now).slice(0, 7))

  for (const iv of interventions) {
    if (!iv.date_intervention) continue
    const row = ensure(iv.date_intervention.slice(0, 7))
    if (iv.statut !== 'réalisée') continue
    row.interventions += 1
    const revenue = invoiceRevenueForIntervention(iv, expectedRevenue)
    if (isIssuedInvoiceStatus(iv.invoice?.status)) {
      row.billedRevenueHt += revenue
      if (iv.invoice?.status === 'paid') row.paidRevenueHt += revenue
      if (iv.invoice_id) row.invoiceId = iv.invoice_id
    } else if (iv.invoice_id) {
      row.draftRevenueHt += revenue
    } else {
      row.pendingRevenueHt += revenue
    }
    row.laborCostHt += iv.labor_cost_ht ?? 0
  }

  for (const expense of expenses) {
    if (!expense.expense_date) continue
    const row = ensure(expense.expense_date.slice(0, 7))
    const amount = expense.amount_ht ?? 0
    if (expense.category === 'materiel') row.partsCostHt += amount
    else if (expense.category === 'transport') row.travelCostHt += amount
    else row.otherCostHt += amount
  }

  // Factures récurrentes : une instance par période de facturation
  for (const inst of recurringInstances) {
    if (!inst.scheduled_date) continue
    const row = ensure(inst.scheduled_date.slice(0, 7))
    const amount = inst.invoice_total_ht ?? inst.amount_ht
    if (isIssuedInvoiceStatus(inst.invoice_status)) {
      row.billedRevenueHt += amount
      if (inst.invoice_status === 'paid') row.paidRevenueHt += amount
      if (inst.invoice_id) row.invoiceId = inst.invoice_id
    } else if (inst.invoice_id) {
      row.draftRevenueHt += amount
    } else {
      row.pendingRevenueHt += amount
    }
  }

  return Object.values(rows)
    .map(row => {
      const actualCost = row.laborCostHt + row.partsCostHt + row.travelCostHt + row.otherCostHt
      const revenue = row.billedRevenueHt
      const cost = actualCost > 0 ? actualCost : row.expectedCostHt
      const margin = revenue - cost
      return { ...row, revenueHt: revenue, actualCostHt: cost, marginEur: margin, marginPct: revenue > 0 ? margin / revenue : 0 }
    })
    .sort((a, b) => b.period.localeCompare(a.period))
    .slice(0, 6)
}

/** Libellé et ton de la facture d'une intervention. */
export function invoiceBadge(invoice: NonNullable<MaintenanceIntervention['invoice']>): { label: string; pill: StatusPillStatus } {
  if (invoice.status === 'paid') return { label: 'Payée', pill: 'success' }
  if (invoice.status === 'sent') return { label: 'Envoyée', pill: 'wait' }
  return { label: `Facture ${invoice.number ?? 'brouillon'}`, pill: 'neutral' }
}
