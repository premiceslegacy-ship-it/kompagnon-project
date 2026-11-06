'use client'
// @atelier-migrated
// Dépenses d'un contrat d'entretien (rattachées au chantier lié) : liste, ajout, ticket scanné, répartition.

import { useRef, useState } from 'react'
import { ChevronDown, ScanLine } from 'lucide-react'
import { AlertDialog } from '@/components/ui/AlertDialog'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Menu } from '@/components/ui/Menu'
import { Sheet } from '@/components/ui/Sheet'
import type { ChantierExpense } from '@/lib/data/queries/chantier-profitability'
import type { CatalogMaterial } from '@/lib/data/queries/catalog'
import { deleteChantierExpense, uploadExpenseReceipt, getReceiptSignedUrl } from '@/lib/data/mutations/chantier-expenses'
import type { ScanReceiptResult } from '@/app/api/ai/scan-receipt/route'
import ExpenseSheet from '../[chantierId]/ExpenseSheet'
import { EXPENSE_CATEGORIES, catLabel, fmtMoney, type ExpenseFormState } from '../[chantierId]/rentabiliteModel'
import { todayStr } from './entretienModel'
import screen from '@/components/layout/Screen.module.css'
import styles from '../../finances/quote-editor/QuoteEditor.module.css'
import docs from '../../finances/Documents.module.css'
import fiche from '../[chantierId]/ChantierFiche.module.css'

