'use client'
// @atelier-migrated
// Contrat ouvert : coûts prévus par période (référence de marge), encaissement d'une période, rapport d'intervention.

import { useEffect, useState } from 'react'
import type { CatalogLaborRate, CatalogMaterial, PrestationType } from '@/lib/data/queries/catalog'
import type { MaintenanceContract, MaintenanceIntervention } from '@/lib/data/queries/maintenance'
import { updateMaintenanceContract } from '@/lib/data/mutations/maintenance'
import { sendMaintenanceInterventionReportEmail } from '@/lib/data/mutations/maintenance-report-email'
import { uploadMaintenanceInterventionPhoto } from '@/lib/data/mutations/maintenance'
import { markInvoicePaid } from '@/lib/data/mutations/invoices'
import {
  applyCatalogItem, budgetDraftAmount, budgetDraftForSource, contractExpectedBudget, emptyBudgetDraft, expectedBudgetTotals,
  parseMoneyInput, type BudgetSource, type CatalogBudgetDraft, type ExpectedBudgetForm,
} from './entretienModel'

export type ContractDetailArgs = {
  contract: MaintenanceContract
  materials: CatalogMaterial[]
  laborRates: CatalogLaborRate[]
  prestationTypes: PrestationType[]
  onContractUpdated: (updated: MaintenanceContract) => void
}

export type ContractDetailState = ReturnType<typeof useContractDetail>

export function useContractDetail({ contract: c, materials, laborRates, prestationTypes, onContractUpdated }: ContractDetailArgs) {
  const [budgetForm, setBudgetForm] = useState<ExpectedBudgetForm>(() => contractExpectedBudget(c))
  const [budgetDraft, setBudgetDraft] = useState<CatalogBudgetDraft>(() => emptyBudgetDraft())
  const [budgetSaving, setBudgetSaving] = useState(false)
  const [budgetError, setBudgetError] = useState<string | null>(null)
  const [markPaidLoadingId, setMarkPaidLoadingId] = useState<string | null>(null)
  const [markPaidError, setMarkPaidError] = useState<string | null>(null)
  const [localPaidInvoiceIds, setLocalPaidInvoiceIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    setBudgetForm(contractExpectedBudget(c))
    setBudgetDraft(emptyBudgetDraft())
    setBudgetError(null)
  }, [c.id, c.period_cost_labor_ht, c.period_cost_parts_ht, c.period_cost_travel_ht, c.period_cost_other_ht])

  async function handleMarkPaid(invoiceId: string) {
    if (markPaidLoadingId) return
    setMarkPaidLoadingId(invoiceId)
    setMarkPaidError(null)
    const res = await markInvoicePaid(invoiceId)
    setMarkPaidLoadingId(null)
    if (res.error) { setMarkPaidError(res.error); return }
    setLocalPaidInvoiceIds(prev => new Set([...prev, invoiceId]))
  }

  function changeBudgetSource(source: BudgetSource) {
    setBudgetDraft(budgetDraftForSource(source))
  }

  function pickCatalogItem(source: BudgetSource, catalogId: string) {
    setBudgetDraft(d => applyCatalogItem(d, source, catalogId, { materials, laborRates, prestationTypes }))
  }

  function addBudgetDraft() {
    const amount = budgetDraftAmount(budgetDraft)
    if (!budgetDraft.label.trim() || amount <= 0) {
      setBudgetError('Sélectionnez une ligne catalogue ou saisissez un libellé avec un coût positif.')
      return
    }
    setBudgetForm(f => ({
      ...f,
      [budgetDraft.category]: String(parseMoneyInput(f[budgetDraft.category]) + amount),
    }))
    setBudgetDraft(emptyBudgetDraft())
    setBudgetError(null)
  }

  async function saveExpectedBudget(): Promise<boolean> {
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
      return false
    }
    onContractUpdated({
      ...c,
      period_cost_labor_ht: totals.labor,
      period_cost_parts_ht: totals.parts,
      period_cost_travel_ht: totals.travel,
      period_cost_other_ht: totals.other,
    })
    return true
  }

  return {
    budgetForm, setBudgetForm, budgetDraft, setBudgetDraft, budgetSaving, budgetError,
    markPaidLoadingId, markPaidError, localPaidInvoiceIds,
    handleMarkPaid, changeBudgetSource, pickCatalogItem, addBudgetDraft, saveExpectedBudget,
  }
}

// ─── Rapport d'une intervention : envoi au client et photos ───────────────────

export function useInterventionReport(iv: MaintenanceIntervention, contract: MaintenanceContract) {
  const [sendingReport, setSendingReport] = useState(false)
  const [sendStatus, setSendStatus] = useState<'idle' | 'done' | 'error'>('idle')
  const [sendError, setSendError] = useState<string | null>(null)
  const [clientEmail, setClientEmail] = useState(contract.client?.email ?? '')
  const [emailRequiredOpen, setEmailRequiredOpen] = useState(false)
  const [photos, setPhotos] = useState(iv.photos ?? [])
  const [photoTitle, setPhotoTitle] = useState('')
  const [photoCaption, setPhotoCaption] = useState('')
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)

  const getEmailTarget = () => contract.client
    ? { ...contract.client, email: clientEmail }
    : null

  const handleSendReport = async (skipEmailCheck = false) => {
    if (!skipEmailCheck && !contract.site_contact_email?.trim() && contract.client && !clientEmail.trim()) {
      setSendStatus('idle')
      setSendError(null)
      setEmailRequiredOpen(true)
      return
    }
    if (!contract.site_contact_email?.trim() && !contract.client) {
      setSendStatus('error')
      setSendError('Ajoutez un email de contact site ou liez un client au contrat.')
      return
    }
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

  const handleClientEmailSaved = async (email: string) => {
    setClientEmail(email)
    setEmailRequiredOpen(false)
    await handleSendReport(true)
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

  return {
    sendingReport, sendStatus, sendError, emailRequiredOpen, setEmailRequiredOpen,
    photos, photoTitle, setPhotoTitle, photoCaption, setPhotoCaption, photoUploading, photoError,
    getEmailTarget, handleSendReport, handleClientEmailSaved, handlePhotoUpload,
  }
}
