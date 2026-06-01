'use client'

import React, { useState, useTransition, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plus, X, Pencil, Trash2, ChevronRight, Search, Loader2,
  Wrench, Calendar, CheckCircle2, Clock, AlertCircle, Link as LinkIcon,
  Package, FileText, RotateCcw, Euro, FileDown, Target, Save,
  Truck, HardHat, Send,
} from 'lucide-react'
import type { Client } from '@/lib/data/queries/clients'
import type { QuoteStub } from '@/lib/data/queries/quotes'
import type { IndividualMember } from '@/lib/data/queries/members'
import type { TeamMember } from '@/lib/data/queries/team'
import type { CatalogLaborRate, CatalogMaterial, PrestationType } from '@/lib/data/queries/catalog'
import type { ChantierExpense } from '@/lib/data/queries/chantier-profitability'
import type {
  MaintenanceContract, MaintenanceIntervention,
  MaintenanceStatus, MaintenanceFrequence, InterventionStatut, Equipement, MaintenanceContractExpense,
} from '@/lib/data/queries/maintenance'
import { fetchMaintenanceContractDetail } from '@/lib/data/queries/maintenance'
import {
  createMaintenanceContract, updateMaintenanceContract, deleteMaintenanceContract,
  createIntervention, updateIntervention, deleteIntervention, billMaintenanceIntervention,
  uploadMaintenanceInterventionPhoto,
} from '@/lib/data/mutations/maintenance'
import { sendMaintenanceInterventionReportEmail } from '@/lib/data/mutations/maintenance-report-email'
import { getClientDisplayName } from '@/lib/client'
import { LEGAL_VAT_RATES } from '@/lib/utils'
import MaintenanceDepensesSection from './MaintenanceDepensesSection'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)

const fmtDate = (iso: string) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })

const fmtDateShort = (iso: string) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })

const fmtHours = (hours: number) => {
  const h = Math.floor(hours)
  const min = Math.round((hours - h) * 60)
  return min === 0 ? `${h}h` : `${h}h${String(min).padStart(2, '0')}`
}

function today(): string {
  return new Date().toISOString().split('T')[0]
}

