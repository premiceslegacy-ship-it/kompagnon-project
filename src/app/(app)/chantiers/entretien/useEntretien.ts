'use client'
// @atelier-migrated
// Entretien récurrent : liste des contrats, contrat ouvert, formulaires contrat et intervention.

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Client } from '@/lib/data/queries/clients'
import type { QuoteStub } from '@/lib/data/queries/quotes'
import type { IndividualMember } from '@/lib/data/queries/members'
import type { TeamMember } from '@/lib/data/queries/team'
import type { CatalogLaborRate, CatalogMaterial, PrestationType } from '@/lib/data/queries/catalog'
import type {
  Equipement, MaintenanceContract, MaintenanceContractExpense, MaintenanceIntervention, MaintenanceStatus, RecurringInvoiceInstance,
} from '@/lib/data/queries/maintenance'
import { fetchMaintenanceContractDetail } from '@/lib/data/queries/maintenance'
import {
  createMaintenanceContract, updateMaintenanceContract, deleteMaintenanceContract,
  createIntervention, updateIntervention, deleteIntervention, billMaintenanceIntervention,
} from '@/lib/data/mutations/maintenance'
import {
  applyQuoteToContractForm, blankContract, blankIntervention, buildIntervenants, contractPayload, contractToForm,
  filterContracts, interventionDefaults, interventionPayload, interventionToForm,
  type ContractForm, type InterventionForm,
} from './entretienModel'

