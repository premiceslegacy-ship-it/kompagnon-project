'use client'

import React, { useState, useMemo } from 'react'
import {
  X, Mail, Sparkles, Send, AlertCircle, CheckCircle2, Loader2, Users, Search,
} from 'lucide-react'
import Image from 'next/image'
import { AI_ASSISTANTS } from '@/lib/brand'
import { type Client } from '@/lib/data/queries/clients'
import { getClientDisplayName } from '@/lib/client'

// ─── Types ────────────────────────────────────────────────────────────────────

export type BroadcastFilter =
  | { mode: 'all' }
  | { mode: 'all_active' }
  | { mode: 'by_status'; statuses: string[] }
  | { mode: 'manual'; ids: string[] }

type Props = {
  isOpen: boolean
  onClose: () => void
  allClients: Client[]
  orgEmail: string | null
  orgName: string
  orgSignature: string | null
  hasAI: boolean
}

type Tab = 'manual' | 'sarah'

// filtre de catégorie — 'all' = afficher tous dans la liste sans pré-sélection de groupe
type CategoryFilter = 'all' | 'active' | 'prospect' | 'lead_hot' | 'lead_cold' | 'subcontractor' | 'inactive'

const inputCls =
  'w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all'

const CATEGORY_OPTIONS: { value: CategoryFilter; label: string }[] = [
  { value: 'all',          label: 'Tous les contacts' },
  { value: 'active',       label: 'Clients actifs' },
  { value: 'prospect',     label: 'Prospects' },
  { value: 'lead_hot',     label: 'Leads chauds' },
  { value: 'lead_cold',    label: 'Leads froids' },
  { value: 'subcontractor',label: 'Sous-traitants' },
  { value: 'inactive',     label: 'Inactifs' },
]

const TONE_OPTIONS = [
  { value: 'professionnel', label: 'Professionnel' },
  { value: 'chaleureux',    label: 'Chaleureux' },
  { value: 'neutre',        label: 'Neutre' },
]