function computeDurationHours(start: string, end: string): number | null {
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

function mapsUrl(parts: Array<string | null | undefined>) {
  const address = parts.filter(Boolean).join(' ')
  return address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : null
}

const FREQUENCE_LABELS: Record<MaintenanceFrequence, string> = {
  mensuelle: 'Mensuelle',
  bimestrielle: 'Bimestrielle',
  trimestrielle: 'Trimestrielle',
  semestrielle: 'Semestrielle',
  annuelle: 'Annuelle',
  sur_demande: 'Sur demande',
}

const STATUS_CONFIG: Record<MaintenanceStatus, { label: string; cls: string }> = {
  actif:    { label: 'Actif',    cls: 'bg-green-500/15 text-green-600 dark:text-green-400' },
  suspendu: { label: 'Suspendu', cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
  résilié:  { label: 'Résilié',  cls: 'bg-red-500/15 text-red-500 dark:text-red-400' },
  terminé:  { label: 'Terminé',  cls: 'bg-secondary/30 text-secondary' },
}

const INTERVENTION_STATUS_CONFIG: Record<InterventionStatut, { label: string; cls: string; Icon: React.ElementType }> = {
  planifiée: { label: 'Planifiée', cls: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',   Icon: Clock },
  réalisée:  { label: 'Réalisée',  cls: 'bg-green-500/15 text-green-600 dark:text-green-400', Icon: CheckCircle2 },
  annulée:   { label: 'Annulée',   cls: 'bg-red-500/15 text-red-500 dark:text-red-400',       Icon: X },
}

const FILTER_TABS: { key: string; label: string }[] = [
  { key: 'all', label: 'Actifs' },
  { key: 'suspendu', label: 'Suspendus' },
  { key: 'résilié', label: 'Résiliés' },
  { key: 'terminé', label: 'Terminés' },
]

const inputCls = 'input w-full text-sm'
const labelCls = 'block text-xs font-semibold text-secondary mb-1'

// ─── Blank forms ──────────────────────────────────────────────────────────────

type ContractForm = {
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

type InterventionForm = {
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
  travel_mode: 'manual' | 'calculated'
}

const blankContract = (): ContractForm => ({
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

const blankIntervention = (): InterventionForm => ({
  date_intervention: today(),
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

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  initialContracts: MaintenanceContract[]
  clients: Client[]
  quotes: QuoteStub[]
  ghostMembers: IndividualMember[]
  teamMembers: TeamMember[]
  currentUserId: string | null
  currentUserName: string | null
  materials: CatalogMaterial[]
  laborRates: CatalogLaborRate[]
  prestationTypes: PrestationType[]
  orgSector?: string | null
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EntretienClient({
  initialContracts,
  clients,
  quotes,
  ghostMembers,
  teamMembers,
  currentUserId,
  currentUserName,
  materials,
  laborRates,
  prestationTypes,
  orgSector = null,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Liste unifiée des intervenants (moi + membres app + fantômes)
  type IntervenantOption = { id: string; label: string; group: 'moi' | 'app' | 'terrain' }
  const intervenants = useMemo((): IntervenantOption[] => {
    const list: IntervenantOption[] = []
    if (currentUserId && currentUserName) {
      list.push({ id: currentUserId, label: currentUserName, group: 'moi' })
    }
    for (const m of teamMembers) {
      if (m.user_id === currentUserId) continue // déjà dans "moi"
      list.push({ id: m.user_id, label: m.full_name || m.email, group: 'app' })
    }
    for (const m of ghostMembers) {
      list.push({ id: m.id, label: [m.prenom, m.name].filter(Boolean).join(' '), group: 'terrain' })
    }
    return list
  }, [currentUserId, currentUserName, teamMembers, ghostMembers])

  // Liste
  const [contracts, setContracts] = useState<MaintenanceContract[]>(initialContracts)
  const [filterTab, setFilterTab] = useState<string>('all')
  const [search, setSearch] = useState('')

  // Détail contrat sélectionné
  const [selectedContract, setSelectedContract] = useState<MaintenanceContract | null>(null)
  const [interventions, setInterventions] = useState<MaintenanceIntervention[]>([])
  const [expenses, setExpenses] = useState<MaintenanceContractExpense[]>([])
  const [loadingDetail, setLoadingDetail] = useState(false)

  // Modales
  const [showContractModal, setShowContractModal] = useState(false)
  const [editingContract, setEditingContract] = useState<MaintenanceContract | null>(null)
  const [contractForm, setContractForm] = useState<ContractForm>(blankContract())

  const [showInterventionModal, setShowInterventionModal] = useState(false)
  const [editingIntervention, setEditingIntervention] = useState<MaintenanceIntervention | null>(null)
  const [interventionForm, setInterventionForm] = useState<InterventionForm>(blankIntervention())

  const [confirmDelete, setConfirmDelete] = useState<{ type: 'contract' | 'intervention'; id: string } | null>(null)

  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // ─── Filtering ──────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    // "all" = actifs uniquement (résiliés/terminés dans leur propre onglet)
    let list = filterTab === 'all'
      ? contracts.filter(c => c.status === 'actif')
      : contracts.filter(c => c.status === filterTab)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(c =>
        c.title.toLowerCase().includes(q) ||
        (c.client?.company_name ?? '').toLowerCase().includes(q) ||
        [c.client?.first_name, c.client?.last_name].filter(Boolean).join(' ').toLowerCase().includes(q)
      )
    }
    return list
  }, [contracts, filterTab, search])

  const clientQuotes = useMemo(
    () => quotes.filter(q => q.client_id && q.client_id === contractForm.client_id),
    [quotes, contractForm.client_id],
  )

  // ─── Load detail ────────────────────────────────────────────────────────────

  async function openDetail(contract: MaintenanceContract) {
    setSelectedContract(contract)
    setLoadingDetail(true)
    const { contract: full, interventions: ivs, expenses: exp } = await fetchMaintenanceContractDetail(contract.id)
    if (full) setSelectedContract(full)
    setInterventions(ivs)
    setExpenses(exp)
    setLoadingDetail(false)
  }

  function closeDetail() {
    setSelectedContract(null)
    setInterventions([])
    setExpenses([])
  }

  // ─── Contract modal ─────────────────────────────────────────────────────────

  function openCreateContract() {
    setEditingContract(null)
    setContractForm(blankContract())
    setFormError(null)
    setShowContractModal(true)
  }

  function openEditContract(c: MaintenanceContract) {
    setEditingContract(c)
    setContractForm({
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
    })
    setFormError(null)
    setShowContractModal(true)
  }

  async function saveContract() {
    if (!contractForm.title.trim()) { setFormError('Le titre est obligatoire.'); return }
    if (!contractForm.frequence) { setFormError('La fréquence est obligatoire.'); return }
    setSaving(true)
    setFormError(null)

    const payload = {
      client_id: contractForm.client_id || null,
      chantier_id: contractForm.chantier_id || null,
      source_quote_id: contractForm.source_quote_id || null,
      site_name: contractForm.site_name || null,
      site_contact_name: contractForm.site_contact_name || null,
      site_contact_email: contractForm.site_contact_email || null,
      site_contact_phone: contractForm.site_contact_phone || null,
      site_address_line1: contractForm.site_address_line1 || null,
      site_postal_code: contractForm.site_postal_code || null,
      site_city: contractForm.site_city || null,
      period_cost_labor_ht: contractForm.period_cost_labor_ht ? parseFloat(contractForm.period_cost_labor_ht) : 0,
      period_cost_parts_ht: contractForm.period_cost_parts_ht ? parseFloat(contractForm.period_cost_parts_ht) : 0,
      period_cost_travel_ht: contractForm.period_cost_travel_ht ? parseFloat(contractForm.period_cost_travel_ht) : 0,
      period_cost_other_ht: contractForm.period_cost_other_ht ? parseFloat(contractForm.period_cost_other_ht) : 0,
      title: contractForm.title,
      description: contractForm.description || null,
      status: contractForm.status,
      equipements: contractForm.equipements,
      frequence: contractForm.frequence,
      montant_ht: contractForm.montant_ht ? parseFloat(contractForm.montant_ht) : null,
      vat_rate: contractForm.vat_rate,
      facturation_auto: contractForm.facturation_auto,
      auto_send_delay_days: contractForm.facturation_auto && contractForm.auto_send_delay_days ? parseInt(contractForm.auto_send_delay_days, 10) : null,
      date_debut: contractForm.date_debut || null,
      date_fin: contractForm.date_fin || null,
      prochaine_intervention: editingContract ? (contractForm.prochaine_intervention || null) : null,
    }

    let res: { error: string | null; id?: string }
    if (editingContract) {
      res = await updateMaintenanceContract(editingContract.id, payload)
    } else {
      res = await createMaintenanceContract(payload)
    }

    setSaving(false)
    if (res.error) { setFormError(res.error); return }

    setShowContractModal(false)
    startTransition(() => router.refresh())
    // Optimistic refresh
    const { contract: full, interventions: ivs, expenses: exp } = await fetchMaintenanceContractDetail(
      editingContract?.id ?? (res as { id?: string }).id ?? ''
    )
    if (!full) { router.refresh(); return }
    setContracts(prev =>
      editingContract
        ? prev.map(c => c.id === full.id ? full : c)
        : [full, ...prev]
    )
    if (selectedContract?.id === full.id) {
      setSelectedContract(full)
      setInterventions(ivs)
      setExpenses(exp)
    }
  }

  // ─── Delete contract ────────────────────────────────────────────────────────

  async function confirmDeleteContract(id: string) {
    const res = await deleteMaintenanceContract(id)
    if (res.error) return
    // Marque comme résilié dans la liste (disparait de l'onglet "Actifs", visible sous "Résiliés")
    setContracts(prev => prev.map(c => c.id === id ? { ...c, status: 'résilié' as MaintenanceStatus } : c))
    if (selectedContract?.id === id) {
      setSelectedContract(null)
      setInterventions([])
      setExpenses([])
    }
    setConfirmDelete(null)
  }

  // ─── Intervention modal ─────────────────────────────────────────────────────

  function openCreateIntervention() {
    setEditingIntervention(null)
    setInterventionForm({
      ...blankIntervention(),
      billable_amount_ht: selectedContract?.montant_ht != null ? String(selectedContract.montant_ht) : '',
      billable_vat_rate: selectedContract?.vat_rate ?? 20,
      cost_parts_ht: selectedContract?.period_cost_parts_ht ? String(selectedContract.period_cost_parts_ht) : '',
      cost_travel_ht: selectedContract?.period_cost_travel_ht ? String(selectedContract.period_cost_travel_ht) : '',
      cost_other_ht: selectedContract?.period_cost_other_ht ? String(selectedContract.period_cost_other_ht) : '',
    })
    setFormError(null)
    setShowInterventionModal(true)
  }

  function openEditIntervention(iv: MaintenanceIntervention) {
    setEditingIntervention(iv)
    setInterventionForm({
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
    })
    setFormError(null)
    setShowInterventionModal(true)
  }

  async function saveIntervention() {
    if (!selectedContract) return
    if (!interventionForm.date_intervention) { setFormError('La date est obligatoire.'); return }
    const selectedIntervenant = intervenants.find(i => i.id === interventionForm.intervenant_id)
    const computedDuration = interventionForm.duration_hours
      ? parseFloat(interventionForm.duration_hours)
      : computeDurationHours(interventionForm.start_time, interventionForm.end_time)
    setSaving(true)
    setFormError(null)

    const payload = {
      date_intervention: interventionForm.date_intervention,
      intervenant_id: selectedIntervenant?.group === 'terrain' ? interventionForm.intervenant_id : null,
      intervenant_user_id: selectedIntervenant && selectedIntervenant.group !== 'terrain' ? interventionForm.intervenant_id : null,
      intervenant_member_id: selectedIntervenant?.group === 'terrain' ? interventionForm.intervenant_id : null,
      statut: interventionForm.statut,
      start_time: interventionForm.start_time || null,
      end_time: interventionForm.end_time || null,
      duration_hours: computedDuration,
      rapport: interventionForm.rapport || null,
      observations: interventionForm.observations || null,
      billable_notes: interventionForm.billable_notes || null,
      billable_amount_ht: interventionForm.billable_amount_ht ? parseFloat(interventionForm.billable_amount_ht) : null,
      billable_vat_rate: interventionForm.billable_vat_rate,
      cost_parts_ht: interventionForm.cost_parts_ht ? parseFloat(interventionForm.cost_parts_ht) : 0,
      cost_travel_ht: interventionForm.cost_travel_ht ? parseFloat(interventionForm.cost_travel_ht) : 0,
      cost_other_ht: interventionForm.cost_other_ht ? parseFloat(interventionForm.cost_other_ht) : 0,
    }

    let res: { error: string | null; id?: string }
    if (editingIntervention) {
      res = await updateIntervention(editingIntervention.id, payload)
    } else {
      res = await createIntervention(selectedContract.id, payload)
    }

    setSaving(false)
    if (res.error) { setFormError(res.error); return }

    setShowInterventionModal(false)
    // Reload detail
    const { contract: full, interventions: ivs, expenses: exp } = await fetchMaintenanceContractDetail(selectedContract.id)
    if (full) {
      setSelectedContract(full)
      setContracts(prev => prev.map(c => c.id === full.id ? full : c))
    }
    setInterventions(ivs)
    setExpenses(exp)
  }

  async function invoiceIntervention(iv: MaintenanceIntervention) {
    setSaving(true)
    setFormError(null)
    const res = await billMaintenanceIntervention(iv.id)
    setSaving(false)
    if (res.error) { setFormError(res.error); return }
    if (res.invoiceId) {
      router.push(`/finances/invoice-editor?id=${res.invoiceId}&returnTo=${encodeURIComponent('/chantiers/entretien')}`)
    }
  }

  async function confirmDeleteIntervention(id: string) {
    if (!selectedContract) return
    const res = await deleteIntervention(id)
    if (res.error) return
    setInterventions(prev => prev.filter(iv => iv.id !== id))
    setExpenses(prev => prev.filter(exp => exp.maintenance_intervention_id !== id))
    setConfirmDelete(null)
  }

  // ─── Equipements helpers ────────────────────────────────────────────────────

  function addEquipement() {
    setContractForm(f => ({ ...f, equipements: [...f.equipements, { nom: '', ref: '', localisation: '' }] }))
  }

  function removeEquipement(i: number) {
    setContractForm(f => ({ ...f, equipements: f.equipements.filter((_, idx) => idx !== i) }))
  }

  function updateEquipement(i: number, field: keyof Equipement, value: string) {
    setContractForm(f => ({
      ...f,
      equipements: f.equipements.map((eq, idx) => idx === i ? { ...eq, [field]: value } : eq),
    }))
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Panneau liste ──────────────────────────────────────────── */}
      <div className={`flex flex-col ${selectedContract ? 'hidden md:flex md:w-[420px] border-r border-[var(--elevation-border)]' : 'w-full'} overflow-hidden`}>
        {/* En-tête */}
        <div className="px-6 pt-6 pb-4 flex items-center justify-between gap-3 flex-shrink-0">
          <div>
            <h1 className="text-xl font-bold text-primary">Entretien récurrent</h1>
            <p className="text-xs text-secondary mt-0.5">{contracts.length} suivi{contracts.length !== 1 ? 's' : ''}</p>
          </div>
          <button
            onClick={openCreateContract}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-accent text-black text-sm font-bold"
          >
            <Plus size={15} />
            Nouveau suivi
          </button>
        </div>

        {/* Recherche */}
        <div className="px-6 mb-3 flex-shrink-0">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher un contrat ou client..."
              className={`${inputCls} pl-8`}
            />
          </div>
        </div>

        {/* Filtres */}
        <div className="px-6 mb-4 flex gap-2 flex-wrap flex-shrink-0">
          {FILTER_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setFilterTab(tab.key)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                filterTab === tab.key
                  ? 'bg-accent text-black'
                  : 'bg-base border border-[var(--elevation-border)] text-secondary hover:text-primary'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Liste */}
        <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-3">
          {filtered.length === 0 ? (
            <div className="text-center py-16 text-secondary">
              <Wrench size={32} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">Aucun contrat</p>
              <p className="text-xs mt-1">Créez votre premier contrat d&apos;entretien.</p>
            </div>
          ) : filtered.map(c => (
            <ContractCard
              key={c.id}
              contract={c}
              isSelected={selectedContract?.id === c.id}
              onOpen={() => openDetail(c)}
              onEdit={() => openEditContract(c)}
              onDelete={() => setConfirmDelete({ type: 'contract', id: c.id })}
            />
          ))}
        </div>
      </div>

      {/* ── Panneau détail ─────────────────────────────────────────── */}
      {selectedContract && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <ContractDetail
            contract={selectedContract}
            interventions={interventions}
            expenses={expenses}
            loading={loadingDetail}
            intervenants={intervenants}
            materials={materials}
            laborRates={laborRates}
            prestationTypes={prestationTypes}
            orgSector={orgSector}
            onClose={closeDetail}
            onEdit={() => openEditContract(selectedContract)}
            onDelete={() => setConfirmDelete({ type: 'contract', id: selectedContract.id })}
            onContractUpdated={(updated) => {
              setSelectedContract(updated)
              setContracts(prev => prev.map(c => c.id === updated.id ? updated : c))
            }}
            onNewIntervention={openCreateIntervention}
            onEditIntervention={openEditIntervention}
            onBillIntervention={invoiceIntervention}
            onDeleteIntervention={id => setConfirmDelete({ type: 'intervention', id })}
          />
        </div>
      )}

      {/* ── Modal contrat ──────────────────────────────────────────── */}
      {showContractModal && (
        <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-surface dark:bg-[#121212] rounded-3xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-[var(--elevation-border)]">
              <h2 className="text-base font-bold text-primary">
                {editingContract ? 'Modifier le contrat' : 'Nouveau contrat d\'entretien'}
              </h2>
              <button onClick={() => setShowContractModal(false)} className="text-secondary hover:text-primary">
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Titre */}
              <div>
                <label className={labelCls}>Intitulé du contrat *</label>
                <input
                  value={contractForm.title}
                  onChange={e => setContractForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="Ex : Entretien PAC - Résidence Bellevue"
                  className={inputCls}
                />
              </div>

              {/* Client + Statut */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Client</label>
	                  <select
	                    value={contractForm.client_id}
	                    onChange={e => setContractForm(f => ({ ...f, client_id: e.target.value, source_quote_id: '' }))}
	                    className={inputCls}
	                  >
                    <option value="">Aucun</option>
                    {clients.map(c => (
                      <option key={c.id} value={c.id}>{getClientDisplayName(c)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Statut</label>
                  <select
                    value={contractForm.status}
                    onChange={e => setContractForm(f => ({ ...f, status: e.target.value as MaintenanceStatus }))}
                    className={inputCls}
                  >
                    {(Object.keys(STATUS_CONFIG) as MaintenanceStatus[]).map(s => (
                      <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
                    ))}
                  </select>
	                </div>
	              </div>

              {/* Devis source */}
              <div>
                <label className={labelCls}>Devis source</label>
                <select
                  value={contractForm.source_quote_id}
                  onChange={e => {
                    const quote = quotes.find(q => q.id === e.target.value)
                    setContractForm(f => ({
                      ...f,
                      source_quote_id: e.target.value,
                      title: quote?.title ? `Entretien - ${quote.title}` : f.title,
                      montant_ht: quote?.total_ht != null ? String(quote.total_ht) : f.montant_ht,
                      site_contact_name: quote?.client_contact_name ?? f.site_contact_name,
                      site_contact_email: quote?.client_contact_email ?? f.site_contact_email,
                      site_contact_phone: quote?.client_contact_phone ?? f.site_contact_phone,
                      site_address_line1: quote?.client_address_line1 ?? f.site_address_line1,
                      site_postal_code: quote?.client_postal_code ?? f.site_postal_code,
                      site_city: quote?.client_city ?? f.site_city,
                      period_cost_labor_ht: '',
                      period_cost_parts_ht: '',
                      period_cost_travel_ht: '',
                      period_cost_other_ht: quote?.internal_cost_total_ht ? String(quote.internal_cost_total_ht) : f.period_cost_other_ht,
                    }))
                  }}
                  disabled={!contractForm.client_id || clientQuotes.length === 0}
                  className={inputCls}
                >
                  <option value="">
                    {!contractForm.client_id ? "Sélectionnez d'abord un client" : clientQuotes.length === 0 ? 'Aucun devis pour ce client' : 'Aucun devis lié'}
                  </option>
                  {clientQuotes.map(q => (
                    <option key={q.id} value={q.id}>
                      {[q.number, q.title].filter(Boolean).join(' · ') || 'Devis'}{q.total_ht != null ? ` · ${fmt(q.total_ht)} HT` : ''}{q.internal_cost_total_ht > 0 ? ` · coût ${fmt(q.internal_cost_total_ht)}` : ''}
                    </option>
                  ))}
                </select>
                {contractForm.source_quote_id && (() => {
                  const q = quotes.find(x => x.id === contractForm.source_quote_id)
                  if (!q || !q.internal_cost_total_ht) return null
                  return (
                    <div className="mt-2 px-3 py-2 rounded-lg bg-emerald-500/8 border border-emerald-500/20 text-xs text-emerald-700 dark:text-emerald-400 flex items-center justify-between">
                      <span>Coût interne importé du devis</span>
                      <span className="font-bold tabular-nums">{fmt(q.internal_cost_total_ht)}</span>
                    </div>
                  )
                })()}
              </div>

	              {/* Fréquence */}
	              <div className="grid grid-cols-2 gap-3">
	                <div>
	                  <label className={labelCls}>Fréquence *</label>
                  <select
                    value={contractForm.frequence}
                    onChange={e => setContractForm(f => ({ ...f, frequence: e.target.value as MaintenanceFrequence }))}
                    className={inputCls}
                  >
                    {(Object.keys(FREQUENCE_LABELS) as MaintenanceFrequence[]).map(k => (
                      <option key={k} value={k}>{FREQUENCE_LABELS[k]}</option>
	                    ))}
	                  </select>
	                </div>
	                {editingContract && (
	                <div>
	                  <label className={labelCls}>Prochaine intervention</label>
	                  <input
                    type="date"
                    value={contractForm.prochaine_intervention}
                    onChange={e => setContractForm(f => ({ ...f, prochaine_intervention: e.target.value }))}
	                    className={inputCls}
	                  />
	                </div>
	                )}
	              </div>

              {/* Site d'intervention */}
              <div className="space-y-3 rounded-xl bg-base border border-[var(--elevation-border)] p-3">
                <p className="text-xs font-bold text-secondary uppercase tracking-wider">Site d&apos;intervention</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Nom du lieu</label>
                    <input
                      value={contractForm.site_name}
                      onChange={e => setContractForm(f => ({ ...f, site_name: e.target.value }))}
                      placeholder="Ex : Résidence Bellevue, local technique..."
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Contact sur site</label>
                    <input
                      value={contractForm.site_contact_name}
                      onChange={e => setContractForm(f => ({ ...f, site_contact_name: e.target.value }))}
                      placeholder="Nom du référent"
                      className={inputCls}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Téléphone</label>
                    <input
                      value={contractForm.site_contact_phone}
                      onChange={e => setContractForm(f => ({ ...f, site_contact_phone: e.target.value }))}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Email</label>
                    <input
                      type="email"
                      value={contractForm.site_contact_email}
                      onChange={e => setContractForm(f => ({ ...f, site_contact_email: e.target.value }))}
                      className={inputCls}
                    />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Adresse</label>
                  <input
                    value={contractForm.site_address_line1}
                    onChange={e => setContractForm(f => ({ ...f, site_address_line1: e.target.value }))}
                    placeholder="Numéro et rue"
                    className={inputCls}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Code postal</label>
                    <input
                      value={contractForm.site_postal_code}
                      onChange={e => setContractForm(f => ({ ...f, site_postal_code: e.target.value }))}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Ville</label>
                    <input
                      value={contractForm.site_city}
                      onChange={e => setContractForm(f => ({ ...f, site_city: e.target.value }))}
                      className={inputCls}
                    />
                  </div>
                </div>
              </div>

              {/* Montant HT + TVA */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Prix facturé par période HT (€)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={contractForm.montant_ht}
                    onChange={e => setContractForm(f => ({ ...f, montant_ht: e.target.value }))}
                    placeholder="0.00"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Taux TVA</label>
                  <select
                    value={contractForm.vat_rate}
                    onChange={e => setContractForm(f => ({ ...f, vat_rate: parseFloat(e.target.value) }))}
                    className={inputCls}
                  >
                    {LEGAL_VAT_RATES.map(r => (
                      <option key={r} value={r}>{r}%</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Dates début / fin */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Date de début</label>
                  <input
                    type="date"
                    value={contractForm.date_debut}
                    onChange={e => setContractForm(f => ({ ...f, date_debut: e.target.value }))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Date de fin</label>
                  <input
                    type="date"
                    value={contractForm.date_fin}
                    onChange={e => setContractForm(f => ({ ...f, date_fin: e.target.value }))}
                    className={inputCls}
                  />
                </div>
              </div>

              {/* Description */}
              <div>
                <label className={labelCls}>Description / observations</label>
                <textarea
                  value={contractForm.description}
                  onChange={e => setContractForm(f => ({ ...f, description: e.target.value }))}
                  rows={2}
                  className={`${inputCls} resize-none`}
                  placeholder="Périmètre du contrat, conditions particulières..."
                />
              </div>

              {/* Facturation auto */}
              <div className="flex items-center gap-3 p-3 rounded-xl bg-base border border-[var(--elevation-border)]">
                <input
                  id="facturation_auto"
                  type="checkbox"
                  checked={contractForm.facturation_auto}
                  onChange={e => setContractForm(f => ({
                    ...f,
                    facturation_auto: e.target.checked,
                    auto_send_delay_days: e.target.checked ? f.auto_send_delay_days : '',
                  }))}
                  className="w-4 h-4 accent-accent"
                />
                <label htmlFor="facturation_auto" className="text-sm text-primary cursor-pointer">
                  Activer la facturation automatique récurrente
                </label>
              </div>

              {contractForm.facturation_auto && (
                <div className="rounded-xl bg-base border border-[var(--elevation-border)] p-3 space-y-3">
                  <p className="text-xs font-bold text-secondary uppercase tracking-wider">Validation avant envoi</p>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="auto_send_mode"
                      checked={!contractForm.auto_send_delay_days}
                      onChange={() => setContractForm(f => ({ ...f, auto_send_delay_days: '' }))}
                      className="mt-1 w-4 h-4 accent-accent"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-primary">Validation manuelle</span>
                      <span className="block text-xs text-secondary">La facture est préparée, puis attend votre validation.</span>
                    </span>
                  </label>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="auto_send_mode"
                      checked={!!contractForm.auto_send_delay_days}
                      onChange={() => setContractForm(f => ({ ...f, auto_send_delay_days: f.auto_send_delay_days || '1' }))}
                      className="mt-1 w-4 h-4 accent-accent"
                    />
                    <span className="flex-1">
                      <span className="block text-sm font-semibold text-primary">Envoyer automatiquement si non validée</span>
                      <span className="block text-xs text-secondary mb-2">Si personne ne touche au brouillon, il partira avec son PDF après le délai choisi.</span>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={contractForm.auto_send_delay_days}
                        onChange={e => setContractForm(f => ({ ...f, auto_send_delay_days: e.target.value }))}
                        disabled={!contractForm.auto_send_delay_days}
                        className="input w-28 text-sm tabular-nums disabled:opacity-50"
                        aria-label="Délai d'envoi automatique en jours"
                      />
                      <span className="ml-2 text-xs text-secondary">jour(s) après préparation</span>
                    </span>
                  </label>
                </div>
              )}

	              {/* Équipements */}
	              <div>
	                <div className="flex items-center justify-between mb-2">
	                  <label className={labelCls + ' mb-0'}>Installations à maintenir <span className="font-normal text-secondary">(optionnel)</span></label>
                  <button
                    type="button"
                    onClick={addEquipement}
                    className="flex items-center gap-1 text-xs text-accent font-semibold hover:opacity-80"
                  >
                    <Plus size={12} /> Ajouter
                  </button>
	                </div>
	                {contractForm.equipements.length === 0 ? (
	                  <p className="text-xs text-secondary italic py-1">Ajoutez seulement si vous voulez suivre une PAC, chaudière, portail, groupe froid, appareil, zone ou élément précis.</p>
                ) : (
                  <div className="space-y-2">
                    {contractForm.equipements.map((eq, i) => (
                      <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
                        <input
                          value={eq.nom}
                          onChange={e => updateEquipement(i, 'nom', e.target.value)}
                          placeholder="Nom"
                          className={inputCls}
                        />
                        <input
                          value={eq.ref ?? ''}
                          onChange={e => updateEquipement(i, 'ref', e.target.value)}
                          placeholder="Réf."
                          className={inputCls}
                        />
                        <input
                          value={eq.localisation ?? ''}
                          onChange={e => updateEquipement(i, 'localisation', e.target.value)}
                          placeholder="Localisation"
                          className={inputCls}
                        />
                        <button onClick={() => removeEquipement(i)} className="text-secondary hover:text-red-500">
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {formError && (
                <p className="text-sm text-red-500 flex items-center gap-1.5">
                  <AlertCircle size={14} /> {formError}
                </p>
              )}
            </div>

            <div className="px-6 pb-5 flex justify-end gap-3">
              <button
                onClick={() => setShowContractModal(false)}
                className="px-5 py-2.5 rounded-full border border-[var(--elevation-border)] text-sm font-semibold"
              >
                Annuler
              </button>
              <button
                onClick={saveContract}
                disabled={saving}
                className="px-6 py-2.5 rounded-full bg-accent text-black text-sm font-bold disabled:opacity-50 flex items-center gap-2"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                {editingContract ? 'Enregistrer' : 'Créer le contrat'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal intervention ─────────────────────────────────────── */}
      {showInterventionModal && (
        <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-surface dark:bg-[#121212] rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-[var(--elevation-border)]">
              <h2 className="text-base font-bold text-primary">
                {editingIntervention ? 'Modifier l\'intervention' : 'Saisir une intervention'}
              </h2>
              <button onClick={() => setShowInterventionModal(false)} className="text-secondary hover:text-primary">
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Date + Statut */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Date *</label>
                  <input
                    type="date"
                    value={interventionForm.date_intervention}
                    onChange={e => setInterventionForm(f => ({ ...f, date_intervention: e.target.value }))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Statut</label>
                  <select
                    value={interventionForm.statut}
                    onChange={e => setInterventionForm(f => ({ ...f, statut: e.target.value as InterventionStatut }))}
                    className={inputCls}
                  >
                    <option value="planifiée">Planifiée</option>
                    <option value="réalisée">Réalisée</option>
                    <option value="annulée">Annulée</option>
                  </select>
                </div>
              </div>

              {/* Intervenant */}
              <div>
                <label className={labelCls}>Intervenant</label>
                <select
                  value={interventionForm.intervenant_id}
                  onChange={e => setInterventionForm(f => ({ ...f, intervenant_id: e.target.value }))}
                  className={inputCls}
                >
                  <option value="">Non assigné</option>
                  {currentUserId && currentUserName && (
                    <optgroup label="Moi">
                      <option value={currentUserId}>{currentUserName}</option>
                    </optgroup>
                  )}
                  {teamMembers.filter(m => m.user_id !== currentUserId).length > 0 && (
                    <optgroup label="Équipe">
                      {teamMembers
                        .filter(m => m.user_id !== currentUserId)
                        .map(m => (
                          <option key={m.user_id} value={m.user_id}>
                            {m.full_name || m.email}
                          </option>
                        ))}
                    </optgroup>
                  )}
                  {ghostMembers.length > 0 && (
                    <optgroup label="Intervenants terrain">
                      {ghostMembers.map(m => (
                        <option key={m.id} value={m.id}>
                          {[m.prenom, m.name].filter(Boolean).join(' ')}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>

              {/* Horaires / pointage */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={labelCls}>Début</label>
                  <input
                    type="time"
                    value={interventionForm.start_time}
                    onChange={e => {
                      const start = e.target.value
                      const duration = computeDurationHours(start, interventionForm.end_time)
                      setInterventionForm(f => ({ ...f, start_time: start, duration_hours: duration ? String(duration) : f.duration_hours }))
                    }}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Fin</label>
                  <input
                    type="time"
                    value={interventionForm.end_time}
                    onChange={e => {
                      const end = e.target.value
                      const duration = computeDurationHours(interventionForm.start_time, end)
                      setInterventionForm(f => ({ ...f, end_time: end, duration_hours: duration ? String(duration) : f.duration_hours }))
                    }}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Durée h</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={interventionForm.duration_hours}
                    onChange={e => setInterventionForm(f => ({ ...f, duration_hours: e.target.value }))}
                    className={inputCls}
                  />
                </div>
              </div>

              {/* Rapport */}
              <div>
                <label className={labelCls}>Rapport d&apos;intervention</label>
                <textarea
                  value={interventionForm.rapport}
                  onChange={e => setInterventionForm(f => ({ ...f, rapport: e.target.value }))}
                  rows={3}
                  className={`${inputCls} resize-none`}
                  placeholder="Travaux effectués, constats, relevés..."
                />
              </div>

              {/* Observations */}
              <div>
                <label className={labelCls}>Observations / pièces changées</label>
                <textarea
                  value={interventionForm.observations}
                  onChange={e => setInterventionForm(f => ({ ...f, observations: e.target.value }))}
                  rows={2}
                  className={`${inputCls} resize-none`}
                  placeholder="Anomalies, pièces remplacées, recommandations..."
                />
              </div>

              {/* Observations facturables */}
              {(interventionForm.statut === 'réalisée' || editingIntervention?.invoice_id) && (
                <div>
                  <label className={labelCls}>
                    Observations facturables
                    <span className="ml-1 font-normal text-secondary">(ajoutées en ligne sur la facture)</span>
                  </label>
                  <textarea
                    value={interventionForm.billable_notes}
                    onChange={e => setInterventionForm(f => ({ ...f, billable_notes: e.target.value }))}
                    rows={2}
                    className={`${inputCls} resize-none`}
                    placeholder="Ex : Remplacement filtre + recharge fluide..."
                  />
                </div>
              )}

              {interventionForm.statut === 'réalisée' && (
                <>
                  {/* Pièces + Autres */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>Pièces HT</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={interventionForm.cost_parts_ht}
                        onChange={e => setInterventionForm(f => ({ ...f, cost_parts_ht: e.target.value }))}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Autres HT</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={interventionForm.cost_other_ht}
                        onChange={e => setInterventionForm(f => ({ ...f, cost_other_ht: e.target.value }))}
                        className={inputCls}
                      />
                    </div>
                  </div>

                  {/* Déplacement */}
                  <div className="rounded-xl bg-base border border-[var(--elevation-border)] p-3 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-bold text-secondary uppercase tracking-wider">Déplacement</p>
                      <div className="flex rounded-lg overflow-hidden border border-[var(--elevation-border)] text-xs">
                        <button
                          type="button"
                          onClick={() => setInterventionForm(f => ({ ...f, travel_mode: 'manual' }))}
                          className={`px-3 py-1 font-semibold transition-colors ${interventionForm.travel_mode === 'manual' ? 'bg-accent text-black' : 'bg-base text-secondary hover:text-primary'}`}
                        >
                          Montant libre
                        </button>
                        <button
                          type="button"
                          onClick={() => setInterventionForm(f => ({ ...f, travel_mode: 'calculated' }))}
                          className={`px-3 py-1 font-semibold transition-colors ${interventionForm.travel_mode === 'calculated' ? 'bg-accent text-black' : 'bg-base text-secondary hover:text-primary'}`}
                        >
                          Calcul km
                        </button>
                      </div>
                    </div>

                    {interventionForm.travel_mode === 'manual' ? (
                      <div>
                        <label className={labelCls}>Coût déplacement HT (€)</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={interventionForm.cost_travel_ht}
                          onChange={e => setInterventionForm(f => ({ ...f, cost_travel_ht: e.target.value }))}
                          placeholder="0.00"
                          className={inputCls}
                        />
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className={labelCls}>Distance aller-retour (km)</label>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={interventionForm.travel_km}
                              onChange={e => {
                                const km = e.target.value
                                const price = parseFloat(interventionForm.travel_fuel_price_per_liter.replace(',', '.'))
                                const conso = parseFloat(interventionForm.travel_fuel_consumption_per_100km.replace(',', '.'))
                                const distKm = parseFloat(km.replace(',', '.'))
                                const computed = Number.isFinite(distKm) && Number.isFinite(price) && Number.isFinite(conso) && conso > 0
                                  ? Math.round(distKm * (conso / 100) * price * 100) / 100
                                  : null
                                setInterventionForm(f => ({
                                  ...f,
                                  travel_km: km,
                                  cost_travel_ht: computed !== null ? String(computed) : f.cost_travel_ht,
                                }))
                              }}
                              placeholder="Ex : 80"
                              className={inputCls}
                            />
                          </div>
                          <div>
                            <label className={labelCls}>Prix carburant (€/L)</label>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={interventionForm.travel_fuel_price_per_liter}
                              onChange={e => {
                                const price = e.target.value
                                const km = parseFloat(interventionForm.travel_km.replace(',', '.'))
                                const conso = parseFloat(interventionForm.travel_fuel_consumption_per_100km.replace(',', '.'))
                                const priceNum = parseFloat(price.replace(',', '.'))
                                const computed = Number.isFinite(km) && Number.isFinite(priceNum) && Number.isFinite(conso) && conso > 0
                                  ? Math.round(km * (conso / 100) * priceNum * 100) / 100
                                  : null
                                setInterventionForm(f => ({
                                  ...f,
                                  travel_fuel_price_per_liter: price,
                                  cost_travel_ht: computed !== null ? String(computed) : f.cost_travel_ht,
                                }))
                              }}
                              placeholder="Ex : 1.85"
                              className={inputCls}
                            />
                          </div>
                          <div>
                            <label className={labelCls}>Conso (L/100 km)</label>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={interventionForm.travel_fuel_consumption_per_100km}
                              onChange={e => {
                                const conso = e.target.value
                                const km = parseFloat(interventionForm.travel_km.replace(',', '.'))
                                const price = parseFloat(interventionForm.travel_fuel_price_per_liter.replace(',', '.'))
                                const consoNum = parseFloat(conso.replace(',', '.'))
                                const computed = Number.isFinite(km) && Number.isFinite(price) && Number.isFinite(consoNum) && consoNum > 0
                                  ? Math.round(km * (consoNum / 100) * price * 100) / 100
                                  : null
                                setInterventionForm(f => ({
                                  ...f,
                                  travel_fuel_consumption_per_100km: conso,
                                  cost_travel_ht: computed !== null ? String(computed) : f.cost_travel_ht,
                                }))
                              }}
                              placeholder="Ex : 7"
                              className={inputCls}
                            />
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1">
                            <label className={labelCls}>Coût calculé HT (€) <span className="font-normal text-secondary">modifiable</span></label>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={interventionForm.cost_travel_ht}
                              onChange={e => setInterventionForm(f => ({ ...f, cost_travel_ht: e.target.value }))}
                              placeholder="Calculé automatiquement"
                              className={inputCls}
                            />
                          </div>
                          {interventionForm.travel_km && interventionForm.travel_fuel_price_per_liter && interventionForm.travel_fuel_consumption_per_100km && (
                            <p className="text-xs text-secondary mt-4 flex-shrink-0">
                              {parseFloat(interventionForm.travel_km)} km × {(parseFloat(interventionForm.travel_fuel_consumption_per_100km) / 100).toFixed(3)} L/km × {parseFloat(interventionForm.travel_fuel_price_per_liter)} €/L
                            </p>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>Montant à facturer HT</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={interventionForm.billable_amount_ht}
                        onChange={e => setInterventionForm(f => ({ ...f, billable_amount_ht: e.target.value }))}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>TVA facture</label>
                      <select
                        value={interventionForm.billable_vat_rate}
                        onChange={e => setInterventionForm(f => ({ ...f, billable_vat_rate: parseFloat(e.target.value) }))}
                        className={inputCls}
                      >
                        {LEGAL_VAT_RATES.map(r => (
                          <option key={r} value={r}>{r}%</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </>
              )}

              {formError && (
                <p className="text-sm text-red-500 flex items-center gap-1.5">
                  <AlertCircle size={14} /> {formError}
                </p>
              )}
            </div>

            <div className="px-6 pb-5 flex justify-end gap-3">
              <button
                onClick={() => setShowInterventionModal(false)}
                className="px-5 py-2.5 rounded-full border border-[var(--elevation-border)] text-sm font-semibold"
              >
                Annuler
              </button>
              <button
                onClick={saveIntervention}
                disabled={saving}
                className="px-6 py-2.5 rounded-full bg-accent text-black text-sm font-bold disabled:opacity-50 flex items-center gap-2"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                {editingIntervention ? 'Enregistrer' : 'Saisir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirmation suppression ───────────────────────────────── */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[300] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-surface dark:bg-[#121212] rounded-2xl shadow-2xl p-6 w-full max-w-sm text-center">
            <p className="font-semibold text-primary mb-2">
              {confirmDelete.type === 'contract' ? 'Résilier ce contrat ?' : 'Supprimer cette intervention ?'}
            </p>
            <p className="text-sm text-secondary mb-5">
              {confirmDelete.type === 'contract'
                ? 'Le contrat passera au statut "Résilié". Cette action peut être annulée en rééditant le contrat.'
                : 'Cette intervention sera supprimée définitivement.'}
            </p>
            <div className="flex justify-center gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="px-5 py-2 rounded-full border border-[var(--elevation-border)] text-sm font-semibold"
              >
                Annuler
              </button>
              <button
                onClick={() =>
                  confirmDelete.type === 'contract'
                    ? confirmDeleteContract(confirmDelete.id)
                    : confirmDeleteIntervention(confirmDelete.id)
                }
                className="px-5 py-2 rounded-full bg-red-500 text-white text-sm font-bold"
              >
                {confirmDelete.type === 'contract' ? 'Résilier' : 'Supprimer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── ContractCard ─────────────────────────────────────────────────────────────

function ContractCard({
  contract: c, isSelected, onOpen, onEdit, onDelete,
}: {
  contract: MaintenanceContract
  isSelected: boolean
  onOpen: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const clientName = c.client
    ? (c.client.company_name || [c.client.first_name, c.client.last_name].filter(Boolean).join(' ') || 'Client')
    : null

  return (
    <div
      className={`rounded-2xl border p-4 cursor-pointer transition-all hover:border-accent/40 ${
        isSelected
          ? 'border-accent bg-accent/5'
          : 'border-[var(--elevation-border)] bg-surface dark:bg-[#121212]'
      }`}
      onClick={onOpen}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="font-semibold text-sm text-primary leading-tight flex-1">{c.title}</p>
        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold flex-shrink-0 ${STATUS_CONFIG[c.status].cls}`}>
          {STATUS_CONFIG[c.status].label}
        </span>
      </div>

      <div className="flex items-center gap-3 text-xs text-secondary mb-3">
        {clientName && <span className="font-medium text-primary">{clientName}</span>}
        {clientName && <span className="opacity-40">·</span>}
        <span>{FREQUENCE_LABELS[c.frequence]}</span>
        {c.interventions_count > 0 && (
          <>
            <span className="opacity-40">·</span>
            <span>{c.interventions_count} intervention{c.interventions_count > 1 ? 's' : ''}</span>
          </>
        )}
      </div>

      {c.equipements && c.equipements.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {c.equipements.slice(0, 3).map((eq, i) => (
            <span key={i} className="px-2 py-0.5 rounded-full bg-base border border-[var(--elevation-border)] text-xs text-secondary">
              {eq.nom}
            </span>
          ))}
          {c.equipements.length > 3 && (
            <span className="px-2 py-0.5 rounded-full bg-base text-xs text-secondary">+{c.equipements.length - 3}</span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-secondary">
          {c.prochaine_intervention ? (
            <>
              <Calendar size={11} />
              <span>Prochaine : {fmtDateShort(c.prochaine_intervention)}</span>
            </>
          ) : (
            <span className="opacity-50">Aucune intervention planifiée</span>
          )}
        </div>

        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
          <button
            onClick={onEdit}
            className="p-1.5 rounded-lg hover:bg-base text-secondary hover:text-primary"
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded-lg hover:bg-red-500/10 text-secondary hover:text-red-500"
          >
            <Trash2 size={13} />
          </button>
          <ChevronRight size={14} className="text-secondary ml-1" />
        </div>
      </div>
    </div>
  )
}

// ─── ContractDetail ───────────────────────────────────────────────────────────

type ExpectedCostCategory = 'labor' | 'parts' | 'travel' | 'other'

type ExpectedBudgetForm = Record<ExpectedCostCategory, string>

type CatalogBudgetDraft = {
  source: 'material' | 'labor' | 'prestation' | 'manual'
  catalogId: string
  category: ExpectedCostCategory
  label: string
  quantity: string
  unit: string
  unitCost: string
}

const COST_CATEGORY_META: Record<ExpectedCostCategory, { label: string; detail: string; Icon: React.ElementType }> = {
  labor: { label: "Main-d'oeuvre", detail: 'Temps prévu par période, au coût interne.', Icon: Wrench },
  parts: { label: 'Produits / pièces', detail: 'Consommables, pièces ou achats récurrents.', Icon: Package },
  travel: { label: 'Déplacement', detail: 'Carburant, trajet, péage ou frais de route.', Icon: Truck },
  other: { label: 'Autres coûts', detail: 'Sous-traitance, forfaits ou coûts non classés.', Icon: FileText },
}

function formatMoneyInput(value: number | null | undefined) {
  return value && value > 0 ? String(value) : ''
}

function parseMoneyInput(value: string) {
  const n = parseFloat(value.replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : 0
}

function contractExpectedBudget(c: MaintenanceContract): ExpectedBudgetForm {
  return {
    labor: formatMoneyInput(c.period_cost_labor_ht),
    parts: formatMoneyInput(c.period_cost_parts_ht),
    travel: formatMoneyInput(c.period_cost_travel_ht),
    other: formatMoneyInput(c.period_cost_other_ht),
  }
}

function expectedBudgetTotals(form: ExpectedBudgetForm) {
  const labor = parseMoneyInput(form.labor)
  const parts = parseMoneyInput(form.parts)
  const travel = parseMoneyInput(form.travel)
  const other = parseMoneyInput(form.other)
  return { labor, parts, travel, other, total: labor + parts + travel + other }
}

function marginTone(pct: number) {
  if (pct >= 0.2) return 'bg-green-500'
  if (pct >= 0.05) return 'bg-amber-500'
  return 'bg-red-500'
}

function marginTextTone(value: number) {
  if (value >= 0) return 'text-green-600 dark:text-green-400'
  return 'text-red-500'
}

function emptyCatalogBudgetDraft(): CatalogBudgetDraft {
  return {
    source: 'material',
    catalogId: '',
    category: 'parts',
    label: '',
    quantity: '1',
    unit: '',
    unitCost: '',
  }
}

function invoiceRevenueForIntervention(iv: MaintenanceIntervention, fallbackRevenue: number) {
  return iv.invoice?.total_ht ?? iv.billable_amount_ht ?? fallbackRevenue
}

function isIssuedInvoiceStatus(status: string | null | undefined) {
  return status === 'sent' || status === 'partial' || status === 'paid'
}

function buildMaintenancePeriodRows(
  c: MaintenanceContract,
  interventions: MaintenanceIntervention[],
  expenses: MaintenanceContractExpense[],
) {
  const expectedRevenue = c.montant_ht ?? 0
  const expectedCost = (c.period_cost_labor_ht ?? 0) + (c.period_cost_parts_ht ?? 0) + (c.period_cost_travel_ht ?? 0) + (c.period_cost_other_ht ?? 0)
  const rows: Record<string, {
    period: string
    label: string
    interventions: number
    revenueHt: number
    billedRevenueHt: number
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
  }> = {}

  const ensure = (key: string) => {
    rows[key] ??= {
      period: key,
      label: new Date(`${key}-01T00:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
      interventions: 0,
      revenueHt: 0,
      billedRevenueHt: 0,
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
    }
    return rows[key]
  }

  const currentKey = new Date().toISOString().slice(0, 7)
  ensure(currentKey)

  for (const iv of interventions) {
    if (!iv.date_intervention) continue
    const key = iv.date_intervention.slice(0, 7)
    const row = ensure(key)
    if (iv.statut !== 'réalisée') continue
    row.interventions += 1
    const revenue = invoiceRevenueForIntervention(iv, expectedRevenue)
    if (isIssuedInvoiceStatus(iv.invoice?.status)) {
      row.billedRevenueHt += revenue
    } else if (iv.invoice_id) {
      row.draftRevenueHt += revenue
    } else {
      row.pendingRevenueHt += revenue
    }
    row.laborCostHt += iv.labor_cost_ht ?? 0
  }

  for (const expense of expenses) {
    if (!expense.expense_date) continue
    const key = expense.expense_date.slice(0, 7)
    const row = ensure(key)
    const amount = expense.amount_ht ?? 0
    if (expense.category === 'materiel') row.partsCostHt += amount
    else if (expense.category === 'transport') row.travelCostHt += amount
    else row.otherCostHt += amount
  }

  return Object.values(rows)
    .map(row => {
      const actualCost = row.laborCostHt + row.partsCostHt + row.travelCostHt + row.otherCostHt
      const revenue = row.billedRevenueHt
      const cost = actualCost > 0 ? actualCost : row.expectedCostHt
      const margin = revenue - cost
      return {
        ...row,
        revenueHt: revenue,
        actualCostHt: cost,
        marginEur: margin,
        marginPct: revenue > 0 ? margin / revenue : 0,
      }
    })
    .sort((a, b) => b.period.localeCompare(a.period))
    .slice(0, 6)
}

function ContractDetail({
  contract: c, interventions, expenses, loading, intervenants,
  materials, laborRates, prestationTypes, orgSector,
  onClose, onEdit, onDelete, onNewIntervention, onEditIntervention, onDeleteIntervention,
  onBillIntervention, onContractUpdated,
}: {
  contract: MaintenanceContract
  interventions: MaintenanceIntervention[]
  expenses: MaintenanceContractExpense[]
  loading: boolean
  intervenants: { id: string; label: string; group: string }[]
  materials: CatalogMaterial[]
  laborRates: CatalogLaborRate[]
  prestationTypes: PrestationType[]
  orgSector: string | null
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
  onContractUpdated: (updated: MaintenanceContract) => void
  onNewIntervention: () => void
  onEditIntervention: (iv: MaintenanceIntervention) => void
  onBillIntervention: (iv: MaintenanceIntervention) => void
  onDeleteIntervention: (id: string) => void
}) {
  const [expandedIv, setExpandedIv] = useState<string | null>(null)
  const [budgetOpen, setBudgetOpen] = useState(false)
  const [margeOpen, setMargeOpen] = useState(false)
  const [budgetForm, setBudgetForm] = useState<ExpectedBudgetForm>(() => contractExpectedBudget(c))
  const [budgetDraft, setBudgetDraft] = useState<CatalogBudgetDraft>(() => emptyCatalogBudgetDraft())
  const [budgetSaving, setBudgetSaving] = useState(false)
  const [budgetError, setBudgetError] = useState<string | null>(null)

  useEffect(() => {
    setBudgetForm(contractExpectedBudget(c))
    setBudgetDraft(emptyCatalogBudgetDraft())
    setBudgetError(null)
  }, [c.id, c.period_cost_labor_ht, c.period_cost_parts_ht, c.period_cost_travel_ht, c.period_cost_other_ht])

  const montantTTC = c.montant_ht !== null
    ? c.montant_ht * (1 + c.vat_rate / 100)
    : null
  const expectedCost = (c.period_cost_labor_ht ?? 0) + (c.period_cost_parts_ht ?? 0) + (c.period_cost_travel_ht ?? 0) + (c.period_cost_other_ht ?? 0)
  const expectedMargin = (c.montant_ht ?? 0) - expectedCost
  const editedBudget = expectedBudgetTotals(budgetForm)
  const editedExpectedMargin = (c.montant_ht ?? 0) - editedBudget.total
  const editedExpectedMarginPct = c.montant_ht && c.montant_ht > 0 ? editedExpectedMargin / c.montant_ht : 0
  const budgetCategories = Object.keys(COST_CATEGORY_META) as ExpectedCostCategory[]

  const sortedInterventions = [...interventions].sort(
    (a, b) => new Date(b.date_intervention).getTime() - new Date(a.date_intervention).getTime()
  )

  const periodRows = buildMaintenancePeriodRows(c, interventions, expenses)

  const planifiees = sortedInterventions.filter(iv => iv.statut === 'planifiée')
  const realisees = sortedInterventions.filter(iv => iv.statut !== 'planifiée')
  const siteAddress = [c.site_address_line1, c.site_postal_code, c.site_city].filter(Boolean).join(', ')
  const siteMapsUrl = mapsUrl([c.site_address_line1, c.site_postal_code, c.site_city])

  function applyBudgetCatalogItem(source: CatalogBudgetDraft['source'], catalogId: string) {
    if (!catalogId) {
      setBudgetDraft(f => ({ ...f, source, catalogId: '', label: '', unit: '', unitCost: '', category: source === 'labor' ? 'labor' : 'parts' }))
      return
    }
    if (source === 'material') {
      const item = materials.find(m => m.id === catalogId)
      if (!item) return
      setBudgetDraft(f => ({
        ...f,
        source,
        catalogId,
        category: item.item_kind === 'service' ? 'other' : 'parts',
        label: item.name,
        unit: item.unit ?? f.unit,
        unitCost: String(item.purchase_price ?? item.sale_price ?? 0),
      }))
    } else if (source === 'labor') {
      const item = laborRates.find(l => l.id === catalogId)
      if (!item) return
      setBudgetDraft(f => ({
        ...f,
        source,
        catalogId,
        category: 'labor',
        label: item.designation,
        unit: item.unit ?? f.unit ?? 'h',
        unitCost: String(item.cost_rate ?? item.purchase_price ?? item.rate ?? 0),
      }))
    } else if (source === 'prestation') {
      const item = prestationTypes.find(p => p.id === catalogId)
      if (!item) return
      setBudgetDraft(f => ({
        ...f,
        source,
        catalogId,
        category: 'other',
        label: item.name,
        unit: item.unit ?? f.unit ?? 'forfait',
        unitCost: String(item.base_cost_ht ?? 0),
      }))
    }
  }

  function addBudgetDraft() {
    const quantity = parseFloat(budgetDraft.quantity.replace(',', '.')) || 0
    const unitCost = parseFloat(budgetDraft.unitCost.replace(',', '.')) || 0
    const amount = Math.round(quantity * unitCost * 100) / 100
    if (!budgetDraft.label.trim() || amount <= 0) {
      setBudgetError('Sélectionnez une ligne catalogue ou saisissez un libellé avec un coût positif.')
      return
    }
    setBudgetForm(f => ({
      ...f,
      [budgetDraft.category]: String(parseMoneyInput(f[budgetDraft.category]) + amount),
    }))
    setBudgetDraft(emptyCatalogBudgetDraft())
    setBudgetError(null)
  }

  async function saveExpectedBudget() {
    setBudgetSaving(true)
    setBudgetError(null)
    const totals = expectedBudgetTotals(budgetForm)
    const res = await updateMaintenanceContract(c.id, {
      period_cost_labor_ht: totals.labor,
      period_cost_parts_ht: totals.parts,
      period_cost_travel_ht: totals.travel,
      period_cost_other_ht: totals.other,
    })
    setBudgetSaving(false)
    if (res.error) {
      setBudgetError(res.error)
      return
    }
    onContractUpdated({
      ...c,
      period_cost_labor_ht: totals.labor,
      period_cost_parts_ht: totals.parts,
      period_cost_travel_ht: totals.travel,
      period_cost_other_ht: totals.other,
    })
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* En-tête détail */}
      <div className="px-6 pt-5 pb-4 border-b border-[var(--elevation-border)] flex-shrink-0">
        <div className="flex items-start gap-3">
          <button onClick={onClose} className="text-secondary hover:text-primary flex-shrink-0">
            <ChevronRight size={18} className="rotate-180" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-bold text-primary truncate">{c.title}</h2>
              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold flex-shrink-0 ${STATUS_CONFIG[c.status].cls}`}>
                {STATUS_CONFIG[c.status].label}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-secondary flex-wrap">
              {c.client && (
                <span className="font-medium text-primary">
                  {c.client.company_name || [c.client.first_name, c.client.last_name].filter(Boolean).join(' ')}
                </span>
              )}
              <span>{FREQUENCE_LABELS[c.frequence]}</span>
              {montantTTC !== null && <span className="font-semibold text-primary">{fmt(montantTTC)} TTC</span>}
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button onClick={onEdit} className="p-2 rounded-xl hover:bg-base text-secondary hover:text-primary">
              <Pencil size={15} />
            </button>
            <button onClick={onDelete} className="p-2 rounded-xl hover:bg-red-500/10 text-secondary hover:text-red-500">
              <Trash2 size={15} />
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={24} className="animate-spin text-secondary" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-5 pt-5">

          {/* Infos */}
          <div className="grid grid-cols-2 gap-3">
            {c.date_debut && (
              <div className="rounded-xl p-3 bg-base border border-[var(--elevation-border)]">
                <p className="text-xs text-secondary mb-0.5">Début</p>
                <p className="text-sm font-semibold text-primary">{fmtDate(c.date_debut)}</p>
              </div>
            )}
            {c.date_fin && (
              <div className="rounded-xl p-3 bg-base border border-[var(--elevation-border)]">
                <p className="text-xs text-secondary mb-0.5">Fin</p>
                <p className="text-sm font-semibold text-primary">{fmtDate(c.date_fin)}</p>
              </div>
            )}
            {c.prochaine_intervention && (
              <div className="rounded-xl p-3 bg-accent/10 border border-accent/20">
                <p className="text-xs text-secondary mb-0.5">Prochaine intervention</p>
                <p className="text-sm font-semibold text-primary">{fmtDate(c.prochaine_intervention)}</p>
              </div>
            )}
            {c.montant_ht !== null && (
              <div className="rounded-xl p-3 bg-base border border-[var(--elevation-border)]">
                <p className="text-xs text-secondary mb-0.5">Prix par période HT</p>
                <p className="text-sm font-semibold text-primary">{fmt(c.montant_ht)}</p>
                <p className="text-xs text-secondary">{c.vat_rate}% TVA</p>
              </div>
            )}
            {expectedCost > 0 && (
              <div className="rounded-xl p-3 bg-base border border-[var(--elevation-border)]">
                <p className="text-xs text-secondary mb-0.5">Marge prévue / période</p>
                <p className="text-sm font-semibold text-primary">{fmt(expectedMargin)}</p>
                <p className="text-xs text-secondary">{fmt(expectedCost)} de coûts</p>
              </div>
            )}
          </div>

          {/* Interventions */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-bold text-secondary uppercase tracking-wider">Interventions</p>
              <button
                onClick={onNewIntervention}
                className="flex items-center gap-1 text-xs font-semibold text-accent hover:opacity-80"
              >
                <Plus size={12} /> Saisir
              </button>
            </div>

            {interventions.length === 0 ? (
              <div className="text-center py-8 text-secondary">
                <FileText size={24} className="mx-auto mb-2 opacity-30" />
                <p className="text-xs">Aucune intervention enregistrée.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {planifiees.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-secondary mb-2">À venir</p>
                    <div className="space-y-2">
                      {planifiees.map(iv => (
                        <InterventionRow
                          key={iv.id}
                          iv={iv}
                          intervenants={intervenants}
                          expanded={expandedIv === iv.id}
                          onToggle={() => setExpandedIv(prev => prev === iv.id ? null : iv.id)}
                          onEdit={() => onEditIntervention(iv)}
                          onBill={() => onBillIntervention(iv)}
                          onDelete={() => onDeleteIntervention(iv.id)}
                        />
                      ))}
                    </div>
                  </div>
                )}
                {realisees.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-secondary mb-2">Historique</p>
                    <div className="space-y-2">
                      {realisees.map(iv => (
                        <InterventionRow
                          key={iv.id}
                          iv={iv}
                          intervenants={intervenants}
                          expanded={expandedIv === iv.id}
                          onToggle={() => setExpandedIv(prev => prev === iv.id ? null : iv.id)}
                          onEdit={() => onEditIntervention(iv)}
                          onBill={() => onBillIntervention(iv)}
                          onDelete={() => onDeleteIntervention(iv.id)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="rounded-xl bg-base border border-[var(--elevation-border)] overflow-hidden">
            <button
              onClick={() => setBudgetOpen(o => !o)}
              className="w-full flex items-center justify-between gap-3 px-3 py-3 hover:bg-[var(--elevation-1)] transition-colors"
            >
              <div className="flex items-center gap-3">
                <ChevronRight size={14} className={`text-secondary transition-transform flex-shrink-0 ${budgetOpen ? 'rotate-90' : ''}`} />
                <div className="text-left">
                  <p className="text-xs font-bold text-secondary uppercase tracking-wider">Marge prévue par période</p>
                  <p className="text-xs text-secondary mt-0.5">
                    {fmt(c.montant_ht ?? 0)} prix prévu - {fmt(editedBudget.total)} de coûts prévus
                  </p>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <p className={`text-sm font-bold ${marginTextTone(editedExpectedMargin)}`}>{fmt(editedExpectedMargin)}</p>
                <p className="text-xs text-secondary">{(editedExpectedMarginPct * 100).toFixed(1)} % marge</p>
              </div>
            </button>

            {budgetOpen && (
              <div className="px-3 pb-3 space-y-3 border-t border-[var(--elevation-border)]">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-3">
                  <div className="rounded-xl bg-[var(--elevation-1)] border border-[var(--elevation-border)] p-3">
                    <div className="flex items-center gap-2 text-secondary mb-1">
                      <Euro size={13} />
                      <p className="text-[11px] font-bold uppercase tracking-wider">Prix par période</p>
                    </div>
                    <p className="text-lg font-bold text-primary">{fmt(c.montant_ht ?? 0)}</p>
                    <p className="text-xs text-secondary">Prix HT du contrat pour une période.</p>
                  </div>
                  <div className="rounded-xl bg-[var(--elevation-1)] border border-[var(--elevation-border)] p-3">
                    <div className="flex items-center gap-2 text-secondary mb-1">
                      <HardHat size={13} />
                      <p className="text-[11px] font-bold uppercase tracking-wider">Coûts prévus</p>
                    </div>
                    <p className="text-lg font-bold text-primary">{fmt(editedBudget.total)}</p>
                    <p className="text-xs text-secondary">MO, pièces, déplacement et autres coûts.</p>
                  </div>
                  <div className="rounded-xl bg-[var(--elevation-1)] border border-[var(--elevation-border)] p-3">
                    <div className="flex items-center gap-2 text-secondary mb-1">
                      <Target size={13} />
                      <p className="text-[11px] font-bold uppercase tracking-wider">Marge prévue</p>
                    </div>
                    <p className={`text-lg font-bold ${marginTextTone(editedExpectedMargin)}`}>{fmt(editedExpectedMargin)}</p>
                    <p className="text-xs text-secondary">{(editedExpectedMarginPct * 100).toFixed(1)} % du prix HT.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  {budgetCategories.map(cat => {
                    const isQuoteImport = cat === 'other' && c.source_quote_id
                      && !c.period_cost_labor_ht && !c.period_cost_parts_ht && !c.period_cost_travel_ht
                    const meta = COST_CATEGORY_META[cat]
                    const Icon = meta.Icon
                    const label = isQuoteImport ? 'Coût interne devis' : meta.label
                    return (
                      <div key={cat} className="grid grid-cols-[1fr_120px] gap-3 items-center rounded-xl bg-[var(--elevation-1)] border border-[var(--elevation-border)] p-3">
                        <div className="min-w-0 flex items-start gap-2">
                          <span className="mt-0.5 text-secondary">
                            <Icon className="w-4 h-4" />
                          </span>
                          <div className="min-w-0">
                            <label className="block text-sm font-semibold text-primary">{label}</label>
                            <p className="text-xs text-secondary">{isQuoteImport ? 'Coût interne repris depuis le devis source.' : meta.detail}</p>
                          </div>
                        </div>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={budgetForm[cat]}
                          onChange={e => setBudgetForm(f => ({ ...f, [cat]: e.target.value }))}
                          className="input w-full text-sm text-right"
                          aria-label={label}
                        />
                      </div>
                    )
                  })}
                </div>

                <div className="rounded-xl bg-[var(--elevation-1)] border border-[var(--elevation-border)] p-3 space-y-2">
                  <p className="text-xs font-bold text-secondary uppercase tracking-wider">Ajouter une ligne de coût prévu</p>
                  <div className="grid grid-cols-2 md:grid-cols-[120px_1fr] gap-2">
                    <select
                      value={budgetDraft.source}
                      onChange={e => {
                        const source = e.target.value as CatalogBudgetDraft['source']
                        setBudgetDraft({ ...emptyCatalogBudgetDraft(), source, category: source === 'labor' ? 'labor' : 'parts' })
                      }}
                      className="input text-xs"
                    >
                      <option value="material">Produits / services</option>
                      <option value="labor">Main-d'oeuvre</option>
                      <option value="prestation">Prestations</option>
                      <option value="manual">Libre</option>
                    </select>

                    {budgetDraft.source === 'manual' ? (
                      <input
                        value={budgetDraft.label}
                        onChange={e => setBudgetDraft(f => ({ ...f, label: e.target.value }))}
                        placeholder="Libellé de la ligne"
                        className="input text-xs"
                      />
                    ) : (
                      <select
                        value={budgetDraft.catalogId}
                        onChange={e => applyBudgetCatalogItem(budgetDraft.source, e.target.value)}
                        className="input text-xs"
                      >
                        <option value="">Sélectionner dans le catalogue</option>
                        {budgetDraft.source === 'material' && materials.map(item => (
                          <option key={item.id} value={item.id}>{item.name}{item.reference ? ` · ${item.reference}` : ''}</option>
                        ))}
                        {budgetDraft.source === 'labor' && laborRates.map(item => (
                          <option key={item.id} value={item.id}>{item.designation}{item.reference ? ` · ${item.reference}` : ''}</option>
                        ))}
                        {budgetDraft.source === 'prestation' && prestationTypes.map(item => (
                          <option key={item.id} value={item.id}>{item.name}</option>
                        ))}
                      </select>
                    )}
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-[1fr_90px_80px_110px_auto] gap-2 items-end">
                    <select
                      value={budgetDraft.category}
                      onChange={e => setBudgetDraft(f => ({ ...f, category: e.target.value as ExpectedCostCategory }))}
                      className="input text-xs"
                    >
                      {budgetCategories.map(cat => (
                        <option key={cat} value={cat}>{COST_CATEGORY_META[cat].label}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={budgetDraft.quantity}
                      onChange={e => setBudgetDraft(f => ({ ...f, quantity: e.target.value }))}
                      placeholder="Qté"
                      className="input text-xs"
                    />
                    <input
                      value={budgetDraft.unit}
                      onChange={e => setBudgetDraft(f => ({ ...f, unit: e.target.value }))}
                      placeholder="Unité"
                      className="input text-xs"
                    />
                    <input
                      type="text"
                      inputMode="decimal"
                      value={budgetDraft.unitCost}
                      onChange={e => setBudgetDraft(f => ({ ...f, unitCost: e.target.value }))}
                      placeholder="Coût/u"
                      className="input text-xs"
                    />
                    <button onClick={addBudgetDraft} className="px-3 py-2 rounded-xl bg-accent text-black text-xs font-bold flex items-center justify-center gap-1">
                      <Plus size={12} /> Ajouter
                    </button>
                  </div>
                </div>

                {budgetError && (
                  <p className="text-xs text-red-500 flex items-center gap-1">
                    <AlertCircle size={12} /> {budgetError}
                  </p>
                )}

                <div className="flex justify-end">
                  <button
                    onClick={saveExpectedBudget}
                    disabled={budgetSaving}
                    className="px-4 py-2 rounded-full bg-accent text-black text-xs font-bold disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {budgetSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                    Enregistrer la référence
                  </button>
                </div>
              </div>
            )}
          </div>

          {((c.montant_ht ?? 0) > 0 || expectedCost > 0 || interventions.some(iv => iv.statut === 'réalisée') || expenses.length > 0) && periodRows.length > 0 && (
            <div className="rounded-xl bg-base border border-[var(--elevation-border)] overflow-hidden">
              <button
                onClick={() => setMargeOpen(o => !o)}
                className="w-full flex items-center justify-between gap-3 px-3 py-3 hover:bg-[var(--elevation-1)] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <ChevronRight size={14} className={`text-secondary transition-transform flex-shrink-0 ${margeOpen ? 'rotate-90' : ''}`} />
                  <div className="text-left">
                    <p className="text-xs font-bold text-secondary uppercase tracking-wider">Suivi facturation et marge</p>
                    <p className="text-xs text-secondary mt-0.5">Le réel ne compte que les factures envoyées, partielles ou payées.</p>
                  </div>
                </div>
                <span className="text-xs text-secondary flex-shrink-0">{periodRows.length} période{periodRows.length > 1 ? 's' : ''}</span>
              </button>

              {margeOpen && (
                <div className="px-3 pb-3 space-y-2 border-t border-[var(--elevation-border)] pt-3">
                  {periodRows.map(row => (
                    <div key={row.period} className="rounded-xl bg-[var(--elevation-1)] border border-[var(--elevation-border)] p-3">
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <div>
                          <p className="text-sm font-semibold text-primary capitalize">{row.label}</p>
                          <p className="text-xs text-secondary">{row.interventions > 0 ? `${row.interventions} intervention${row.interventions > 1 ? 's' : ''} réalisée${row.interventions > 1 ? 's' : ''}` : 'Base prévue'}</p>
                        </div>
                        <div className="text-right">
                          <p className={`text-sm font-bold ${row.revenueHt > 0 ? marginTextTone(row.marginEur) : 'text-secondary'}`}>{row.revenueHt > 0 ? fmt(row.marginEur) : '-'}</p>
                          <p className="text-xs text-secondary">{row.revenueHt > 0 ? `${(row.marginPct * 100).toFixed(1)} %` : 'marge facturée'}</p>
                        </div>
                      </div>
                      <div className="h-1.5 rounded-full bg-secondary/10 overflow-hidden">
                        <div className={`h-full rounded-full ${marginTone(row.marginPct)}`} style={{ width: `${Math.max(0, Math.min(100, row.marginPct * 100))}%` }} />
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-xs">
                        <div className="rounded-lg bg-base p-2">
                          <p className="text-secondary">Facturé HT</p>
                          <p className="font-semibold text-primary">{row.revenueHt > 0 ? fmt(row.revenueHt) : '-'}</p>
                        </div>
                        <div className="rounded-lg bg-base p-2">
                          <p className="text-secondary">Brouillon</p>
                          <p className="font-semibold text-primary">{row.draftRevenueHt > 0 ? fmt(row.draftRevenueHt) : '-'}</p>
                        </div>
                        <div className="rounded-lg bg-base p-2">
                          <p className="text-secondary">À facturer</p>
                          <p className="font-semibold text-primary">{row.pendingRevenueHt > 0 ? fmt(row.pendingRevenueHt) : '-'}</p>
                        </div>
                        <div className="rounded-lg bg-base p-2">
                          <p className="text-secondary">Coûts</p>
                          <p className="font-semibold text-primary">{fmt(row.actualCostHt)}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-secondary mt-2">
                        <span>MO {fmt(row.laborCostHt)}</span>
                        <span>Pièces {fmt(row.partsCostHt)}</span>
                        <span>Déplacement {fmt(row.travelCostHt)}</span>
                        <span>Autres {fmt(row.otherCostHt)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Dépenses */}
          {c.chantier_id ? (
            <div className="rounded-xl bg-base border border-[var(--elevation-border)] p-3">
              <MaintenanceDepensesSection
                chantierId={c.chantier_id}
                initialExpenses={expenses.map(e => ({
                  id: e.id,
                  chantier_id: c.chantier_id!,
                  category: (e.category ?? 'autre') as ChantierExpense['category'],
                  label: e.label,
                  amount_ht: e.amount_ht,
                  vat_rate: 20,
                  expense_date: e.expense_date,
                  supplier_name: null,
                  received_invoice_id: null,
                  receipt_storage_path: null,
                  notes: null,
                  created_by: null,
                  created_at: '',
                }))}
                orgSector={orgSector}
                materials={materials}
              />
            </div>
          ) : (
            <div className="rounded-xl bg-base border border-[var(--elevation-border)] p-3 text-center text-xs text-secondary py-5">
              Les dépenses sont disponibles dès que ce contrat est lié à un chantier.
            </div>
          )}

          {c.description && (
            <p className="text-sm text-secondary leading-relaxed">{c.description}</p>
          )}

          {(c.site_name || siteAddress || c.site_contact_name || c.site_contact_phone || c.site_contact_email) && (
            <div className="rounded-xl p-3 bg-base border border-[var(--elevation-border)] space-y-2">
              <p className="text-xs font-bold text-secondary uppercase tracking-wider">Site d&apos;intervention</p>
              {c.site_name && <p className="text-sm font-semibold text-primary">{c.site_name}</p>}
              {siteAddress && siteMapsUrl && (
                <a href={siteMapsUrl} target="_blank" rel="noreferrer" className="text-sm text-accent hover:underline">
                  {siteAddress}
                </a>
              )}
              {(c.site_contact_name || c.site_contact_phone || c.site_contact_email) && (
                <div className="flex flex-wrap gap-2 text-xs text-secondary">
                  {c.site_contact_name && <span>{c.site_contact_name}</span>}
                  {c.site_contact_phone && <a href={`tel:${c.site_contact_phone}`} className="text-accent hover:underline">{c.site_contact_phone}</a>}
                  {c.site_contact_email && <a href={`mailto:${c.site_contact_email}`} className="text-accent hover:underline">{c.site_contact_email}</a>}
                </div>
              )}
            </div>
          )}

          {/* Facturation auto */}
          {c.facturation_auto && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-green-500/10 border border-green-500/20">
              <RotateCcw size={13} className="text-green-600 dark:text-green-400" />
              <span className="text-xs font-semibold text-green-600 dark:text-green-400">
                {c.auto_send_delay_days != null
                  ? `Envoi auto après ${c.auto_send_delay_days}j sans validation`
                  : 'Facturation récurrente avec validation manuelle'}
              </span>
              {c.recurring_invoice_id && (
                <a
                  href={`/finances/recurring?highlight=${c.recurring_invoice_id}`}
                  className="ml-auto text-xs text-accent flex items-center gap-1 hover:underline"
                >
                  <LinkIcon size={11} /> Voir le modèle
                </a>
              )}
            </div>
          )}

	          {/* Équipements */}
	          {c.equipements && c.equipements.length > 0 && (
	            <div>
	              <p className="text-xs font-bold text-secondary uppercase tracking-wider mb-2">Installations à maintenir</p>
              <div className="space-y-2">
                {c.equipements.map((eq, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-base border border-[var(--elevation-border)]">
                    <Package size={13} className="text-secondary flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-primary truncate">{eq.nom}</p>
                      {(eq.ref || eq.localisation) && (
                        <p className="text-xs text-secondary">
                          {[eq.ref, eq.localisation].filter(Boolean).join(' - ')}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  )
}

// ─── InterventionRow ──────────────────────────────────────────────────────────

function InterventionRow({
  iv, intervenants, expanded, onToggle, onEdit, onBill, onDelete,
}: {
  iv: MaintenanceIntervention
  intervenants: { id: string; label: string }[]
  expanded: boolean
  onToggle: () => void
  onEdit: () => void
  onBill: () => void
  onDelete: () => void
}) {
  const cfg = INTERVENTION_STATUS_CONFIG[iv.statut]
  const hasContent = true
  // Résolution du nom : d'abord via le join DB (fantômes), sinon via la liste unifiée (membres app)
  const intervenantName = iv.intervenant
    ? [iv.intervenant.prenom, iv.intervenant.name].filter(Boolean).join(' ')
    : iv.intervenant_profile?.full_name
      ?? (iv.intervenant_user_id || iv.intervenant_member_id || iv.intervenant_id
      ? intervenants.find(i => i.id === (iv.intervenant_user_id ?? iv.intervenant_member_id ?? iv.intervenant_id))?.label ?? null
      : null
      )
  const costs = (iv.cost_parts_ht ?? 0) + (iv.cost_travel_ht ?? 0) + (iv.cost_other_ht ?? 0)
  const [sendingReport, setSendingReport] = useState(false)
  const [sendStatus, setSendStatus] = useState<'idle' | 'done' | 'error'>('idle')
  const [sendError, setSendError] = useState<string | null>(null)
  const [photos, setPhotos] = useState(iv.photos ?? [])
  const [photoTitle, setPhotoTitle] = useState('')
  const [photoCaption, setPhotoCaption] = useState('')
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)

  const handleSendReport = async () => {
    setSendingReport(true)
    setSendStatus('idle')
    setSendError(null)
    const { error } = await sendMaintenanceInterventionReportEmail(iv.id)
    setSendingReport(false)
    if (error) {
      setSendStatus('error')
      setSendError(error)
      return
    }
    setSendStatus('done')
  }

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoUploading(true)
    setPhotoError(null)
    const fd = new FormData()
    fd.append('file', file)
    if (photoTitle.trim()) fd.append('title', photoTitle.trim())
    if (photoCaption.trim()) fd.append('caption', photoCaption.trim())
    const { error, photo } = await uploadMaintenanceInterventionPhoto(iv.id, fd)
    setPhotoUploading(false)
    e.target.value = ''
    if (error || !photo) {
      setPhotoError(error ?? "La photo n'a pas pu être ajoutée.")
      return
    }
    setPhotos(prev => [...prev, photo])
    setPhotoTitle('')
    setPhotoCaption('')
  }

  return (
    <div className="rounded-xl border border-[var(--elevation-border)] bg-surface dark:bg-[#121212] overflow-hidden">
      <div
        className={`flex items-center gap-3 px-3 py-2.5 ${hasContent ? 'cursor-pointer' : ''}`}
        onClick={hasContent ? onToggle : undefined}
      >
        <cfg.Icon size={13} className={
          iv.statut === 'réalisée' ? 'text-green-600 dark:text-green-400' :
          iv.statut === 'planifiée' ? 'text-blue-600 dark:text-blue-400' :
          'text-red-500 dark:text-red-400'
        } />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-primary">{fmtDate(iv.date_intervention)}</p>
            <span className={`px-1.5 py-0.5 rounded-full text-xs font-semibold ${cfg.cls}`}>{cfg.label}</span>
          </div>
          {intervenantName && (
            <p className="text-xs text-secondary">{intervenantName}</p>
          )}
          <div className="flex items-center gap-2 text-xs text-secondary mt-0.5 flex-wrap">
            {iv.duration_hours != null && <span>{fmtHours(iv.duration_hours)}</span>}
            {costs > 0 && <span>{fmt(costs)} coûts</span>}
            {iv.invoice && (
              <span className={`px-1.5 py-0.5 rounded-full font-semibold ${
                iv.invoice.status === 'paid'
                  ? 'bg-green-500/15 text-green-600 dark:text-green-400'
                  : iv.invoice.status === 'sent'
                  ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                  : 'bg-secondary/15 text-secondary'
              }`}>
                {iv.invoice.status === 'paid' ? 'Payée' : iv.invoice.status === 'sent' ? 'Envoyée' : `Facture ${iv.invoice.number ?? 'brouillon'}`}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
          {iv.statut === 'réalisée' && !iv.invoice_id && (
            <button onClick={onBill} className="p-1.5 rounded-lg hover:bg-green-500/10 text-secondary hover:text-green-600" title="Facturer l'intervention">
              <Euro size={12} />
            </button>
          )}
          <a
            href={`/api/pdf/maintenance/intervention/${iv.id}`}
            target="_blank"
            rel="noreferrer"
            className="p-1.5 rounded-lg hover:bg-base text-secondary hover:text-primary"
            title="Rapport PDF"
          >
            <FileDown size={12} />
          </a>
          <button
            onClick={handleSendReport}
            disabled={sendingReport}
            className="p-1.5 rounded-lg hover:bg-accent/10 text-secondary hover:text-accent disabled:opacity-50"
            title="Envoyer le rapport au client"
          >
            {sendingReport ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
          </button>
          <button onClick={onEdit} className="p-1.5 rounded-lg hover:bg-base text-secondary hover:text-primary">
            <Pencil size={12} />
          </button>
          <button onClick={onDelete} className="p-1.5 rounded-lg hover:bg-red-500/10 text-secondary hover:text-red-500">
            <Trash2 size={12} />
          </button>
          {hasContent && (
            <ChevronRight size={13} className={`text-secondary transition-transform ${expanded ? 'rotate-90' : ''}`} />
          )}
        </div>
      </div>

      {expanded && hasContent && (
        <div className="px-3 pb-3 space-y-2 border-t border-[var(--elevation-border)] pt-2.5">
          {sendStatus === 'done' && (
            <p className="text-xs text-green-600 font-semibold">Rapport envoyé au client.</p>
          )}
          {sendStatus === 'error' && (
            <p className="text-xs text-red-500 font-semibold">{sendError}</p>
          )}
          <div>
            <p className="text-xs font-semibold text-secondary mb-1">Photos du rapport</p>
            {photos.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-2">
                {photos.map(photo => (
                  <div key={photo.id} className="rounded-lg border border-[var(--elevation-border)] overflow-hidden bg-base">
                    {photo.url && <img src={photo.url} alt={photo.title ?? photo.caption ?? 'Photo intervention'} className="w-full aspect-[4/3] object-cover" />}
                    <div className="p-2">
                      <p className="text-xs font-semibold text-primary truncate">{photo.title ?? 'Photo'}</p>
                      {photo.caption && <p className="text-[11px] text-secondary line-clamp-2">{photo.caption}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-2">
              <input
                value={photoTitle}
                onChange={e => setPhotoTitle(e.target.value)}
                className="input text-xs py-2"
                placeholder="Titre de la photo"
              />
              <input
                value={photoCaption}
                onChange={e => setPhotoCaption(e.target.value)}
                className="input text-xs py-2"
                placeholder="Description"
              />
              <label className="btn-secondary text-xs px-3 py-2 inline-flex items-center justify-center gap-1.5 cursor-pointer">
                {photoUploading ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                Ajouter
                <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} disabled={photoUploading} />
              </label>
            </div>
            {photoError && <p className="text-xs text-red-500 mt-1">{photoError}</p>}
          </div>
          {iv.rapport && (
            <div>
              <p className="text-xs font-semibold text-secondary mb-1">Rapport</p>
              <p className="text-xs text-primary whitespace-pre-wrap">{iv.rapport}</p>
            </div>
          )}
          {iv.observations && (
            <div>
              <p className="text-xs font-semibold text-secondary mb-1">Observations</p>
              <p className="text-xs text-primary whitespace-pre-wrap">{iv.observations}</p>
            </div>
          )}
          {iv.billable_notes && (
            <div>
              <p className="text-xs font-semibold text-secondary mb-1">Facturable</p>
              <p className="text-xs text-primary whitespace-pre-wrap">{iv.billable_notes}</p>
            </div>
          )}
          {(iv.duration_hours || costs > 0 || iv.billable_amount_ht || iv.invoice) && (
            <div className="grid grid-cols-3 gap-2 text-xs">
              {iv.duration_hours != null && (
                <div className="rounded-lg bg-base p-2">
                  <p className="text-secondary">Heures</p>
                  <p className="font-semibold text-primary">{fmtHours(iv.duration_hours)}</p>
                </div>
              )}
              {costs > 0 && (
                <div className="rounded-lg bg-base p-2">
                  <p className="text-secondary">Coûts</p>
                  <p className="font-semibold text-primary">{fmt(costs)}</p>
                </div>
              )}
              {iv.billable_amount_ht != null && (
                <div className="rounded-lg bg-base p-2">
                  <p className="text-secondary">À facturer HT</p>
                  <p className="font-semibold text-primary">{fmt(iv.billable_amount_ht)}</p>
                </div>
              )}
              {iv.invoice && (
                <div className={`rounded-lg p-2 ${
                  iv.invoice.status === 'paid'
                    ? 'bg-green-500/10 border border-green-500/20'
                    : iv.invoice.status === 'sent'
                    ? 'bg-amber-500/10 border border-amber-500/20'
                    : 'bg-base'
                }`}>
                  <p className="text-secondary">Facture</p>
                  <a
                    href={`/finances/invoice-editor?id=${iv.invoice.id}`}
                    className={`font-semibold hover:underline ${
                      iv.invoice.status === 'paid'
                        ? 'text-green-600 dark:text-green-400'
                        : iv.invoice.status === 'sent'
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-primary'
                    }`}
                  >
                    {iv.invoice.status === 'paid' ? 'Payée' : iv.invoice.status === 'sent' ? 'Envoyée' : 'Brouillon'}
                    {iv.invoice.number ? ` · ${iv.invoice.number}` : ''}
                  </a>
                  {iv.invoice.total_ht != null && (
                    <p className="text-secondary mt-0.5">{fmt(iv.invoice.total_ht)} HT</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
