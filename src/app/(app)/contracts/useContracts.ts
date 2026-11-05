'use client'
// @atelier-migrated
// Logique des contrats : liste, actions, formulaire et modèles. L'affichage vit dans les composants voisins.

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AttachmentGroup } from '@/components/AttachmentPickerModal'
import type { Chantier } from '@/lib/data/queries/chantiers'
import type { Client } from '@/lib/data/queries/clients'
import type { ContractListItem, ContractTemplateOption } from '@/lib/data/queries/contracts'
import type { Quote } from '@/lib/data/queries/quotes'
import type { ContractClauseKey, ContractClauses, ContractCustomSection, ContractStatus, ContractType } from '@/lib/contracts/templates'
import {
  createContract,
  createContractTemplate,
  createContractTemplateFromContract,
  deleteContract,
  deleteContractTemplate,
  fetchClientDocsForAttachment,
  generateContractPdfSnapshot,
  sendContract,
  updateContract,
} from '@/lib/data/mutations/contracts'
import { paginate } from '@/lib/pagination'
import {
  applyContractChantier,
  applyContractClient,
  applyContractTemplate,
  applyContractType,
  availableQuotesFor,
  buildInitialForm,
  contractPayload,
  contractStats,
  filterContracts,
  firstTemplateFor,
  type ContractFormState,
} from './contractsModel'

export type ContractsProps = {
  initialContracts: ContractListItem[]
  clients: Client[]
  chantiers: Chantier[]
  templates: ContractTemplateOption[]
  quotes: Quote[]
  canCreate: boolean
  canEdit: boolean
  canDelete: boolean
}

export function useContracts({ initialContracts }: ContractsProps) {
  const router = useRouter()
  const [contracts, setContracts] = useState(initialContracts)
  const [query, setQuery] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [showTemplate, setShowTemplate] = useState(false)
  const [editingContract, setEditingContract] = useState<ContractListItem | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [sendModalContract, setSendModalContract] = useState<ContractListItem | null>(null)
  const [sendModalGroups, setSendModalGroups] = useState<AttachmentGroup[]>([])
  const [sendModalLoading, setSendModalLoading] = useState(false)
  const [sendModalSubmitting, setSendModalSubmitting] = useState(false)
  const [sendModalError, setSendModalError] = useState<string | null>(null)
  const [page, setPage] = useState(1)

  const refresh = () => {
    setIsRefreshing(true)
    router.refresh()
  }

  const openSendModal = async (contract: ContractListItem) => {
    setSendModalContract(contract)
    setSendModalGroups([])
    setSendModalError(null)
    if (!contract.client_id) {
      setSendModalGroups([
        { key: 'quotes', label: 'Devis liés', items: [] },
        { key: 'invoices', label: 'Factures liées', items: [] },
      ])
      return
    }
    setSendModalLoading(true)
    try {
      const docs = await fetchClientDocsForAttachment(contract.client_id)
      setSendModalGroups([
        { key: 'quotes', label: 'Devis du client', items: docs.quotes },
        { key: 'invoices', label: 'Factures du client', items: docs.invoices },
      ])
    } catch (err) {
      setSendModalError(err instanceof Error ? err.message : 'Erreur de chargement des documents.')
    } finally {
      setSendModalLoading(false)
    }
  }

  const confirmSend = async (selected: Record<string, string[]>) => {
    if (!sendModalContract) return
    setSendModalSubmitting(true)
    setSendModalError(null)
    const result = await sendContract(sendModalContract.id, {
      attachQuoteIds: selected.quotes ?? [],
      attachInvoiceIds: selected.invoices ?? [],
    })
    setSendModalSubmitting(false)
    if (result.error) {
      setSendModalError(result.error)
      return
    }
    setSendModalContract(null)
    refresh()
  }

  useEffect(() => {
    setContracts(initialContracts)
    setIsRefreshing(false)
  }, [initialContracts])

  const filtered = useMemo(() => filterContracts(contracts, query), [contracts, query])
  const pageData = paginate(filtered, page)
  const stats = useMemo(() => contractStats(contracts), [contracts])

  const runAction = async (contractId: string, action: () => Promise<{ error: string | null }>) => {
    setBusyId(contractId)
    setError(null)
    const result = await action()
    setBusyId(null)
    if (result.error) return setError(result.error)
    refresh()
  }

  const generateAndOpenPdf = async (contractId: string) => {
    setBusyId(contractId)
    setError(null)
    const pdfWindow = window.open('', '_blank')
    if (pdfWindow) {
      pdfWindow.document.write('<p style="font-family: system-ui; padding: 24px;">Génération du PDF...</p>')
    }
    const result = await generateContractPdfSnapshot(contractId)
    setBusyId(null)
    if (result.error) {
      if (pdfWindow) pdfWindow.close()
      return setError(result.error)
    }
    if (pdfWindow) {
      pdfWindow.location.href = `/api/pdf/contract/${contractId}`
    } else {
      window.open(`/api/pdf/contract/${contractId}`, '_blank')
    }
    refresh()
  }

  const convertToTemplate = async (contract: ContractListItem) => {
    setBusyId(contract.id)
    setError(null)
    const result = await createContractTemplateFromContract(contract.id)
    setBusyId(null)
    if (result.error) return setError(result.error)
    refresh()
  }

  const updateLocalStatus = (contractId: string, status: ContractStatus) => {
    setContracts(current => current.map(contract => contract.id === contractId ? { ...contract, status } : contract))
  }

  const markStatus = (contractId: string, status: 'signed' | 'archived') => {
    updateLocalStatus(contractId, status)
    return runAction(contractId, () => updateContract(contractId, { status }))
  }

  const removeContract = (contractId: string) => {
    setContracts(current => current.filter(item => item.id !== contractId))
    return runAction(contractId, () => deleteContract(contractId))
  }

  return {
    router, contracts, query, setQuery, page, setPage,
    showCreate, setShowCreate, showTemplate, setShowTemplate, editingContract, setEditingContract,
    busyId, error, isRefreshing, refresh,
    sendModalContract, setSendModalContract, sendModalGroups, sendModalLoading, sendModalSubmitting, sendModalError,
    openSendModal, confirmSend,
    filtered, pageData, stats,
    generateAndOpenPdf, convertToTemplate, markStatus, removeContract,
  }
}

