'use client'
// @atelier-migrated
// Rentabilité du chantier : coûts, dépenses, factures rattachées, taux horaires, marge cible.

import { useEffect, useRef, useState } from 'react'
import type { ChantierExpense, ChantierProfitability, LaborByMemberEntry } from '@/lib/data/queries/chantier-profitability'
import type { InvoiceStub } from '@/lib/data/queries/invoices'
import type { CatalogMaterial } from '@/lib/data/queries/catalog'
import { deleteChantierExpense, uploadExpenseReceipt, getReceiptSignedUrl } from '@/lib/data/mutations/chantier-expenses'
import { linkInvoiceToChantier } from '@/lib/data/mutations/invoices'
import { updateMemberLaborRate } from '@/lib/data/mutations/team'
import { updateChantier } from '@/lib/data/mutations/chantiers'
import type { ScanReceiptResult } from '@/app/api/ai/scan-receipt/route'
import { emptyExpenseForm, fmtMoney, invoiceCollectedHt, profitabilityAlerts, recalc, type ExpenseFormState } from './rentabiliteModel'

export type DeletedPointageInfo = {
  id: string
  userId: string | null
  memberId: string | null
  hours: number
}

export type RentabiliteProps = {
  chantierId: string
  initialProfitability: ChantierProfitability
  orgSector?: string | null
  materials?: CatalogMaterial[]
  invoiceStubs?: InvoiceStub[]
  targetMarginPct?: number
  permissions: {
    canCreateExpenses: boolean
    canEditExpenses: boolean
    canDeleteExpenses: boolean
    canEditRates: boolean
    canEditChantier: boolean
  }
  deletedPointages?: DeletedPointageInfo[]
}

