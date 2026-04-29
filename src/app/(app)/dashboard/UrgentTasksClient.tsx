'use client'

import React, { useState, useTransition } from 'react'
import { AlertTriangle, Clock, CheckCircle2, Mail, Check, Loader2, Repeat, Landmark, Send } from 'lucide-react'
import Link from 'next/link'
import type { UrgentItem } from '@/lib/data/queries/dashboard'
import { markQuoteAccepted } from '@/lib/data/mutations/reminders'
import { markInvoicePaid } from '@/lib/data/mutations/invoices'
import AIReminderModal from '@/components/shared/AIReminderModal'

const fmt = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)

const cardCls = "rounded-3xl p-6 card transition-all duration-300 ease-out"

export default function UrgentTasksClient({ initialItems, quoteAiEnabled }: {
  initialItems: UrgentItem[]
  facturesEnRetard: number
  quoteAiEnabled: boolean
}) {
  const [items, setItems] = useState<UrgentItem[]>(initialItems)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [, startTransition] = useTransition()
  const [reminderTarget, setReminderTarget] = useState<{ type: 'invoice' | 'quote'; id: string } | null>(null)

  function setError(id: string, msg: string) {
    setErrors(prev => ({ ...prev, [id]: msg }))
    setTimeout(() => setErrors(prev => { const n = { ...prev }; delete n[id]; return n }), 4000)
  }

  function removeItem(id: string) {
    setItems(prev => prev.filter(i => i.id !== id))
  }

  function handleRemind(item: UrgentItem) {
    setReminderTarget({
      type: item.type === 'overdue_invoice' ? 'invoice' : 'quote',
      id: item.id,
    })
  }

  function handleMarkQuoteAccepted(itemId: string) {
    setLoadingId(`accepted-${itemId}`)
    startTransition(async () => {
      const res = await markQuoteAccepted(itemId)
      if (res.error) {
        setError(itemId, res.error)
      } else {
        removeItem(itemId)
      }
      setLoadingId(null)
    })
  }

  function handleMarkPaid(itemId: string) {
    setLoadingId(`paid-${itemId}`)
    startTransition(async () => {
      const res = await markInvoicePaid(itemId)
      if (res.error) {
        setError(itemId, res.error)
      } else {
        removeItem(itemId)
      }
      setLoadingId(null)
    })
  }

  const overdueCount = items.filter(i => i.type === 'overdue_invoice').length
  const recurringCount = items.filter(i => i.type === 'pending_recurring').length
  const balanceDueCount = items.filter(i => i.type === 'balance_due').length
  const recentlySentCount = items.filter(i => i.type === 'recently_sent').length

  const actionItems = items.filter(i => i.type !== 'recently_sent')
  const sentItems = items.filter(i => i.type === 'recently_sent')

  return (
    <>
    <div className={`${cardCls} p-8 flex flex-col h-full`}>
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-bold text-primary">À traiter aujourd&apos;hui</h3>
        <div className="flex items-center gap-2">
          {overdueCount > 0 && (
            <span className="text-xs font-bold text-red-500 bg-red-50 dark:bg-red-500/10 px-3 py-1 rounded-full">
              {overdueCount} en retard
            </span>
          )}
          {balanceDueCount > 0 && (
            <span className="text-xs font-bold text-amber-600 bg-amber-50 dark:bg-amber-500/10 px-3 py-1 rounded-full">
              {balanceDueCount} solde à régler
            </span>
          )}
          {recurringCount > 0 && (
            <span className="text-xs font-bold text-violet-600 bg-violet-50 dark:bg-violet-500/10 px-3 py-1 rounded-full">
              {recurringCount} à confirmer
            </span>
          )}
        </div>
      </div>

      {actionItems.length === 0 && sentItems.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-8 gap-3">
          <CheckCircle2 className="w-10 h-10 text-secondary opacity-20" />
          <p className="font-semibold text-primary">Aucune tâche urgente</p>
          <p className="text-sm text-secondary">
            Les factures en retard et devis sans réponse apparaîtront ici.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 flex-1 overflow-y-auto">
          {actionItems.map(item => (
            <div key={item.id} className="flex flex-col gap-1">
              <div
                className={`flex items-center justify-between p-4 rounded-2xl border ${
                  item.type === 'overdue_invoice'
                    ? 'bg-red-50 dark:bg-red-500/5 border-red-200 dark:border-red-500/20'
                    : item.type === 'pending_recurring'
                    ? 'bg-violet-50 dark:bg-violet-500/5 border-violet-200 dark:border-violet-500/20'
                    : item.type === 'balance_due'
                    ? 'bg-amber-50 dark:bg-amber-500/5 border-amber-200 dark:border-amber-500/20'
                    : 'bg-amber-50 dark:bg-amber-500/5 border-amber-200 dark:border-amber-500/20'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  {item.type === 'overdue_invoice'
                    ? <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
                    : item.type === 'pending_recurring'
                    ? <Repeat className="w-4 h-4 text-violet-500 flex-shrink-0" />
                    : item.type === 'balance_due'
                    ? <Landmark className="w-4 h-4 text-amber-500 flex-shrink-0" />
                    : <Clock className="w-4 h-4 text-amber-500 flex-shrink-0" />
                  }
                  <div className="min-w-0">
                    <p className={`text-sm font-semibold truncate ${
                      item.type === 'overdue_invoice' ? 'text-red-700 dark:text-red-400'
                      : item.type === 'pending_recurring' ? 'text-violet-700 dark:text-violet-400'
                      : 'text-amber-700 dark:text-amber-400'
                    }`}>
                      {item.label}
                    </p>
                    {item.clientName && (
                      <p className="text-xs text-secondary truncate">{item.clientName}</p>
                    )}
                    {item.date && (
                      <p className="text-xs text-secondary mt-0.5">
                        {item.type === 'overdue_invoice' ? 'Échéance : '
                          : item.type === 'pending_recurring' ? 'Envoi prévu le : '
                          : item.type === 'balance_due' ? 'Solde attendu le : '
                          : 'Envoyé le : '}
                        {new Date(item.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 ml-3 flex-shrink-0">
                  {item.amount != null && (
                    <span className="text-sm font-bold text-primary tabular-nums mr-2">{fmt(item.amount)}</span>
                  )}
                  {item.type === 'pending_recurring' && item.invoiceId && (
                    <Link
                      href={`/finances/invoice-editor?id=${item.invoiceId}&returnTo=${encodeURIComponent('/dashboard')}`}
                      title="Vérifier et modifier le brouillon"
                      className="px-3 py-1.5 rounded-lg text-xs font-bold text-violet-700 dark:text-violet-400 bg-violet-100 dark:bg-violet-500/10 hover:bg-violet-200 dark:hover:bg-violet-500/20 transition-colors"
                    >
                      Modifier
                    </Link>
                  )}
                  {item.type === 'balance_due' && item.invoiceId && (
                    <Link
                      href={`/finances/invoice-editor?id=${item.invoiceId}&returnTo=${encodeURIComponent('/dashboard')}`}
                      title="Voir la facture d'acompte"
                      className="px-3 py-1.5 rounded-lg text-xs font-bold text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-500/10 hover:bg-amber-200 dark:hover:bg-amber-500/20 transition-colors"
                    >
                      Voir
                    </Link>
                  )}
                  {item.type === 'overdue_invoice' && (
                    <button
                      onClick={() => handleMarkPaid(item.id)}
                      disabled={!!loadingId}
                      title="Marquer comme payée"
                      className="p-1.5 text-secondary hover:text-accent-green transition-colors disabled:opacity-50 rounded-lg hover:bg-black/5 dark:hover:bg-white/5"
                    >
                      {loadingId === `paid-${item.id}`
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <Check className="w-4 h-4" />}
                    </button>
                  )}
                  {item.type === 'pending_quote' && (
                    <button
                      onClick={() => handleMarkQuoteAccepted(item.id)}
                      disabled={!!loadingId}
                      title="Marquer comme accepté"
                      className="p-1.5 text-secondary hover:text-accent-green transition-colors disabled:opacity-50 rounded-lg hover:bg-black/5 dark:hover:bg-white/5"
                    >
                      {loadingId === `accepted-${item.id}`
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <Check className="w-4 h-4" />}
                    </button>
                  )}
                  {quoteAiEnabled && item.type !== 'pending_recurring' && (
                    <button
                      onClick={() => handleRemind(item)}
                      disabled={!!loadingId}
                      title="Rédiger une relance IA"
                      className="p-1.5 text-secondary hover:text-accent transition-colors disabled:opacity-50 rounded-lg hover:bg-black/5 dark:hover:bg-white/5"
                    >
                      <Mail className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
              {errors[item.id] && (
                <p className="text-xs text-red-500 px-2">{errors[item.id]}</p>
              )}
            </div>
          ))}

          {/* Section envois automatiques récents */}
          {sentItems.length > 0 && (
            <div className="mt-2">
              <p className="text-xs font-bold text-secondary uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Send className="w-3 h-3" />
                Envoyé automatiquement (7 derniers jours)
              </p>
              <div className="flex flex-col gap-2">
                {sentItems.map(item => {
                  const isRelance = item.subtype === 'auto_reminder_invoice' || item.subtype === 'auto_reminder_quote'
                  const dAgo = item.date
                    ? Math.floor((Date.now() - new Date(item.date).getTime()) / 86400000)
                    : null
                  return (
                    <div key={item.id} className="flex items-center justify-between p-3 rounded-xl bg-green-50 dark:bg-green-500/5 border border-green-200 dark:border-green-500/15">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-primary truncate">{item.label}</p>
                          <p className="text-xs text-secondary truncate">
                            {item.clientName && <>{item.clientName} · </>}
                            {isRelance
                              ? `${item.subtype === 'auto_reminder_invoice' ? 'Relance facture' : 'Relance devis'}${item.rank && item.rank > 1 ? ` n°${item.rank}` : ''}`
                              : 'Facture récurrente'
                            }
                          </p>
                        </div>
                      </div>
                      <span className="text-xs text-secondary whitespace-nowrap flex-shrink-0 ml-3">
                        {dAgo === 0 ? "Aujourd'hui" : dAgo === 1 ? 'Hier' : `Il y a ${dAgo}j`}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>

    {quoteAiEnabled && reminderTarget && (
      <AIReminderModal
        type={reminderTarget.type}
        id={reminderTarget.id}
        onSent={() => {
          removeItem(reminderTarget.id)
          setReminderTarget(null)
        }}
        onClose={() => setReminderTarget(null)}
      />
    )}
    </>
  )
}
