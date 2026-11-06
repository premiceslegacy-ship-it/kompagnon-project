// Rentabilité du chantier : formats, recalcul local, formulaire de dépense. Sans React.
import type { ChantierExpense, ChantierProfitability, LaborByMemberEntry } from '@/lib/data/queries/chantier-profitability'
import type { InvoiceStub } from '@/lib/data/queries/invoices'
import { findRentalItem, type RentalUnit } from '@/lib/sectors/rental-catalog'
import { computeFuel, DEFAULT_CONSUMPTION_L_PER_100KM, DEFAULT_FUEL_PRICE_EUR_PER_L } from '@/lib/utils/fuel'

export function fmtMoney(n: number, decimals = 0) {
  return n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: decimals })
}

export function fmtPct(n: number) {
  return `${(n * 100).toFixed(1)} %`
}

/** Part du montant HT d'une facture déjà encaissée. */
export function invoiceCollectedHt(inv: Pick<InvoiceStub, 'status' | 'total_ht' | 'total_ttc' | 'total_paid'>) {
  const totalHt = inv.total_ht ?? 0
  const totalTtc = inv.total_ttc ?? 0
  if (inv.status === 'paid') return totalHt
  if (inv.status === 'partial' && totalTtc > 0) return ((inv.total_paid ?? 0) / totalTtc) * totalHt
  return 0
}

export const EXPENSE_CATEGORIES: { value: ChantierExpense['category']; label: string }[] = [
  { value: 'materiel', label: 'Matériel' },
  { value: 'sous_traitance', label: 'Sous-traitance' },
  { value: 'location', label: 'Location' },
  { value: 'transport', label: 'Transport' },
  { value: 'autre', label: 'Autre' },
]

export function catLabel(v: ChantierExpense['category']) {
  return EXPENSE_CATEGORIES.find(c => c.value === v)?.label ?? v
}

/** Recalcule coûts et marge après un changement local (dépense, facture, taux). */
export function recalc(prev: ChantierProfitability, newLaborByMember?: LaborByMemberEntry[]): ChantierProfitability {
  const members = newLaborByMember ?? prev.laborByMember
  const { expenses, revenueHt } = prev
  const costMaterial = expenses.filter(e => e.category === 'materiel').reduce((s, e) => s + e.amount_ht, 0)
  const costSubcontract = expenses.filter(e => e.category === 'sous_traitance').reduce((s, e) => s + e.amount_ht, 0)
  const costOther = expenses.filter(e => ['location', 'transport', 'autre'].includes(e.category)).reduce((s, e) => s + e.amount_ht, 0)
  const costLabor = members.reduce((s, e) => s + e.cost, 0)
  const hoursLogged = members.reduce((s, e) => s + e.hours, 0)
  const costTotal = costMaterial + costLabor + costSubcontract + costOther
  const marginEur = revenueHt - costTotal
  const marginPct = revenueHt > 0 ? marginEur / revenueHt : 0
  return { ...prev, laborByMember: members, costMaterial, costSubcontract, costOther, costLabor, hoursLogged, costTotal, marginEur, marginPct }
}

export type MarginTone = 'success' | 'wait' | 'danger'

export function marginTone(pct: number): MarginTone {
  if (pct >= 0.2) return 'success'
  if (pct >= 0.05) return 'wait'
  return 'danger'
}

export type ExpenseFormState = {
  category: ChantierExpense['category']
  label: string
  amountHt: string
  vatRate: string
  expenseDate: string
  supplierName: string
  notes: string
  receiptStoragePath: string | null
  quantity: string
  unit: string
  unitPriceHt: string
  materialId: string | null
  rentalSubcategory: string
  rentalItemLabel: string
  rentalUnit: RentalUnit
  rentalStartDate: string
  rentalEndDate: string
  transportSubcategory: string
  transportKm: string
  transportConsumption: string
  transportFuelPrice: string
}