export function useRentabilite({
  chantierId,
  initialProfitability,
  orgSector = null,
  materials = [],
  invoiceStubs = [],
  targetMarginPct: initialTargetMarginPct = 30,
  permissions,
  deletedPointages = [],
}: RentabiliteProps) {
  const { canCreateExpenses, canEditExpenses, canDeleteExpenses, canEditRates, canEditChantier } = permissions
  const ownExpensesOnly = initialProfitability.ownExpensesOnly ?? false
  const today = new Date().toISOString().slice(0, 10)
  const [profitability, setProfitability] = useState(initialProfitability)
  const [laborByMember, setLaborByMember] = useState<LaborByMemberEntry[]>(initialProfitability.laborByMember)
  const [actionError, setActionError] = useState<string | null>(null)

  // Synchronise les suppressions de pointages effectuées depuis un autre segment
  const processedPointageIds = useRef(new Set<string>())
  useEffect(() => {
    const toProcess = deletedPointages.filter(d => !processedPointageIds.current.has(d.id))
    if (toProcess.length === 0) return
    toProcess.forEach(d => processedPointageIds.current.add(d.id))
    setLaborByMember(prev => {
      let next = prev.map(entry => ({ ...entry }))
      for (const { userId, memberId, hours } of toProcess) {
        next = next.map(entry => {
          const matches = userId ? entry.user_id === userId : entry.member_id === memberId
          if (!matches) return entry
          const newHours = Math.max(0, entry.hours - hours)
          const newCost = entry.ratePerHour != null ? newHours * entry.ratePerHour : 0
          return { ...entry, hours: newHours, cost: newCost }
        }).filter(entry => entry.hours > 0)
      }
      setProfitability(prev => recalc(prev, next))
      return next
    })
  }, [deletedPointages])

  // Marge cible
  const [targetMarginPct, setTargetMarginPct] = useState(initialTargetMarginPct)
  const [marginInput, setMarginInput] = useState(String(initialTargetMarginPct))
  const [marginSaving, setMarginSaving] = useState(false)
  const [marginOpen, setMarginOpen] = useState(false)

  // Dépenses
  const [expenseSheet, setExpenseSheet] = useState<{ expense: ChantierExpense | null; override: Partial<ExpenseFormState> | null } | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [expenseFilter, setExpenseFilter] = useState<ChantierExpense['category'] | 'all'>('all')

  // Ticket (scan)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [viewingReceiptPath, setViewingReceiptPath] = useState<string | null>(null)
  const [receiptUrls, setReceiptUrls] = useState<Record<string, string>>({})

  const handleScan = async (file: File) => {
    if (!canCreateExpenses) return
    setScanning(true)
    setScanError(null)
    const uploadFormData = new FormData()
    uploadFormData.append('file', file)
    // Upload en parallèle pendant l'OCR
    const [ocrRes, uploadRes] = await Promise.all([
      (async () => {
        const fd = new FormData()
        fd.append('file', file)
        const res = await fetch('/api/ai/scan-receipt', { method: 'POST', body: fd })
        if (!res.ok) {
          const { error } = await res.json().catch(() => ({ error: 'Erreur réseau' }))
          return { error: error ?? 'Erreur lors de l\'analyse.' }
        }
        return res.json() as Promise<ScanReceiptResult>
      })(),
      uploadExpenseReceipt(chantierId, uploadFormData),
    ])
    setScanning(false)
    if ('error' in ocrRes) {
      setScanError(ocrRes.error)
      return
    }
    const scanWarnings: string[] = []
    if (uploadRes.error) scanWarnings.push(uploadRes.error)
    if (ocrRes.amountSource === 'ttc_converted' && ocrRes.amountTtc != null && ocrRes.vatRate != null) {
      scanWarnings.push(`Montant TTC lu (${fmtMoney(ocrRes.amountTtc, 2)}) converti en HT avec TVA ${ocrRes.vatRate} %.`)
    }
    if (ocrRes.amountSource === 'unknown') scanWarnings.push('Montant non détecté - renseignez le montant manuellement.')
    const override: Partial<ExpenseFormState> = {
      label: ocrRes.label || '',
      amountHt: ocrRes.amountHt != null ? String(ocrRes.amountHt) : '',
      vatRate: ocrRes.vatRate != null ? String(ocrRes.vatRate) : '20',
      expenseDate: ocrRes.expenseDate ?? today,
      supplierName: ocrRes.supplierName ?? '',
      category: ocrRes.category,
      receiptStoragePath: uploadRes.storagePath,
    }
    if (ocrRes.category === 'transport') {
      override.transportSubcategory = ocrRes.subcategory === 'peage' ? 'peage'
        : ocrRes.subcategory === 'carburant' ? 'carburant'
        : 'autre'
    }
    setExpenseSheet({ expense: null, override })
    if (ocrRes.confidence === 'low') scanWarnings.push('Ticket peu lisible - vérifiez les valeurs avant d\'enregistrer.')
    if (scanWarnings.length) setScanError(scanWarnings.join(' '))
  }

  const handleViewReceipt = async (path: string) => {
    if (receiptUrls[path]) {
      setViewingReceiptPath(path)
      return
    }
    const { url } = await getReceiptSignedUrl(path)
    if (url) {
      setReceiptUrls(prev => ({ ...prev, [path]: url }))
      setViewingReceiptPath(path)
    }
  }

  // Factures rattachées - gérées localement pour éviter un rechargement
  const [linkedInvoices, setLinkedInvoices] = useState<InvoiceStub[]>(
    () => invoiceStubs.filter(inv => inv.chantier_id === chantierId),
  )
  const [linkingInvoiceId, setLinkingInvoiceId] = useState('')
  const [linkingInvoice, setLinkingInvoice] = useState(false)
  const [linkInvoiceError, setLinkInvoiceError] = useState<string | null>(null)
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null)
  const availableToLink = invoiceStubs
    .filter(inv => !inv.chantier_id || inv.chantier_id === chantierId)
    .filter(inv => !linkedInvoices.some(li => li.id === inv.id))

  const handleLinkInvoice = async (): Promise<boolean> => {
    if (!canEditChantier || !linkingInvoiceId) return false
    setLinkingInvoice(true)
    setLinkInvoiceError(null)
    const { error } = await linkInvoiceToChantier(linkingInvoiceId, chantierId)
    setLinkingInvoice(false)
    if (error) { setLinkInvoiceError(error); return false }
    const inv = invoiceStubs.find(i => i.id === linkingInvoiceId)
    if (inv) {
      setLinkedInvoices(prev => [...prev, { ...inv, chantier_id: chantierId }])
      setProfitability(prev => recalc({
        ...prev,
        revenueHt: prev.revenueHt + (inv.total_ht ?? 0),
        collectedRevenueHt: prev.collectedRevenueHt + invoiceCollectedHt(inv),
      }))
    }
    setLinkingInvoiceId('')
    return true
  }

  const handleUnlinkInvoice = async (invoiceId: string) => {
    if (!canEditChantier) return
    setUnlinkingId(invoiceId)
    const { error } = await linkInvoiceToChantier(invoiceId, null)
    setUnlinkingId(null)
    if (error) { setActionError(error); return }
    const inv = linkedInvoices.find(i => i.id === invoiceId)
    setLinkedInvoices(prev => prev.filter(i => i.id !== invoiceId))
    setProfitability(prev => recalc({
      ...prev,
      revenueHt: prev.revenueHt - (inv?.total_ht ?? 0),
      collectedRevenueHt: prev.collectedRevenueHt - (inv ? invoiceCollectedHt(inv) : 0),
    }))
  }

  // Taux horaires
  const [rateEntry, setRateEntry] = useState<LaborByMemberEntry | null>(null)
  const [rateInputValue, setRateInputValue] = useState('')
  const [rateSaving, setRateSaving] = useState(false)
  const [rateError, setRateError] = useState<string | null>(null)

  const {
    budgetHt, budgetCostMaterial, budgetCostLabor, budgetCostTotal,
    revenueHt, collectedRevenueHt, costMaterial, costLabor, costSubcontract, costOther,
    costTotal, marginEur, marginPct, hoursLogged,
  } = profitability
  const expenses = profitability.expenses
  const periods = profitability.periods ?? []
  const alerts = profitabilityAlerts(profitability, targetMarginPct)
  const filteredExpenses = expenseFilter === 'all' ? expenses : expenses.filter(e => e.category === expenseFilter)

  const handleExpenseSaved = (saved: ChantierExpense) => {
    setProfitability(prev => {
      const existing = prev.expenses.find(e => e.id === saved.id)
      const newExpenses = existing ? prev.expenses.map(e => e.id === saved.id ? saved : e) : [saved, ...prev.expenses]
      return recalc({ ...prev, expenses: newExpenses })
    })
    setExpenseSheet(null)
  }

  const handleDelete = async (id: string) => {
    if (!canDeleteExpenses) return
    setDeletingId(id)
    const { error } = await deleteChantierExpense(id, chantierId)
    setDeletingId(null)
    if (error) { setActionError(error); return }
    setProfitability(prev => recalc({ ...prev, expenses: prev.expenses.filter(e => e.id !== id) }))
  }

  const handleEditRate = (entry: LaborByMemberEntry) => {
    if (!canEditRates) return
    setRateEntry(entry)
    setRateInputValue(entry.ratePerHour != null ? String(entry.ratePerHour) : '')
    setRateError(null)
  }

  const handleSaveRate = async (membershipId: string): Promise<boolean> => {
    if (!canEditRates) return false
    const parsed = parseFloat(rateInputValue.replace(',', '.'))
    if (isNaN(parsed) || parsed < 0) { setRateError('Taux invalide.'); return false }
    setRateSaving(true)
    setRateError(null)
    const { error } = await updateMemberLaborRate(membershipId, parsed)
    setRateSaving(false)
    if (error) { setRateError(error); return false }
    const newMembers = laborByMember.map(e => e.membership_id === membershipId ? { ...e, ratePerHour: parsed, cost: e.hours * parsed } : e)
    setLaborByMember(newMembers)
    setProfitability(prev => recalc(prev, newMembers))
    setRateEntry(null)
    return true
  }

  const handleSaveMargin = async (): Promise<boolean> => {
    if (!canEditChantier) return false
    const parsed = parseFloat(marginInput.replace(',', '.'))
    if (isNaN(parsed) || parsed < 0 || parsed >= 100) return false
    setMarginSaving(true)
    await updateChantier(chantierId, { targetMarginPct: parsed })
    setTargetMarginPct(parsed)
    setMarginSaving(false)
    setMarginOpen(false)
    return true
  }

  return {
    chantierId, orgSector, materials, today,
    canCreateExpenses, canEditExpenses, canDeleteExpenses, canEditRates, canEditChantier, ownExpensesOnly,
    profitability, laborByMember, actionError, setActionError,
    targetMarginPct, marginInput, setMarginInput, marginSaving, marginOpen, setMarginOpen, handleSaveMargin,
    expenseSheet, setExpenseSheet, deletingId, expenseFilter, setExpenseFilter,
    scanning, scanError, setScanError, viewingReceiptPath, setViewingReceiptPath, receiptUrls, handleScan, handleViewReceipt,
    linkedInvoices, linkingInvoiceId, setLinkingInvoiceId, linkingInvoice, linkInvoiceError, setLinkInvoiceError, unlinkingId, availableToLink, handleLinkInvoice, handleUnlinkInvoice,
    rateEntry, setRateEntry, rateInputValue, setRateInputValue, rateSaving, rateError, handleEditRate, handleSaveRate,
    budgetHt, budgetCostMaterial, budgetCostLabor, budgetCostTotal, revenueHt, collectedRevenueHt,
    costMaterial, costLabor, costSubcontract, costOther, costTotal, marginEur, marginPct, hoursLogged,
    expenses, periods, alerts, filteredExpenses, handleExpenseSaved, handleDelete,
  }
}

export type RentabiliteState = ReturnType<typeof useRentabilite>