export type Contracts = ReturnType<typeof useContracts>

/** Formulaire de création ou de modification d'un contrat. */
export function useContractForm({ contract, clients, chantiers, templates, quotes, onSaved }: {
  contract?: ContractListItem | null
  clients: Client[]
  chantiers: Chantier[]
  templates: ContractTemplateOption[]
  quotes: Quote[]
  onSaved: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<ContractFormState>(() => buildInitialForm(templates, contract))
  const availableTemplates = templates.filter(template => template.type === form.contractType)
  const availableQuotes = availableQuotesFor(form, quotes)
  const mode = contract ? 'edit' : 'create'

  const set = (field: keyof ContractFormState, value: string) => setForm(current => ({ ...current, [field]: value }))
  const changeType = (nextType: ContractType) => setForm(current => applyContractType(current, nextType, templates))
  const changeTemplate = (key: string) => setForm(current => applyContractTemplate(current, key, templates))
  const changeClient = (id: string) => setForm(current => applyContractClient(current, id, clients, quotes))
  const changeChantier = (id: string) => setForm(current => applyContractChantier(current, id, chantiers, clients))
  const setClause = (key: ContractClauseKey, value: string) => setForm(current => ({ ...current, clauses: { ...current.clauses, [key]: value } }))
  const addSection = () => setForm(current => ({ ...current, customSections: [...current.customSections, { id: `section-${Date.now()}`, title: '', content: '' }] }))
  const updateSection = (id: string, patch: Partial<ContractCustomSection>) =>
    setForm(current => ({ ...current, customSections: current.customSections.map(item => item.id === id ? { ...item, ...patch } : item) }))
  const removeSection = (id: string) => setForm(current => ({ ...current, customSections: current.customSections.filter(item => item.id !== id) }))

  const submit = async () => {
    if (!form.title.trim() || !form.counterpartyName.trim()) {
      setError('Renseignez le titre et la partie contractante.')
      return
    }
    setLoading(true)
    setError(null)
    const payload = contractPayload(form)
    const result = mode === 'edit' && contract ? await updateContract(contract.id, payload) : await createContract(payload)
    setLoading(false)
    if (result.error) return setError(result.error)
    onSaved()
  }

  return { mode, form, set, loading, error, availableTemplates, availableQuotes, changeType, changeTemplate, changeClient, changeChantier, setClause, addSection, updateSection, removeSection, submit }
}

export type ContractForm = ReturnType<typeof useContractForm>

/** Modèles de contrat : création à partir d'une base et suppression des modèles personnalisés. */
export function useContractTemplates({ templates, onSaved }: { templates: ContractTemplateOption[]; onSaved: () => void }) {
  const base = firstTemplateFor('sous_traitance', templates)
  const [contractType, setContractType] = useState<ContractType>('sous_traitance')
  const [title, setTitle] = useState('')
  const [baseKey, setBaseKey] = useState(base?.key ?? '')
  const [clauses, setClauses] = useState<ContractClauses>(base?.clauses ?? {} as ContractClauses)
  const [customSections, setCustomSections] = useState<ContractCustomSection[]>(base?.customSections ?? [])
  const [loading, setLoading] = useState(false)
  const [deletingKey, setDeletingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const availableTemplates = templates.filter(template => template.type === contractType)
  const customTemplates = templates.filter(t => t.isCustom)

  const changeType = (nextType: ContractType) => {
    const template = firstTemplateFor(nextType, templates)
    setContractType(nextType)
    setBaseKey(template?.key ?? '')
    setClauses(template?.clauses ?? {} as ContractClauses)
    setCustomSections(template?.customSections ?? [])
  }

  const changeBase = (templateKey: string) => {
    const template = templates.find(item => item.key === templateKey)
    if (!template) return
    setBaseKey(templateKey)
    setClauses(template.clauses)
    setCustomSections(template.customSections ?? [])
  }

  const submit = async () => {
    if (!title.trim()) { setError('Donnez un nom au modèle.'); return }
    setLoading(true)
    setError(null)
    const result = await createContractTemplate({ title, contractType, clauses, customSections })
    setLoading(false)
    if (result.error) return setError(result.error)
    onSaved()
  }

  const remove = async (templateKey: string) => {
    setDeletingKey(templateKey)
    setError(null)
    const result = await deleteContractTemplate(templateKey.replace('custom:', ''))
    setDeletingKey(null)
    if (result.error) return setError(result.error)
    onSaved()
  }

  const setClause = (key: ContractClauseKey, value: string) => setClauses(current => ({ ...current, [key]: value }))
  const addSection = () => setCustomSections(current => [...current, { id: `section-${Date.now()}`, title: '', content: '' }])
  const updateSection = (id: string, patch: Partial<ContractCustomSection>) => setCustomSections(current => current.map(item => item.id === id ? { ...item, ...patch } : item))
  const removeSection = (id: string) => setCustomSections(current => current.filter(item => item.id !== id))

  return { contractType, title, setTitle, baseKey, clauses, customSections, loading, deletingKey, error, availableTemplates, customTemplates, changeType, changeBase, submit, remove, setClause, addSection, updateSection, removeSection }
}

export type ContractTemplates = ReturnType<typeof useContractTemplates>