export type EntretienProps = {
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

export type EntretienState = ReturnType<typeof useEntretien>

export function useEntretien({
  initialContracts,
  quotes,
  ghostMembers,
  teamMembers,
  currentUserId,
  currentUserName,
}: EntretienProps) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  // Liste unifiée des intervenants (moi + membres app + fantômes)
  const intervenants = useMemo(
    () => buildIntervenants(currentUserId, currentUserName, teamMembers, ghostMembers),
    [currentUserId, currentUserName, teamMembers, ghostMembers],
  )

  // Liste
  const [contracts, setContracts] = useState<MaintenanceContract[]>(initialContracts)
  const [filterTab, setFilterTab] = useState<string>('all')
  const [search, setSearch] = useState('')

  // Détail contrat sélectionné
  const [selectedContract, setSelectedContract] = useState<MaintenanceContract | null>(null)
  const [interventions, setInterventions] = useState<MaintenanceIntervention[]>([])
  const [expenses, setExpenses] = useState<MaintenanceContractExpense[]>([])
  const [recurringInstances, setRecurringInstances] = useState<RecurringInvoiceInstance[]>([])
  const [loadingDetail, setLoadingDetail] = useState(false)

  // Feuilles
  const [showContractModal, setShowContractModal] = useState(false)
  const [editingContract, setEditingContract] = useState<MaintenanceContract | null>(null)
  const [contractForm, setContractForm] = useState<ContractForm>(blankContract())

  const [showInterventionModal, setShowInterventionModal] = useState(false)
  const [editingIntervention, setEditingIntervention] = useState<MaintenanceIntervention | null>(null)
  const [interventionForm, setInterventionForm] = useState<InterventionForm>(blankIntervention())

  const [confirmDelete, setConfirmDelete] = useState<{ type: 'contract' | 'intervention'; id: string } | null>(null)

  const [formError, setFormError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // ─── Filtrage ───────────────────────────────────────────────────────────────

  const filtered = useMemo(() => filterContracts(contracts, filterTab, search), [contracts, filterTab, search])

  const clientQuotes = useMemo(
    () => quotes.filter(q => q.client_id && q.client_id === contractForm.client_id),
    [quotes, contractForm.client_id],
  )

  // Auto-ouvre le contrat au retour depuis l'éditeur de facture (?contract=<id>)
  useEffect(() => {
    const contractId = new URLSearchParams(window.location.search).get('contract')
    if (!contractId) return
    const contract = initialContracts.find(c => c.id === contractId)
    if (!contract) return
    openDetail(contract)
    const url = new URL(window.location.href)
    url.searchParams.delete('contract')
    window.history.replaceState(null, '', url.toString())
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Détail ─────────────────────────────────────────────────────────────────

  async function openDetail(contract: MaintenanceContract) {
    setSelectedContract(contract)
    setActionError(null)
    setLoadingDetail(true)
    const { contract: full, interventions: ivs, expenses: exp, recurringInstances: ri } = await fetchMaintenanceContractDetail(contract.id)
    if (full) setSelectedContract(full)
    setInterventions(ivs)
    setExpenses(exp)
    setRecurringInstances(ri)
    setLoadingDetail(false)
  }

  function closeDetail() {
    setSelectedContract(null)
    setInterventions([])
    setExpenses([])
    setRecurringInstances([])
    setActionError(null)
  }

  function handleContractUpdated(updated: MaintenanceContract) {
    setSelectedContract(updated)
    setContracts(prev => prev.map(c => c.id === updated.id ? updated : c))
  }

  // ─── Contrat ────────────────────────────────────────────────────────────────

  function openCreateContract() {
    setEditingContract(null)
    setContractForm(blankContract())
    setFormError(null)
    setShowContractModal(true)
  }

  function openEditContract(c: MaintenanceContract) {
    setEditingContract(c)
    setContractForm(contractToForm(c))
    setFormError(null)
    setShowContractModal(true)
  }

  function chooseQuote(quoteId: string) {
    const quote = quotes.find(q => q.id === quoteId)
    setContractForm(f => applyQuoteToContractForm(f, quote, quoteId))
  }

  async function saveContract() {
    if (!contractForm.title.trim()) { setFormError('Le titre est obligatoire.'); return }
    if (!contractForm.frequence) { setFormError('La fréquence est obligatoire.'); return }
    setSaving(true)
    setFormError(null)

    const payload = contractPayload(contractForm, !!editingContract)

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
    // Mise à jour immédiate de la liste
    const { contract: full, interventions: ivs, expenses: exp, recurringInstances: ri } = await fetchMaintenanceContractDetail(
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
      setRecurringInstances(ri)
    }
  }

  async function confirmDeleteContract(id: string) {
    const res = await deleteMaintenanceContract(id)
    if (res.error) { setActionError(res.error); setConfirmDelete(null); return }
    // Marque comme résilié dans la liste (disparaît de « Actifs », visible sous « Résiliés »)
    setContracts(prev => prev.map(c => c.id === id ? { ...c, status: 'résilié' as MaintenanceStatus } : c))
    if (selectedContract?.id === id) closeDetail()
    setConfirmDelete(null)
  }

  // ─── Intervention ───────────────────────────────────────────────────────────

  function openCreateIntervention() {
    setEditingIntervention(null)
    setInterventionForm(interventionDefaults(selectedContract))
    setFormError(null)
    setShowInterventionModal(true)
  }

  function openEditIntervention(iv: MaintenanceIntervention) {
    setEditingIntervention(iv)
    setInterventionForm(interventionToForm(iv))
    setFormError(null)
    setShowInterventionModal(true)
  }

  async function reloadDetail(contractId: string) {
    const { contract: full, interventions: ivs, expenses: exp, recurringInstances: ri } = await fetchMaintenanceContractDetail(contractId)
    if (full) {
      setSelectedContract(full)
      setContracts(prev => prev.map(c => c.id === full.id ? full : c))
    }
    setInterventions(ivs)
    setExpenses(exp)
    setRecurringInstances(ri)
  }

  async function saveIntervention() {
    if (!selectedContract) return
    if (!interventionForm.date_intervention) { setFormError('La date est obligatoire.'); return }
    setSaving(true)
    setFormError(null)

    const payload = interventionPayload(interventionForm, intervenants)

    let res: { error: string | null; id?: string }
    if (editingIntervention) {
      res = await updateIntervention(editingIntervention.id, payload)
    } else {
      res = await createIntervention(selectedContract.id, payload)
    }

    setSaving(false)
    if (res.error) { setFormError(res.error); return }

    setShowInterventionModal(false)
    await reloadDetail(selectedContract.id)
  }

  async function invoiceIntervention(iv: MaintenanceIntervention) {
    setSaving(true)
    setActionError(null)
    const res = await billMaintenanceIntervention(iv.id)
    setSaving(false)
    if (res.error) { setActionError(res.error); return }
    if (res.invoiceId) {
      const contractParam = selectedContract ? `?contract=${selectedContract.id}` : ''
      router.push(`/finances/invoice-editor?id=${res.invoiceId}&returnTo=${encodeURIComponent(`/chantiers/entretien${contractParam}`)}`)
    }
  }

  async function markInterventionDone(iv: MaintenanceIntervention) {
    setSaving(true)
    setActionError(null)
    const res = await updateIntervention(iv.id, { statut: 'réalisée' })
    setSaving(false)
    if (res.error) { setActionError(res.error); return }
    await reloadDetail(selectedContract!.id)
  }

  async function confirmDeleteIntervention(id: string) {
    if (!selectedContract) return
    const res = await deleteIntervention(id)
    if (res.error) { setActionError(res.error); setConfirmDelete(null); return }
    setInterventions(prev => prev.filter(iv => iv.id !== id))
    setExpenses(prev => prev.filter(exp => exp.maintenance_intervention_id !== id))
    setConfirmDelete(null)
  }

  // ─── Installations ──────────────────────────────────────────────────────────

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

  return {
    intervenants,
    contracts, filterTab, setFilterTab, search, setSearch, filtered, clientQuotes,
    selectedContract, interventions, expenses, recurringInstances, loadingDetail,
    showContractModal, setShowContractModal, editingContract, contractForm, setContractForm,
    showInterventionModal, setShowInterventionModal, editingIntervention, interventionForm, setInterventionForm,
    confirmDelete, setConfirmDelete, formError, actionError, setActionError, saving,
    openDetail, closeDetail, handleContractUpdated,
    openCreateContract, openEditContract, chooseQuote, saveContract, confirmDeleteContract,
    openCreateIntervention, openEditIntervention, saveIntervention, invoiceIntervention, markInterventionDone, confirmDeleteIntervention,
    addEquipement, removeEquipement, updateEquipement,
  }
}