export function emptyExpenseForm(today: string): ExpenseFormState {
  return {
    category: 'materiel', label: '', amountHt: '', vatRate: '20', expenseDate: today,
    supplierName: '', notes: '', receiptStoragePath: null,
    quantity: '', unit: '', unitPriceHt: '', materialId: null,
    rentalSubcategory: '', rentalItemLabel: '', rentalUnit: 'j', rentalStartDate: '', rentalEndDate: '',
    transportSubcategory: 'carburant',
    transportKm: '', transportConsumption: String(DEFAULT_CONSUMPTION_L_PER_100KM), transportFuelPrice: String(DEFAULT_FUEL_PRICE_EUR_PER_L),
  }
}

/** Montant calculé automatiquement (carburant, ou quantité × prix) ; null si le montant se saisit à la main. */
export function computedExpenseAmount(form: ExpenseFormState): { liters: number; costHt: number } | null {
  if (form.category === 'transport' && form.transportSubcategory === 'carburant') {
    const km = parseFloat(form.transportKm) || 0
    const conso = parseFloat(form.transportConsumption) || 0
    const prix = parseFloat(form.transportFuelPrice) || 0
    return computeFuel({ km, consumption: conso, pricePerLiter: prix })
  }
  const qty = parseFloat(form.quantity) || 0
  const pu = parseFloat(form.unitPriceHt) || 0
  if (qty > 0 && pu > 0) return { liters: 0, costHt: Math.round(qty * pu * 100) / 100 }
  return null
}

/** Données envoyées au serveur pour créer ou mettre à jour une dépense. */
export function buildExpensePayload(chantierId: string, form: ExpenseFormState, amountHt: number) {
  const subcategory =
    form.category === 'location' ? (form.rentalSubcategory || null) :
    form.category === 'transport' ? (form.transportSubcategory || null) :
    null
  const rentalLabel = form.category === 'location'
    ? (form.rentalItemLabel || (form.rentalSubcategory ? findRentalItem(form.rentalSubcategory)?.label : null) || null)
    : null
  const fuel = form.category === 'transport' && form.transportSubcategory === 'carburant'
  return {
    chantierId,
    category: form.category,
    label: form.label.trim() || rentalLabel || '(sans libellé)',
    amountHt,
    vatRate: parseFloat(form.vatRate) || 20,
    expenseDate: form.expenseDate,
    supplierName: form.supplierName.trim() || null,
    notes: form.notes.trim() || null,
    receiptStoragePath: form.receiptStoragePath,
    quantity: form.quantity ? parseFloat(form.quantity) : null,
    unit: form.unit || null,
    unitPriceHt: form.unitPriceHt ? parseFloat(form.unitPriceHt) : null,
    materialId: form.materialId,
    subcategory,
    transportKm: fuel ? parseFloat(form.transportKm) || null : null,
    transportConsumption: fuel ? parseFloat(form.transportConsumption) || null : null,
    transportFuelPrice: fuel ? parseFloat(form.transportFuelPrice) || null : null,
    rentalItemLabel: rentalLabel,
    rentalStartDate: form.category === 'location' && form.rentalStartDate ? form.rentalStartDate : null,
    rentalEndDate: form.category === 'location' && form.rentalEndDate ? form.rentalEndDate : null,
  }
}

/** Alertes de rentabilité : budget de coûts, sous-traitance, marge. */
export function profitabilityAlerts(p: { budgetHt: number; costTotal: number; costSubcontract: number; revenueHt: number; marginPct: number }, targetMarginPct: number) {
  const costBudget = p.budgetHt > 0 ? p.budgetHt * (1 - targetMarginPct / 100) : 0
  const budgetUsedPct = costBudget > 0 ? p.costTotal / costBudget : 0
  const subcontractPct = p.budgetHt > 0 ? p.costSubcontract / p.budgetHt : 0
  return {
    costBudget,
    budgetUsedPct,
    budgetAlert: budgetUsedPct > 0.9,
    subcontractPct,
    subcontractAlert: subcontractPct > 0.4,
    marginAlert: p.revenueHt > 0 && p.marginPct < 0.2,
  }
}