function buildFilter(selectedIds: string[], category: CategoryFilter): BroadcastFilter {
  if (selectedIds.length > 0) return { mode: 'manual', ids: selectedIds }
  if (category === 'all') return { mode: 'all' }
  if (category === 'active') return { mode: 'all_active' }
  return { mode: 'by_status', statuses: [category] }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EmailComposerModal({
  isOpen,
  onClose,
  allClients,
  orgEmail,
  orgName,
  orgSignature,
  hasAI,
}: Props) {
  const [tab, setTab] = useState<Tab>('manual')
  const [object, setObject] = useState('')
  const [body, setBody] = useState('')

  // Sélection destinataires
  const [category, setCategory] = useState<CategoryFilter>('all')
  const [searchRecipient, setSearchRecipient] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Champs Sarah
  const [sarahContext, setSarahContext] = useState('')
  const [sarahTone, setSarahTone] = useState('professionnel')

  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sent, setSent] = useState<{ count: number; errors: number } | null>(null)

  if (!isOpen) return null

  const sarah = AI_ASSISTANTS.sarah

  // Contacts avec email filtrés par catégorie + recherche
  const contactsWithEmail = useMemo(() =>
    allClients.filter(c => c.email && c.email.trim() !== ''),
    [allClients]
  )

  const visibleContacts = useMemo(() => {
    let list = category === 'all' ? contactsWithEmail : contactsWithEmail.filter(c => c.status === category)
    if (searchRecipient.trim()) {
      const q = searchRecipient.toLowerCase()
      list = list.filter(c =>
        getClientDisplayName(c).toLowerCase().includes(q) ||
        (c.email ?? '').toLowerCase().includes(q)
      )
    }
    return list
  }, [contactsWithEmail, category, searchRecipient])

  // Tous les IDs visibles (pour "tout cocher/décocher")
  const visibleIds = useMemo(() => visibleContacts.map(c => c.id), [visibleContacts])
  const allVisibleChecked = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id))
  const someVisibleChecked = visibleIds.some(id => selectedIds.has(id))

  const toggleContact = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAllVisible = () => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (allVisibleChecked) {
        visibleIds.forEach(id => next.delete(id))
      } else {
        visibleIds.forEach(id => next.add(id))
      }
      return next
    })
  }

  // Résolution des destinataires finaux pour l'envoi et l'affichage
  const effectiveIds = Array.from(selectedIds)
  const hasManualSelection = effectiveIds.length > 0

  // Compte de destinataires réels (avec email) selon le mode
  const recipientCount = hasManualSelection
    ? effectiveIds.length
    : category === 'all' || category === 'active'
      ? contactsWithEmail.filter(c => category === 'all' || c.status === 'active').length
      : contactsWithEmail.filter(c => c.status === category).length

  const recipientLabel = hasManualSelection
    ? `${recipientCount} contact${recipientCount > 1 ? 's' : ''} sélectionné${recipientCount > 1 ? 's' : ''}`
    : CATEGORY_OPTIONS.find(o => o.value === category)?.label ?? category

  const handleAskSarah = async () => {
    if (!object.trim()) {
      setAiError("Renseignez l'objet avant de demander à Sarah.")
      return
    }
    setAiLoading(true)
    setAiError(null)
    try {
      const res = await fetch('/api/ai/email-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipients: recipientLabel,
          subject: object.trim(),
          tone: sarahTone,
          context: sarahContext.trim() || undefined,
          orgEmail: orgEmail ?? undefined,
          orgName,
        }),
      })
      const json = await res.json()
      if (!res.ok || json.error) {
        setAiError(json.error ?? 'Erreur lors de la génération.')
        return
      }
      setBody(json.draft)
      setTab('manual')
    } catch {
      setAiError('Erreur réseau. Veuillez réessayer.')
    } finally {
      setAiLoading(false)
    }
  }

  const handleSend = async () => {
    if (!object.trim()) { setSendError("L'objet est requis."); return }
    if (!body.trim()) { setSendError('Le corps du message est requis.'); return }
    if (recipientCount === 0) { setSendError('Aucun destinataire sélectionné avec une adresse email.'); return }

    setSending(true)
    setSendError(null)
    try {
      const res = await fetch('/api/email/send-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: object.trim(),
          bodyHtml: body.trim(),
          filter: buildFilter(effectiveIds, category),
        }),
      })
      const json = await res.json()
      if (!res.ok || json.error) {
        setSendError(json.error ?? "Erreur lors de l'envoi.")
        return
      }
      setSent({ count: json.sent, errors: json.errors })
    } catch {
      setSendError('Erreur réseau. Veuillez réessayer.')
    } finally {
      setSending(false)
    }
  }

  const handleClose = () => {
    setObject('')
    setBody('')
    setCategory('all')
    setSearchRecipient('')
    setSelectedIds(new Set())
    setSarahContext('')
    setSarahTone('professionnel')
    setAiError(null)
    setSendError(null)
    setSent(null)
    setTab('manual')
    onClose()
  }

  if (sent) {
    return (
      <div className="modal-overlay">
        <div className="modal-panel animate-in fade-in duration-300 max-w-lg text-center">
          <div className="flex flex-col items-center gap-5 py-8">
            <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-green-500" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-primary">Emails envoyés</h2>
              <p className="text-secondary">
                {sent.count} email{sent.count > 1 ? 's' : ''} envoyé{sent.count > 1 ? 's' : ''} avec succès.
                {sent.errors > 0 && (
                  <span className="text-amber-400"> {sent.errors} échec{sent.errors > 1 ? 's' : ''}.</span>
                )}
              </p>
            </div>
            <button onClick={handleClose} className="btn-primary px-8 py-3 rounded-full font-bold">
              Fermer
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-overlay">
      <div className="modal-panel animate-in fade-in duration-300 max-w-3xl w-full">
        <button
          onClick={handleClose}
          className="absolute top-6 right-6 text-secondary hover:text-primary transition-colors"
        >
          <X className="w-6 h-6" />
        </button>

        {/* En-tête */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
            <Mail className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-primary">Envoyer un email</h2>
            <p className="text-sm text-secondary mt-0.5">Chaque destinataire reçoit son propre email individuel.</p>
          </div>
        </div>

        {!orgEmail && (
          <div className="mb-5 flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-amber-500/10 border border-amber-500/25">
            <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-400 leading-snug">
              Aucune adresse expéditeur configurée. Rendez-vous dans Paramètres &gt; Email pour en configurer une.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.6fr] gap-6">

          {/* ── Colonne gauche : destinataires ── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-secondary">Destinataires</label>
              {hasManualSelection && (
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="text-xs text-accent hover:underline"
                >
                  Tout décocher
                </button>
              )}
            </div>

            {/* Filtre de catégorie */}
            <select
              value={category}
              onChange={e => {
                setCategory(e.target.value as CategoryFilter)
                setSelectedIds(new Set())
              }}
              className={`${inputCls} appearance-none text-sm`}
            >
              {CATEGORY_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>

            {/* Recherche dans la liste */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary" />
              <input
                type="text"
                value={searchRecipient}
                onChange={e => setSearchRecipient(e.target.value)}
                placeholder="Rechercher..."
                className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all"
              />
            </div>

            {/* Liste avec checkboxes */}
            <div className="rounded-xl border border-[var(--elevation-border)] overflow-hidden">
              {/* Tout cocher / décocher */}
              {visibleContacts.length > 0 && (
                <label className="flex items-center gap-3 px-3 py-2.5 border-b border-[var(--elevation-border)] bg-surface dark:bg-white/5 cursor-pointer hover:bg-accent/5 transition-colors">
                  <input
                    type="checkbox"
                    checked={allVisibleChecked}
                    ref={el => { if (el) el.indeterminate = someVisibleChecked && !allVisibleChecked }}
                    onChange={toggleAllVisible}
                    className="w-4 h-4 rounded accent-accent"
                  />
                  <span className="text-xs font-semibold text-secondary">
                    {allVisibleChecked ? 'Tout décocher' : 'Tout cocher'} ({visibleContacts.length})
                  </span>
                </label>
              )}

              {/* Contacts */}
              <div className="max-h-56 overflow-y-auto divide-y divide-[var(--elevation-border)]">
                {visibleContacts.length === 0 ? (
                  <p className="px-3 py-4 text-xs text-secondary text-center">
                    {searchRecipient ? 'Aucun résultat.' : 'Aucun contact avec une adresse email dans cette catégorie.'}
                  </p>
                ) : (
                  visibleContacts.map(client => (
                    <label
                      key={client.id}
                      className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-accent/5 transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(client.id)}
                        onChange={() => toggleContact(client.id)}
                        className="w-4 h-4 rounded accent-accent shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-primary truncate">{getClientDisplayName(client)}</p>
                        <p className="text-xs text-secondary truncate">{client.email}</p>
                      </div>
                    </label>
                  ))
                )}
              </div>
            </div>

            {/* Compteur */}
            <div className="flex items-center gap-1.5 text-xs text-secondary">
              <Users className="w-3.5 h-3.5 shrink-0" />
              {hasManualSelection ? (
                <span><span className="text-primary font-semibold">{recipientCount}</span> contact{recipientCount > 1 ? 's' : ''} sélectionné{recipientCount > 1 ? 's' : ''}</span>
              ) : (
                <span>Tous les contacts de la catégorie seront inclus <span className="text-primary font-semibold">({recipientCount})</span></span>
              )}
            </div>
          </div>

          {/* ── Colonne droite : composition ── */}
          <div className="space-y-4">

            {/* Onglets */}
            {hasAI && (
              <div className="flex rounded-xl overflow-hidden border border-[var(--elevation-border)]">
                <button
                  type="button"
                  onClick={() => setTab('manual')}
                  className={`flex-1 py-2.5 text-sm font-semibold transition-colors flex items-center justify-center gap-2 ${
                    tab === 'manual' ? 'bg-accent text-black' : 'text-secondary hover:text-primary'
                  }`}
                >
                  <Mail className="w-4 h-4" />
                  Écrire moi-même
                </button>
                <button
                  type="button"
                  onClick={() => setTab('sarah')}
                  className={`flex-1 py-2.5 text-sm font-semibold transition-colors flex items-center justify-center gap-2 ${
                    tab === 'sarah' ? 'bg-accent text-black' : 'text-secondary hover:text-primary'
                  }`}
                >
                  <Sparkles className="w-4 h-4" />
                  Demander à Sarah
                </button>
              </div>
            )}

            {/* Objet — commun aux deux onglets */}
            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-secondary">Objet</label>
              <input
                type="text"
                value={object}
                onChange={e => setObject(e.target.value)}
                placeholder="Ex : Application de la TVA à partir du 1er juillet"
                className={inputCls}
              />
            </div>

            {/* ── Onglet : écrire moi-même ── */}
            {tab === 'manual' && (
              <div className="space-y-3">
                {/* Email tel qu'il sera envoyé */}
                <div className="rounded-xl border border-[var(--elevation-border)] overflow-hidden text-sm">
                  {/* Corps — éditable, l'artisan écrit tout */}
                  <textarea
                    value={body}
                    onChange={e => setBody(e.target.value)}
                    rows={9}
                    placeholder={"Bonjour Jean,\n\nRédigez votre message ici...\n\nCordialement,"}
                    className="w-full px-4 py-3 bg-transparent text-primary text-sm leading-relaxed focus:outline-none resize-none placeholder:text-secondary/40"
                  />

                  {/* Note personnalisation */}
                  <div className="px-4 py-2 border-t border-[var(--elevation-border)] bg-surface/30 dark:bg-white/[0.01]">
                    <p className="text-xs text-secondary/60 leading-relaxed">
                      Si votre première ligne est une salutation (Bonjour, Salut, Madame, Monsieur...), elle sera remplacée automatiquement pour chaque destinataire par son prénom, le nom du contact référent, ou &quot;l&apos;équipe [Entreprise]&quot; selon ce qui est renseigné sur sa fiche.
                    </p>
                  </div>

                  {/* Signature */}
                  <div className="px-4 py-3 border-t border-[var(--elevation-border)] bg-surface/50 dark:bg-white/[0.02]">
                    {orgSignature ? (
                      <p className="text-sm text-secondary whitespace-pre-wrap leading-relaxed">{orgSignature}</p>
                    ) : orgEmail ? (
                      <p className="text-sm text-secondary leading-relaxed">
                        {orgName}<br />
                        <span className="text-secondary/70">{orgEmail}</span>
                      </p>
                    ) : (
                      <p className="text-xs text-secondary/50 italic">
                        Aucune signature configurée. Rendez-vous dans Paramètres &gt; Email.
                      </p>
                    )}
                  </div>
                </div>

                {sendError && (
                  <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-red-500/10 border border-red-500/25">
                    <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-red-400 leading-snug">{sendError}</p>
                  </div>
                )}

                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={handleClose}
                    className="px-6 py-3 rounded-full text-secondary hover:text-primary font-semibold transition-colors"
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={sending || !orgEmail || recipientCount === 0}
                    className="px-6 py-3 rounded-full bg-accent text-black font-bold hover:scale-105 transition-all shadow-lg shadow-accent/20 flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
                  >
                    {sending ? (
                      <><Loader2 className="w-4 h-4 animate-spin" />Envoi en cours...</>
                    ) : (
                      <><Send className="w-4 h-4" />Envoyer à {recipientCount} contact{recipientCount > 1 ? 's' : ''}</>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* ── Onglet : Sarah ── */}
            {tab === 'sarah' && hasAI && (
              <div className="space-y-4">
                <div className="flex items-start gap-3 p-4 rounded-xl bg-surface dark:bg-white/5 border border-[var(--elevation-border)]">
                  <div className="w-10 h-10 rounded-full overflow-hidden shrink-0 bg-accent/10">
                    {sarah.avatar ? (
                      <Image src={sarah.avatar} alt="Sarah" width={40} height={40} className="object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-accent font-bold text-sm">S</div>
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-primary">Sarah, secrétaire métier</p>
                    <p className="text-xs text-secondary mt-0.5 leading-relaxed">
                      Donnez-lui le contexte. Elle génère un brouillon que vous pourrez relire et modifier librement avant l&apos;envoi.
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-secondary">Ton souhaité</label>
                  <div className="flex gap-2">
                    {TONE_OPTIONS.map(t => (
                      <button
                        key={t.value}
                        type="button"
                        onClick={() => setSarahTone(t.value)}
                        className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                          sarahTone === t.value
                            ? 'bg-accent text-black border-accent'
                            : 'border-[var(--elevation-border)] text-secondary hover:text-primary'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-secondary">
                    Contexte <span className="text-secondary/60 font-normal">(optionnel)</span>
                  </label>
                  <textarea
                    value={sarahContext}
                    onChange={e => setSarahContext(e.target.value)}
                    rows={5}
                    placeholder="Ex : À partir du 1er juillet nous dépassons le seuil de franchise TVA. Les tarifs restent inchangés mais la TVA à 20 % s'appliquera désormais..."
                    className={`${inputCls} resize-none text-sm`}
                  />
                </div>

                {aiError && (
                  <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-red-500/10 border border-red-500/25">
                    <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-red-400 leading-snug">{aiError}</p>
                  </div>
                )}

                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={handleClose}
                    className="px-6 py-3 rounded-full text-secondary hover:text-primary font-semibold transition-colors"
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    onClick={handleAskSarah}
                    disabled={aiLoading}
                    className="px-6 py-3 rounded-full bg-accent text-black font-bold hover:scale-105 transition-all shadow-lg shadow-accent/20 flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
                  >
                    {aiLoading ? (
                      <><Loader2 className="w-4 h-4 animate-spin" />Sarah rédige...</>
                    ) : (
                      <><Sparkles className="w-4 h-4" />Générer le brouillon</>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
