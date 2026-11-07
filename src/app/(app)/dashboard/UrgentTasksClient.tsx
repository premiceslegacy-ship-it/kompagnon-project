'use client'
// @atelier-migrated

import { useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Check, CheckCircle2, FileText, HardHat, Inbox, Mail, Pencil, Send } from 'lucide-react'
import type { UrgentItem } from '@/lib/data/queries/dashboard'
import { markQuoteAccepted } from '@/lib/data/mutations/reminders'
import { markInvoicePaid } from '@/lib/data/mutations/invoices'
import AIReminderModal from '@/components/shared/AIReminderModal'
import { Avatar } from '@/components/ui/Avatar'
import { Hud } from '@/components/ui/Hud'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Sheet } from '@/components/ui/Sheet'
import { StatusPill, type StatusPillStatus } from '@/components/ui/StatusPill'
import styles from '@/components/layout/Screen.module.css'

const NB = ' '
const DAY = 86_400_000

const money = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: n % 1 ? 2 : 0 }).format(n)

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })

function daysSince(iso: string | null): number | null {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / DAY)
}

const SENT_TYPES = new Set<UrgentItem['type']>(['recently_sent', 'task_completed'])
const CHANTIER_TYPES = new Set<UrgentItem['type']>(['task_due', 'planning_slot', 'missing_pointage', 'chantier_profitability'])
const REMINDABLE = new Set<UrgentItem['type']>(['overdue_invoice', 'invoice_to_follow_up', 'pending_quote', 'balance_due', 'installment_due'])

/** Libellé court de l'état, à droite de la ligne. */
function statusOf(item: UrgentItem): { text: string; status: StatusPillStatus } {
  const days = daysSince(item.date)
  switch (item.type) {
    case 'overdue_invoice':
      return { text: days && days > 0 ? `${days}${NB}j de retard` : 'En retard', status: 'danger' }
    case 'invoice_to_follow_up':
      return { text: 'À suivre', status: 'wait' }
    case 'pending_quote':
      return { text: days && days > 0 ? `${days}${NB}j sans réponse` : 'Sans réponse', status: 'wait' }
    case 'pending_recurring':
      return { text: 'À confirmer', status: 'wait' }
    case 'balance_due':
      return { text: 'Solde à encaisser', status: 'wait' }
    case 'installment_due':
      return { text: 'Échéance', status: 'wait' }
    case 'task_due':
      return { text: 'Tâche', status: 'neutral' }
    case 'planning_slot':
      return { text: 'Créneau', status: 'neutral' }
    case 'missing_pointage':
      return { text: 'Pointage manquant', status: 'danger' }
    case 'chantier_profitability':
      return { text: 'Budget', status: 'danger' }
    case 'new_request':
      return { text: 'Nouvelle', status: 'wait' }
    default:
      return { text: 'Envoyé', status: 'success' }
  }
}

/** Ligne secondaire : le document et sa date utile. */
function detailOf(item: UrgentItem): string {
  const parts: string[] = []
  // Le libellé contient souvent l'état (« en retard », « sans réponse ») déjà dit par la pastille :
  // on garde la référence du document quand on la trouve.
  const ref = item.label.match(/\b(Facture|Devis)\s+[A-Z]{1,4}-[\w-]+/)
  if (item.clientName) parts.push(ref ? ref[0] : item.label)
  else if (item.title) parts.push(item.title)
  if (item.date) {
    const prefix: Partial<Record<UrgentItem['type'], string>> = {
      overdue_invoice: 'échue le',
      invoice_to_follow_up: 'envoyée le',
      pending_quote: 'envoyé le',
      pending_recurring: 'envoi prévu le',
      balance_due: 'solde attendu le',
      installment_due: 'versement attendu le',
      task_due: 'pour le',
      planning_slot: 'le',
      missing_pointage: 'créneau du',
      new_request: 'reçue le',
    }
    parts.push(`${prefix[item.type] ?? 'le'} ${shortDate(item.date)}`)
  }
  return parts.join(' · ')
}

