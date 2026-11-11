// Répartition d'un mois de documents en quelques parts, pour la barre de la liste. Sans React.
import type { SplitBarSegment } from '@/components/ui/SplitBar'
import { roundMoney } from '@/lib/utils/money'

type QuoteLike = { status: string }
type InvoiceLike = {
  status: string
  invoice_type: string
  total_ttc: number | null
  total_paid?: number | null
  credited_ttc?: number | null
  due_date: string | null
}

const WAITING = new Set(['sent', 'viewed'])
const WON = new Set(['accepted', 'converted', 'fully_invoiced'])
const LOST = new Set(['refused', 'expired'])
const RECEIVABLE = new Set(['sent', 'viewed', 'partial', 'overdue'])


/** Devis : brouillons, en attente de réponse, acceptés, refusés ou expirés. En nombre de devis. */
export function quotesSplit(quotes: readonly QuoteLike[]): SplitBarSegment[] {
  const count = (pred: (status: string) => boolean) => quotes.filter(q => pred(q.status)).length
  const draft = count(s => s === 'draft')
  const waiting = count(s => WAITING.has(s))
  const won = count(s => WON.has(s))
  const lost = count(s => LOST.has(s))
  return [
    { key: 'won', label: 'Acceptés', value: won, tone: 'success', display: String(won) },
    { key: 'waiting', label: 'En attente', value: waiting, tone: 'accent', display: String(waiting) },
    { key: 'draft', label: 'Brouillons', value: draft, tone: 'neutral', display: String(draft) },
    { key: 'lost', label: 'Refusés', value: lost, tone: 'danger', display: String(lost) },
  ]
}

/** Factures : encaissé, à encaisser, en retard. En euros TTC ; la part déjà reçue d’une facture partielle compte comme encaissée. */
export function invoicesSplit(invoices: readonly InvoiceLike[], today: string, format: (n: number) => string): SplitBarSegment[] {
  let paid = 0
  let due = 0
  let late = 0
  for (const inv of invoices) {
    if (inv.invoice_type === 'avoir') continue
    const total = inv.total_ttc ?? 0
    if (inv.status === 'paid') { paid += total; continue }
    if (!RECEIVABLE.has(inv.status)) continue
    const received = Math.min(total, Math.max(0, inv.total_paid ?? 0))
    paid += received
    const rest = Math.max(0, roundMoney(total - received - (inv.credited_ttc ?? 0)))
    if (inv.status === 'overdue' || (inv.due_date != null && inv.due_date < today)) late += rest
    else due += rest
  }
  paid = roundMoney(paid)
  due = roundMoney(due)
  late = roundMoney(late)
  return [
    { key: 'paid', label: 'Encaissé', value: paid, tone: 'success', display: format(paid) },
    { key: 'due', label: 'À encaisser', value: due, tone: 'accent', display: format(due) },
    { key: 'late', label: 'En retard', value: late, tone: 'danger', display: format(late) },
  ]
}

