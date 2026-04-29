'use client'

import React, { useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useFormState, useFormStatus } from 'react-dom'
import { useRouter } from 'next/navigation'
import { type Client } from '@/lib/data/queries/clients'
import { updateClient, deleteClient, type UpdateClientState } from '@/lib/data/mutations/clients'
import { markInvoicePaid } from '@/lib/data/mutations/invoices'
import { markQuoteAccepted } from '@/lib/data/mutations/quotes'
import { Edit2, Trash2, X, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'

const inputCls =
  'w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all'

const initialState: UpdateClientState = { error: null, success: false }

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-6 py-3 rounded-full bg-accent text-black font-bold hover:scale-105 transition-all shadow-lg shadow-accent/20 flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
    >
      {pending ? <><Loader2 className="w-4 h-4 animate-spin" />Enregistrement...</> : 'Enregistrer'}
    </button>
  )
}

function EditModal({ client, onClose }: { client: Client; onClose: () => void }) {
  const [state, formAction] = useFormState(updateClient, initialState)
  const [clientType, setClientType] = useState<'company' | 'individual'>((client.type as 'company' | 'individual') ?? 'company')

  React.useEffect(() => {
    if (state.success) onClose()
  }, [state.success, onClose])

  return createPortal(
    <div className="modal-overlay">
      <div className="modal-panel animate-in fade-in duration-300">
        <button onClick={onClose} className="absolute top-6 right-6 text-secondary hover:text-primary transition-colors">
          <X className="w-6 h-6" />
        </button>
        <h2 className="text-2xl font-bold text-primary mb-6">Modifier le client</h2>

        {state.error && (
          <div className="mb-5 flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-red-500/10 border border-red-500/25">
            <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <p className="text-xs text-red-400 leading-snug">{state.error}</p>
          </div>
        )}

        <form action={formAction} className="space-y-6">
          <input type="hidden" name="client_id" value={client.id} />
          <input type="hidden" name="type" value={clientType} />

          {/* Toggle professionnel / particulier */}
          <div className="flex rounded-xl overflow-hidden border border-[var(--elevation-border)]">
            {(['company', 'individual'] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setClientType(t)}
                className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${clientType === t ? 'bg-accent text-black' : 'text-secondary hover:text-primary'}`}
              >
                {t === 'company' ? 'Professionnel' : 'Particulier'}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {clientType === 'company' ? (
              <>
                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm font-semibold text-secondary">Raison sociale *</label>
                  <input name="company_name" type="text" required defaultValue={client.company_name ?? ''} placeholder="Dupont Bâtiment" className={inputCls} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm font-semibold text-secondary">Nom du contact référent</label>
                  <input name="contact_name" type="text" defaultValue={(client as any).contact_name ?? ''} placeholder="Marie Dupont" className={inputCls} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-secondary">SIRET</label>
                  <input name="siret" type="text" defaultValue={client.siret ?? ''} placeholder="12345678900012" className={`${inputCls} tabular-nums`} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-secondary">Email</label>
                  <input name="email" type="email" defaultValue={client.email ?? ''} placeholder="contact@entreprise.fr" className={inputCls} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-secondary">Téléphone</label>
                  <input name="phone" type="tel" defaultValue={client.phone ?? ''} placeholder="06 00 00 00 00" className={`${inputCls} tabular-nums`} />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-secondary">Prénom</label>
                  <input name="first_name" type="text" defaultValue={client.first_name ?? ''} placeholder="Jean" className={inputCls} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-secondary">Nom *</label>
                  <input name="last_name" type="text" required defaultValue={client.last_name ?? ''} placeholder="Dupont" className={inputCls} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-secondary">Email</label>
                  <input name="email" type="email" defaultValue={client.email ?? ''} placeholder="jean.dupont@gmail.com" className={inputCls} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-secondary">Téléphone</label>
                  <input name="phone" type="tel" defaultValue={client.phone ?? ''} placeholder="06 00 00 00 00" className={`${inputCls} tabular-nums`} />
                </div>
              </>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-secondary">Adresse</label>
            <input name="address_line1" type="text" defaultValue={client.address_line1 ?? ''} placeholder="12 rue de la Paix" className={inputCls} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-secondary">Code postal</label>
              <input name="postal_code" type="text" defaultValue={(client as any).postal_code ?? ''} placeholder="75001" className={`${inputCls} tabular-nums`} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-secondary">Ville</label>
              <input name="city" type="text" defaultValue={(client as any).city ?? ''} placeholder="Paris" className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-secondary">Statut</label>
              <select name="status" defaultValue={client.status ?? 'active'} className={`${inputCls} appearance-none`}>
                <option value="active">Actif</option>
                <option value="lead_hot">Lead Chaud</option>
                <option value="lead_cold">Lead Froid</option>
                <option value="inactive">Inactif</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-secondary">Conditions de paiement</label>
              <select name="payment_terms_days" defaultValue={String(client.payment_terms_days ?? 30)} className={`${inputCls} appearance-none`}>
                <option value="30">30 jours net</option>
                <option value="45">45 jours fin de mois</option>
                <option value="60">60 jours net</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-4 pt-4">
            <button type="button" onClick={onClose} className="px-6 py-3 rounded-full text-secondary hover:text-primary font-semibold transition-colors">
              Annuler
            </button>
            <SubmitButton />
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}

export function ClientActions({ client }: { client: Client }) {
  const router = useRouter()
  const [editOpen, setEditOpen] = useState(false)
  const [, startTransition] = useTransition()

  const handleDelete = () => {
    const name = client.company_name || [client.first_name, client.last_name].filter(Boolean).join(' ') || 'ce client'
    if (!confirm(`Supprimer "${name}" ? Ce client sera archivé et n'apparaîtra plus dans la liste.`)) return
    startTransition(async () => {
      const { error } = await deleteClient(client.id)
      if (!error) router.push('/clients')
    })
  }

  return (
    <>
      <button
        onClick={() => setEditOpen(true)}
        className="flex items-center gap-2 px-5 py-2.5 rounded-full border border-[var(--elevation-border)] text-secondary hover:text-primary hover:border-accent/50 transition-all font-semibold text-sm"
      >
        <Edit2 className="w-4 h-4" />
        Modifier
      </button>
      <button
        onClick={handleDelete}
        className="flex items-center gap-2 px-5 py-2.5 rounded-full border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-all font-semibold text-sm"
      >
        <Trash2 className="w-4 h-4" />
        Supprimer
      </button>
      {editOpen && <EditModal client={client} onClose={() => setEditOpen(false)} />}
    </>
  )
}

// ── Mark invoice paid inline ───────────────────────────────────────────────────

export function MarkInvoicePaidButton({ invoiceId, onDone }: { invoiceId: string; onDone?: () => void }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [done, setDone] = useState(false)

  const handleClick = () => {
    startTransition(async () => {
      await markInvoicePaid(invoiceId)
      setDone(true)
      onDone?.()
      router.refresh()
    })
  }

  if (done) return <span className="flex items-center gap-1.5 text-sm text-emerald-500 font-semibold"><CheckCircle2 className="w-4 h-4" />Marquée payée</span>

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      className="flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 hover:bg-emerald-500/20 transition-all font-semibold text-sm disabled:opacity-50"
    >
      {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
      Marquer payée
    </button>
  )
}

export function DocumentActions({
  type,
  id,
  status,
  onStatusChange,
}: {
  type: 'quote' | 'invoice'
  id: string
  status: string
  onStatusChange: (id: string, newStatus: string) => void
}) {
  if (type === 'invoice' && status !== 'paid') {
    return (
      <MarkInvoicePaidButton
        invoiceId={id}
        onDone={() => onStatusChange(id, 'paid')}
      />
    )
  }
  if (type === 'quote' && status !== 'accepted' && status !== 'converted') {
    return (
      <MarkQuoteAcceptedButton
        quoteId={id}
        onDone={() => onStatusChange(id, 'accepted')}
      />
    )
  }
  return null
}

export function MarkQuoteAcceptedButton({ quoteId, onDone }: { quoteId: string; onDone?: () => void }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [done, setDone] = useState(false)

  const handleClick = () => {
    startTransition(async () => {
      await markQuoteAccepted(quoteId)
      setDone(true)
      onDone?.()
      router.refresh()
    })
  }

  if (done) return <span className="flex items-center gap-1.5 text-sm text-accent font-semibold"><CheckCircle2 className="w-4 h-4" />Accepté</span>

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      className="flex items-center gap-2 px-4 py-2 rounded-full bg-accent/10 border border-accent/20 text-accent hover:bg-accent/20 transition-all font-semibold text-sm disabled:opacity-50"
    >
      {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
      Marquer accepté
    </button>
  )
}