function sentDetail(item: UrgentItem): string {
  const kind = item.subtype === 'auto_reminder_invoice'
    ? `Relance facture${item.rank && item.rank > 1 ? ` n°${NB}${item.rank}` : ''}`
    : item.subtype === 'auto_reminder_quote'
      ? `Relance devis${item.rank && item.rank > 1 ? ` n°${NB}${item.rank}` : ''}`
      : item.type === 'task_completed' ? 'Tâche terminée' : 'Facture récurrente'
  const days = daysSince(item.date)
  const when = days === null ? '' : days === 0 ? "aujourd'hui" : days === 1 ? 'hier' : `il y a ${days}${NB}jours`
  return [item.label, kind, when].filter(Boolean).join(' · ')
}

export default function UrgentTasksClient({ initialItems, quoteAiEnabled }: {
  initialItems: UrgentItem[]
  facturesEnRetard: number
  quoteAiEnabled: boolean
}) {
  const router = useRouter()
  const [items, setItems] = useState<UrgentItem[]>(initialItems)
  const [selected, setSelected] = useState<UrgentItem | null>(null)
  const [loading, setLoading] = useState<'paid' | 'accepted' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hud, setHud] = useState<string | null>(null)
  const [reminderTarget, setReminderTarget] = useState<{ type: 'invoice' | 'quote'; id: string } | null>(null)
  const [, startTransition] = useTransition()

  const actionItems = items.filter(i => !SENT_TYPES.has(i.type))
  const sentItems = items.filter(i => SENT_TYPES.has(i.type))

  function removeItem(id: string) {
    setItems(prev => prev.filter(i => i.id !== id))
  }

  function open(item: UrgentItem) {
    setError(null)
    setSelected(item)
  }

  function closeSheet() {
    if (loading) return
    setSelected(null)
  }

  function go(href: string) {
    setSelected(null)
    router.push(href)
  }

  function mark(kind: 'paid' | 'accepted', item: UrgentItem) {
    setLoading(kind)
    setError(null)
    startTransition(async () => {
      const res = kind === 'paid' ? await markInvoicePaid(item.id) : await markQuoteAccepted(item.id)
      setLoading(null)
      if (res.error) {
        setError(res.error)
        return
      }
      removeItem(item.id)
      setSelected(null)
      setHud(kind === 'paid' ? 'Facture marquée payée' : 'Devis marqué accepté')
    })
  }

  function remind(item: UrgentItem) {
    setSelected(null)
    setReminderTarget({
      // Correspondance d'origine conservée : seules les factures en retard ou à suivre sont relancées comme factures.
      type: item.type === 'overdue_invoice' || item.type === 'invoice_to_follow_up' ? 'invoice' : 'quote',
      id: item.id,
    })
  }

  const invoiceHref = (item: UrgentItem) =>
    `/finances/invoice-editor?id=${item.invoiceId}&returnTo=${encodeURIComponent('/dashboard')}`

  function actionsFor(item: UrgentItem) {
    const rows: ReactNode[] = []
    if (quoteAiEnabled && REMINDABLE.has(item.type)) {
      rows.push(<ListRow key="remind" title="Préparer la relance" description="Message rédigé par Sarah, modifiable avant l'envoi" leading={<Mail size={20} aria-hidden="true" />} onClick={() => remind(item)} />)
    }
    if (item.type === 'overdue_invoice' || item.type === 'invoice_to_follow_up') {
      rows.push(<ListRow key="paid" title="Marquer comme payée" leading={<Check size={20} aria-hidden="true" />} disabled={loading !== null} onClick={() => mark('paid', item)} />)
    }
    if (item.type === 'pending_quote') {
      rows.push(<ListRow key="accepted" title="Marquer comme accepté" leading={<Check size={20} aria-hidden="true" />} disabled={loading !== null} onClick={() => mark('accepted', item)} />)
    }
    if (item.type === 'pending_recurring' && item.invoiceId) {
      rows.push(<ListRow key="send" title="Vérifier puis envoyer" leading={<Send size={20} aria-hidden="true" />} onClick={() => go(invoiceHref(item))} />)
      rows.push(<ListRow key="edit" title="Modifier le brouillon" leading={<Pencil size={20} aria-hidden="true" />} onClick={() => go(invoiceHref(item))} />)
    }
    if ((item.type === 'balance_due' || item.type === 'installment_due') && item.invoiceId) {
      rows.push(<ListRow key="invoice" title="Voir la facture" leading={<FileText size={20} aria-hidden="true" />} onClick={() => go(invoiceHref(item))} />)
    }
    if (CHANTIER_TYPES.has(item.type) && item.chantierId) {
      rows.push(<ListRow key="chantier" title="Ouvrir le chantier" leading={<HardHat size={20} aria-hidden="true" />} onClick={() => go(`/chantiers/${item.chantierId}`)} />)
    }
    if (item.type === 'new_request') {
      rows.push(<ListRow key="request" title="Voir la demande" leading={<Inbox size={20} aria-hidden="true" />} onClick={() => go('/requests')} />)
    }
    return rows
  }

  return (
    <>
      {actionItems.length === 0 && sentItems.length === 0 ? (
        <section className={styles.group}>
          <div className={styles.empty}>
            <b>Rien à traiter</b>
            Les échéances, factures en retard et devis sans réponse apparaîtront ici.
          </div>
        </section>
      ) : null}

      {actionItems.length > 0 ? (
        <section className={styles.group} aria-labelledby="today-priority">
          <h2 className={styles.groupTitle} id="today-priority">Suivi prioritaire</h2>
          <ul className={styles.list}>
            {actionItems.map(item => {
              const state = statusOf(item)
              const name = item.clientName || item.label
              const hasActions = actionsFor(item).length > 0
              return (
                <li key={`${item.type}-${item.id}`}>
                  <button
                    type="button"
                    className={styles.row}
                    data-static={hasActions ? undefined : 'true'}
                    onClick={hasActions ? () => open(item) : undefined}
                    aria-haspopup={hasActions ? 'dialog' : undefined}
                  >
                    <span aria-hidden="true"><Avatar name={name} size={34} /></span>
                    <span className={styles.mid}>
                      <span className={styles.rowTitle}>{name}</span>
                      <span className={styles.rowSub}>{detailOf(item)}</span>
                    </span>
                    <span className={styles.rowEnd}>
                      {item.amount != null ? <span className={styles.amount}>{money(item.amount)}</span> : null}
                      <StatusPill status={state.status}>{state.text}</StatusPill>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          <p className={styles.note}>Touchez une ligne pour agir : relancer, encaisser ou ouvrir.</p>
        </section>
      ) : null}

      {sentItems.length > 0 ? (
        <section className={styles.group} aria-labelledby="today-sent">
          <h2 className={styles.groupTitle} id="today-sent">Envoyé automatiquement, 7 derniers jours</h2>
          <ul className={styles.list}>
            {sentItems.map(item => (
              <li key={`${item.type}-${item.id}`}>
                <div className={styles.row} data-static="true">
                  <span aria-hidden="true"><Avatar name={item.clientName || item.label} size={34} /></span>
                  <span className={styles.mid}>
                    <span className={styles.rowTitle}>{item.clientName || item.label}</span>
                    <span className={styles.rowSub}>{sentDetail(item)}</span>
                  </span>
                  <CheckCircle2 className={styles.ok} size={20} aria-label="Envoyé" />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Sheet
        open={selected !== null}
        onOpenChange={(next) => { if (!next) closeSheet() }}
        title={selected ? (selected.clientName || selected.label) : ''}
        description={selected ? [selected.clientName ? selected.label : null, selected.amount != null ? money(selected.amount) : null].filter(Boolean).join(' · ') : undefined}
        dismissible={loading === null}
      >
        {selected ? (
          <div className={styles.sheetActions}>
            <ListGroup>{actionsFor(selected)}</ListGroup>
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
          </div>
        ) : null}
      </Sheet>

      <Hud open={hud !== null} onOpenChange={(next) => { if (!next) setHud(null) }} message={hud ?? ''} />

      {quoteAiEnabled && reminderTarget ? (
        <AIReminderModal
          type={reminderTarget.type}
          id={reminderTarget.id}
          onSent={() => {
            removeItem(reminderTarget.id)
            setReminderTarget(null)
            setHud('Relance envoyée')
          }}
          onClose={() => setReminderTarget(null)}
        />
      ) : null}
    </>
  )
}