export default function MaintenanceDepensesSection({
  chantierId,
  initialExpenses,
  orgSector,
  materials,
}: {
  chantierId: string
  initialExpenses: ChantierExpense[]
  orgSector: string | null
  materials: CatalogMaterial[]
}) {
  const today = todayStr()
  const [expenses, setExpenses] = useState<ChantierExpense[]>(initialExpenses)
  const [sheet, setSheet] = useState<{ expense: ChantierExpense | null; override: Partial<ExpenseFormState> | null } | null>(null)
  const [deleting, setDeleting] = useState<ChantierExpense | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [filter, setFilter] = useState<ChantierExpense['category'] | 'all'>('all')
  const [actionError, setActionError] = useState<string | null>(null)

  const scanInput = useRef<HTMLInputElement>(null)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [viewingReceiptPath, setViewingReceiptPath] = useState<string | null>(null)
  const [receiptUrls, setReceiptUrls] = useState<Record<string, string>>({})

  const filtered = filter === 'all' ? expenses : expenses.filter(e => e.category === filter)
  const totalHt = expenses.reduce((s, e) => s + e.amount_ht, 0)

  const handleScan = async (file: File) => {
    setScanning(true)
    setScanError(null)
    const uploadFormData = new FormData()
    uploadFormData.append('file', file)
    const [ocrRes, uploadRes] = await Promise.all([
      (async () => {
        const fd = new FormData()
        fd.append('file', file)
        const res = await fetch('/api/ai/scan-receipt', { method: 'POST', body: fd })
        if (!res.ok) {
          const { error } = await res.json().catch(() => ({ error: 'Erreur réseau' }))
          return { error: error ?? "Erreur lors de l'analyse." }
        }
        return res.json() as Promise<ScanReceiptResult>
      })(),
      uploadExpenseReceipt(chantierId, uploadFormData),
    ])
    setScanning(false)

    if ('error' in ocrRes) { setScanError(ocrRes.error); return }

    const warnings: string[] = []
    if (uploadRes.error) warnings.push(uploadRes.error)
    if (ocrRes.amountSource === 'unknown') warnings.push('Montant non détecté - renseignez le montant manuellement.')
    if (ocrRes.confidence === 'low') warnings.push('Ticket peu lisible - vérifiez les valeurs avant d\'enregistrer.')
    if (warnings.length) setScanError(warnings.join(' '))

    setSheet({
      expense: null,
      override: {
        label: ocrRes.label || '',
        amountHt: ocrRes.amountHt != null ? String(ocrRes.amountHt) : '',
        vatRate: ocrRes.vatRate != null ? String(ocrRes.vatRate) : '20',
        expenseDate: ocrRes.expenseDate ?? today,
        supplierName: ocrRes.supplierName ?? '',
        category: ocrRes.category,
        receiptStoragePath: uploadRes.storagePath,
        ...(ocrRes.category === 'transport' ? {
          transportSubcategory: ocrRes.subcategory === 'peage' ? 'peage' : ocrRes.subcategory === 'carburant' ? 'carburant' : 'autre',
        } : {}),
      },
    })
  }

  const handleViewReceipt = async (path: string) => {
    if (receiptUrls[path]) { setViewingReceiptPath(path); return }
    const { url } = await getReceiptSignedUrl(path)
    if (url) { setReceiptUrls(prev => ({ ...prev, [path]: url })); setViewingReceiptPath(path) }
  }

  const handleSaved = (saved: ChantierExpense) => {
    setExpenses(prev => {
      const existing = prev.find(e => e.id === saved.id)
      return existing ? prev.map(e => e.id === saved.id ? saved : e) : [saved, ...prev]
    })
    setSheet(null)
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    setActionError(null)
    const { error } = await deleteChantierExpense(id, chantierId)
    setDeletingId(null)
    if (error) { setActionError(error); return }
    setExpenses(prev => prev.filter(e => e.id !== id))
  }

  return (
    <>
      <ListGroup
        title="Dépenses"
        description={expenses.length === 0 ? 'Aucune dépense enregistrée.' : `Total ${fmtMoney(totalHt)} HT.`}
        action={expenses.length > 0 ? (
          <Menu
            title="Catégorie"
            items={[{ value: 'all', label: 'Toutes les catégories' }, ...EXPENSE_CATEGORIES].map(o => ({ label: o.label, checked: filter === o.value, onSelect: () => setFilter(o.value as ChantierExpense['category'] | 'all') }))}
            trigger={<button type="button" className={docs.chip} data-on={filter !== 'all' ? 'true' : 'false'}>{filter === 'all' ? 'Toutes' : catLabel(filter)}<ChevronDown size={14} aria-hidden="true" /></button>}
          />
        ) : undefined}
      >
        {filtered.map(exp => {
          const description = [catLabel(exp.category), exp.supplier_name, new Date(exp.expense_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })].filter(Boolean).join(' · ')
          return (
            <ListRow
              key={exp.id}
              title={exp.label}
              description={description}
              trailing={<span className={styles.amount}>{fmtMoney(exp.amount_ht)}</span>}
              onClick={() => setSheet({ expense: exp, override: null })}
            />
          )
        })}
        {expenses.length > 0 && filtered.length === 0 && <ListRow title="Aucune dépense dans cette catégorie" />}
        <ListRow title="Ajouter une dépense" className={fiche.linkRow} onClick={() => { setScanError(null); setSheet({ expense: null, override: null }) }} />
        <ListRow
          title={scanning ? 'Analyse du ticket…' : 'Scanner un ticket'}
          description="Photographiez un ticket pour pré-remplir la dépense."
          leading={<ScanLine size={18} aria-hidden="true" />}
          disabled={scanning}
          onClick={() => scanInput.current?.click()}
        />
      </ListGroup>
      <input
        ref={scanInput}
        className={fiche.fileInput}
        type="file"
        accept="image/*,application/pdf"
        capture="environment"
        tabIndex={-1}
        aria-label="Scanner un ticket"
        onChange={e => {
          const file = e.target.files?.[0]
          if (file) handleScan(file)
          e.target.value = ''
        }}
      />
      {scanError && <p className={screen.note} role="status">{scanError}</p>}
      {actionError && <p className={screen.error} role="alert">{actionError}</p>}

      {sheet && (
        <ExpenseSheet
          chantierId={chantierId}
          expense={sheet.expense}
          override={sheet.override}
          today={today}
          orgSector={orgSector}
          materials={materials}
          canDelete
          onDelete={setDeleting}
          onViewReceipt={handleViewReceipt}
          onSaved={handleSaved}
          onClose={() => setSheet(null)}
        />
      )}
      {viewingReceiptPath && receiptUrls[viewingReceiptPath] && (
        <Sheet open onOpenChange={o => { if (!o) setViewingReceiptPath(null) }} title="Ticket" cancelLabel="Fermer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={fiche.photoView} src={receiptUrls[viewingReceiptPath]} alt="Ticket de dépense" />
        </Sheet>
      )}
      <AlertDialog
        open={deleting !== null}
        onOpenChange={o => { if (!o) setDeleting(null) }}
        title="Supprimer cette dépense ?"
        description="Elle sera retirée des coûts du contrat."
        confirmLabel="Supprimer"
        confirmLoading={deletingId !== null}
        onConfirm={() => { if (deleting) handleDelete(deleting.id); setDeleting(null) }}
      />
    </>
  )
}
