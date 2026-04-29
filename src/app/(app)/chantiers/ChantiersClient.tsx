'use client'

import React, { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  HardHat, Plus, X, Search, MapPin, Calendar,
  MoreVertical, Trash2, CheckCircle, PauseCircle, XCircle, PlayCircle,
  RefreshCw, Copy, Clock,
} from 'lucide-react'
import type { Chantier, ChantierStats } from '@/lib/data/queries/chantiers'
import type { Client } from '@/lib/data/queries/clients'
import type { QuoteStub } from '@/lib/data/queries/quotes'
import { createChantier, updateChantier, deleteChantier } from '@/lib/data/mutations/chantiers'

// ─── Types ───────────────────────────────────────────────────────────────────

type Status = Chantier['status']

type RecurrenceType = 'none' | 'quotidien' | 'plurihebdomadaire' | 'hebdomadaire' | 'mensuel' | 'bimensuel' | 'trimestriel'

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<Status, { label: string; color: string }> = {
  planifie:  { label: 'Planifié',  color: 'bg-blue-500/15 text-blue-500' },
  en_cours:  { label: 'En cours',  color: 'bg-green-500/15 text-green-600' },
  suspendu:  { label: 'Suspendu',  color: 'bg-amber-500/15 text-amber-500' },
  termine:   { label: 'Terminé',   color: 'bg-secondary/20 text-secondary' },
  annule:    { label: 'Annulé',    color: 'bg-red-500/15 text-red-500' },
}

function fmtHours(hours: number): string {
  const h = Math.floor(hours)
  const min = Math.round((hours - h) * 60)
  if (min === 0) return `${h}h`
  return `${h}h${String(min).padStart(2, '0')}`
}

const RECURRENCE_OPTIONS: { value: RecurrenceType; label: string }[] = [
  { value: 'none',              label: 'Ponctuel (pas de récurrence)' },
  { value: 'quotidien',         label: 'Tous les jours' },
  { value: 'plurihebdomadaire', label: 'Plusieurs fois par semaine' },
  { value: 'hebdomadaire',      label: 'Toutes les semaines' },
  { value: 'mensuel',           label: 'Tous les mois' },
  { value: 'bimensuel',         label: 'Tous les 2 mois' },
  { value: 'trimestriel',       label: 'Tous les trimestres' },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function DurationPicker({ value, onChange, label }: { value: number; onChange: (v: number) => void; label?: string }) {
  const h = Math.floor(value)
  const min = Math.round((value - h) * 60)
  const HOURS = Array.from({ length: 17 }, (_, i) => i) // 0–16h
  const MINUTES = [0, 15, 30, 45]
  return (
    <div>
      {label && <label className="block text-xs font-semibold text-secondary mb-1">{label}</label>}
      <div className="flex items-center gap-1">
        <select
          value={h}
          onChange={e => onChange(parseInt(e.target.value) + min / 60)}
          className="input py-1.5 px-2 text-sm"
        >
          {HOURS.map(i => <option key={i} value={i}>{i}h</option>)}
        </select>
        <select
          value={min}
          onChange={e => onChange(h + parseInt(e.target.value) / 60)}
          className="input py-1.5 px-2 text-sm"
        >
          {MINUTES.map(m => <option key={m} value={m}>{String(m).padStart(2, '0')}min</option>)}
        </select>
      </div>
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="card p-5">
      <p className="text-xs font-semibold text-secondary uppercase tracking-wider mb-1">{label}</p>
      <p className="text-2xl font-extrabold text-primary">{value}</p>
      {sub && <p className="text-xs text-secondary mt-0.5">{sub}</p>}
    </div>
  )
}

function StatusBadge({ status }: { status: Status }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, color: 'bg-secondary/20 text-secondary' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.color}`}>
      {cfg.label}
    </span>
  )
}

function RecurrenceBadge({ recurrence }: { recurrence: RecurrenceType | null | undefined }) {
  if (!recurrence || recurrence === 'none') return null
  const label = RECURRENCE_OPTIONS.find(o => o.value === recurrence)?.label ?? recurrence
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-accent/10 text-accent">
      <RefreshCw className="w-3 h-3" />
      {label}
    </span>
  )
}

function ActionMenu({ status, onReprendre, onTerminer, onSuspendre, onAnnuler, onDupliquer, onSupprimer, canDelete }: {
  status: Status
  onReprendre: () => void
  onTerminer: () => void
  onSuspendre: () => void
  onAnnuler: () => void
  onDupliquer: () => void
  onSupprimer: () => void
  canDelete?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        onClick={e => { e.stopPropagation(); setOpen(v => !v) }}
        className="p-1.5 rounded hover:bg-base transition-colors text-secondary hover:text-primary"
      >
        <MoreVertical className="w-4 h-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setOpen(false) }} />
          <div className="absolute right-0 top-8 z-20 w-48 menu-panel py-1 shadow-lg rounded-lg">
            {(status === 'suspendu' || status === 'termine' || status === 'annule') && (
              <button onClick={(e) => { e.stopPropagation(); setOpen(false); onReprendre() }} className="w-full text-left px-4 py-2 text-sm text-primary hover:bg-base flex items-center gap-2">
                <PlayCircle className="w-4 h-4 text-blue-500" /> Reprendre
              </button>
            )}
            {status !== 'termine' && status !== 'annule' && (
              <button onClick={(e) => { e.stopPropagation(); setOpen(false); onTerminer() }} className="w-full text-left px-4 py-2 text-sm text-primary hover:bg-base flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-500" /> Terminer
              </button>
            )}
            {status !== 'suspendu' && status !== 'termine' && status !== 'annule' && (
              <button onClick={(e) => { e.stopPropagation(); setOpen(false); onSuspendre() }} className="w-full text-left px-4 py-2 text-sm text-primary hover:bg-base flex items-center gap-2">
                <PauseCircle className="w-4 h-4 text-amber-500" /> Suspendre
              </button>
            )}
            {status !== 'annule' && status !== 'termine' && (
              <button onClick={(e) => { e.stopPropagation(); setOpen(false); onAnnuler() }} className="w-full text-left px-4 py-2 text-sm text-primary hover:bg-base flex items-center gap-2">
                <XCircle className="w-4 h-4 text-secondary" /> Annuler
              </button>
            )}
            <button onClick={(e) => { e.stopPropagation(); setOpen(false); onDupliquer() }} className="w-full text-left px-4 py-2 text-sm text-primary hover:bg-base flex items-center gap-2">
              <Copy className="w-4 h-4 text-blue-400" /> Dupliquer
            </button>
            {canDelete && (
              <>
                <div className="h-px bg-[var(--elevation-border)] my-1" />
                <button onClick={(e) => { e.stopPropagation(); setOpen(false); onSupprimer() }} className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-red-500/10 flex items-center gap-2">
                  <Trash2 className="w-4 h-4" /> Supprimer
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Modal création ───────────────────────────────────────────────────────────

function CreateModal({ clients, linkableQuotes, onClose, onCreated }: {
  clients: Client[]
  linkableQuotes: QuoteStub[]
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    title: '', clientId: '', addressLine1: '', postalCode: '', city: '',
    startDate: '', estimatedEndDate: '', budgetHt: '',
    contactName: '', contactEmail: '', contactPhone: '',
    quoteId: '',
    recurrence: 'none' as RecurrenceType,
    recurrenceTimes: '1',
    recurrenceTeamSize: '',
    recurrenceDurationSlots: [2] as number[], // durée par passage (h décimal)
    recurrenceNotes: '',
  })

  const set = (field: string, value: string) => setForm(f => ({ ...f, [field]: value }))

  const handleQuoteChange = (quoteId: string) => {
    const q = linkableQuotes.find(x => x.id === quoteId)
    if (q) {
      // Toujours écraser depuis le devis sélectionné pour que changer de devis mette tout à jour
      setForm(f => ({
        ...f,
        quoteId,
        title: q.title || '',
        clientId: q.client_id || '',
        budgetHt: q.total_ht != null ? String(Math.round(q.total_ht)) : '',
        addressLine1: q.client_address_line1 || '',
        postalCode: q.client_postal_code || '',
        city: q.client_city || '',
        contactName: q.client_contact_name || '',
        contactEmail: q.client_contact_email || '',
        contactPhone: q.client_contact_phone || '',
      }))
    } else {
      // Désélection : remettre les champs à vide
      setForm(f => ({
        ...f,
        quoteId: '',
        title: '',
        clientId: '',
        budgetHt: '',
        addressLine1: '',
        postalCode: '',
        city: '',
        contactName: '',
        contactEmail: '',
        contactPhone: '',
      }))
    }
  }

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { chantierId, error: err } = await createChantier({
      title: form.title,
      clientId: form.clientId || null,
      addressLine1: form.addressLine1 || null,
      postalCode: form.postalCode || null,
      city: form.city || null,
      startDate: form.startDate || null,
      estimatedEndDate: form.estimatedEndDate || null,
      budgetHt: form.budgetHt ? parseFloat(form.budgetHt) : 0,
      contactName: form.contactName || null,
      contactEmail: form.contactEmail || null,
      contactPhone: form.contactPhone || null,
      quoteId: form.quoteId || null,
      recurrence: form.recurrence,
      recurrenceTimes: form.recurrenceTimes ? parseInt(form.recurrenceTimes) : 1,
      recurrenceTeamSize: form.recurrenceTeamSize ? parseInt(form.recurrenceTeamSize) : null,
      recurrenceDurationH: form.recurrenceDurationSlots[0] ?? null,
      recurrenceDurationSlots: form.recurrenceDurationSlots,
      recurrenceNotes: form.recurrenceNotes || null,
    })
    setLoading(false)
    if (err) return setError(err)
    onCreated(chantierId!)
  }

  return (
    <div className="modal-overlay">
      <div className="modal-panel sm:max-w-lg">
        {/* Header modal */}
        <div className="flex items-center gap-3 px-6 pt-6 pb-4 border-b border-[var(--elevation-border)]">
          <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center flex-shrink-0">
            <HardHat className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h2 className="text-base font-bold text-primary">Nouveau chantier</h2>
            <p className="text-xs text-secondary">Remplissez les informations du chantier</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5 max-h-[80vh] overflow-y-auto bg-base/50">
          <div className="card p-4 space-y-4 shadow-sm">
          {/* Devis lié */}
          {linkableQuotes.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-secondary mb-1.5">Issu d&apos;un devis <span className="font-normal text-secondary/70">(optionnel, pré-remplit les infos)</span></label>
              <select
                className="input w-full"
                value={form.quoteId}
                onChange={e => handleQuoteChange(e.target.value)}
              >
                <option value="">Nouveau chantier sans devis</option>
                {linkableQuotes.map(q => (
                  <option key={q.id} value={q.id}>
                    {q.number ? `${q.number} · ` : ''}{q.title ?? 'Sans titre'}{q.client_name ? ` (${q.client_name})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Titre */}
          <div>
            <label className="block text-xs font-semibold text-secondary mb-1.5">Titre du chantier *</label>
            <input
              className="input w-full"
              placeholder="Ex : Réfection toiture bâtiment A"
              value={form.title}
              onChange={e => set('title', e.target.value)}
              required
              autoFocus
            />
          </div>

          {/* Client */}
          <div>
            <label className="block text-xs font-semibold text-secondary mb-1.5">Client</label>
            <select className="input w-full" value={form.clientId} onChange={e => set('clientId', e.target.value)}>
              <option value="">Aucun client associé</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.company_name ?? [c.first_name, c.last_name].filter(Boolean).join(' ')}</option>
              ))}
            </select>
          </div>
          </div>

          <div className="card p-4 space-y-4 shadow-sm">
            {/* Adresse */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-secondary">Adresse du chantier</label>
            <input
              className="input w-full"
              placeholder="Rue, numéro..."
              value={form.addressLine1}
              onChange={e => set('addressLine1', e.target.value)}
            />
            <div className="grid grid-cols-3 gap-2">
              <input className="input w-full" placeholder="Code postal" value={form.postalCode} onChange={e => set('postalCode', e.target.value)} />
              <input className="input w-full col-span-2" placeholder="Ville" value={form.city} onChange={e => set('city', e.target.value)} />
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-secondary mb-1.5">Date de début</label>
              <input type="date" className="input w-full" value={form.startDate} onChange={e => set('startDate', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-secondary mb-1.5">Fin estimée</label>
              <input type="date" className="input w-full" value={form.estimatedEndDate} onChange={e => set('estimatedEndDate', e.target.value)} />
            </div>
          </div>

          {/* Budget */}
          <div>
            <label className="block text-xs font-semibold text-secondary mb-1.5">Budget HT (€)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className="input w-full"
              placeholder="0.00"
              value={form.budgetHt}
              onChange={e => set('budgetHt', e.target.value)}
            />
          </div>
          </div>

          <div className="card p-4 space-y-4 shadow-sm">
            {/* Contact référent */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-secondary">Personne référente <span className="font-normal">(optionnel)</span></label>
            <input
              className="input w-full"
              placeholder="Nom du contact"
              value={form.contactName}
              onChange={e => set('contactName', e.target.value)}
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                className="input w-full"
                type="email"
                placeholder="Email"
                value={form.contactEmail}
                onChange={e => set('contactEmail', e.target.value)}
              />
              <input
                className="input w-full"
                type="tel"
                placeholder="Téléphone"
                value={form.contactPhone}
                onChange={e => set('contactPhone', e.target.value)}
              />
            </div>
          </div>

          </div>

          {/* ─── Section Récurrence ─── */}
          <div className="rounded-xl p-4 space-y-3 bg-accent/10 border border-accent/20">
            <div className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-accent flex-shrink-0" />
              <p className="text-sm font-semibold text-primary">Récurrence</p>
            </div>
            <p className="text-xs text-secondary">
              Pour les chantiers qui reviennent régulièrement (entretien mensuel, nettoyage…), définissez ici la fréquence.
            </p>
            <select
              className="input w-full"
              value={form.recurrence}
              onChange={e => set('recurrence', e.target.value)}
            >
              {RECURRENCE_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>

            {/* Équipe */}
            <div>
              <label className="block text-xs font-semibold text-secondary mb-1">Nombre de personnes</label>
              <input
                type="number" min="1" className="input w-full"
                placeholder="2" value={form.recurrenceTeamSize}
                onChange={e => set('recurrenceTeamSize', e.target.value)}
              />
            </div>

            {/* Pour plurihebdomadaire : nb fois/semaine pilote les slots */}
            {form.recurrence === 'plurihebdomadaire' && (
              <div>
                <label className="block text-xs font-semibold text-secondary mb-1">Fois/semaine</label>
                <input
                  type="number" min="2" max="7" className="input w-full"
                  placeholder="3" value={form.recurrenceTimes}
                  onChange={e => {
                    const n = Math.max(2, Math.min(7, parseInt(e.target.value) || 2))
                    setForm(f => {
                      const slots = [...f.recurrenceDurationSlots]
                      while (slots.length < n) slots.push(slots[slots.length - 1] ?? 2)
                      return { ...f, recurrenceTimes: String(n), recurrenceDurationSlots: slots.slice(0, n) }
                    })
                  }}
                />
              </div>
            )}

            {/* ─── Passages (toujours visible) ─── */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-semibold text-secondary">Durée par passage</label>
                {form.recurrence !== 'plurihebdomadaire' && (
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, recurrenceDurationSlots: [...f.recurrenceDurationSlots, f.recurrenceDurationSlots[f.recurrenceDurationSlots.length - 1] ?? 2] }))}
                    className="flex items-center gap-1 text-xs font-semibold text-accent hover:text-accent/80 transition-colors"
                  >
                    <Plus className="w-3 h-3" /> Ajouter un passage
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {form.recurrenceDurationSlots.map((dur, idx) => (
                  <div key={idx} className="flex items-end gap-1">
                    <DurationPicker
                      label={form.recurrenceDurationSlots.length > 1 ? `Passage ${idx + 1}` : undefined}
                      value={dur}
                      onChange={v => setForm(f => {
                        const slots = [...f.recurrenceDurationSlots]
                        slots[idx] = v
                        return { ...f, recurrenceDurationSlots: slots }
                      })}
                    />
                    {form.recurrenceDurationSlots.length > 1 && form.recurrence !== 'plurihebdomadaire' && (
                      <button
                        type="button"
                        onClick={() => setForm(f => ({ ...f, recurrenceDurationSlots: f.recurrenceDurationSlots.filter((_, i) => i !== idx) }))}
                        className="w-8 h-8 mb-0.5 flex items-center justify-center rounded-lg text-secondary hover:text-red-500 hover:bg-red-500/10 transition-colors"
                        title="Supprimer ce passage"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {form.recurrenceDurationSlots.length > 1 && (
                <p className="text-xs text-secondary/70">
                  Total : {fmtHours(form.recurrenceDurationSlots.reduce((a, b) => a + b, 0))} par {form.recurrence === 'none' ? 'intervention' : 'passage'}
                </p>
              )}
            </div>

            {/* Notes libres */}
            <div>
              <label className="block text-xs font-semibold text-secondary mb-1">
                Consignes / accès / matériel <span className="font-normal text-secondary/70">(optionnel)</span>
              </label>
              <textarea
                className="input w-full resize-none"
                rows={2}
                placeholder="Ex : Clé boîte à clés code 1234 · Produits fournis · Laisser les fenêtres ouvertes…"
                value={form.recurrenceNotes}
                onChange={e => set('recurrenceNotes', e.target.value)}
              />
            </div>
          </div>

          {error && <p className="text-sm text-red-500 font-medium">{error}</p>}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary flex-1"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={loading || !form.title.trim()}
              className="btn-primary flex-1"
            >
              {loading ? 'Création...' : 'Créer le chantier'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function ChantiersClient({
  initialChantiers,
  stats,
  clients,
  linkableQuotes,
  canCreate = false,
  canDelete = false,
}: {
  initialChantiers: Chantier[]
  stats: ChantierStats
  clients: Client[]
  linkableQuotes: QuoteStub[]
  canCreate?: boolean
  canDelete?: boolean
}) {
  const router = useRouter()
  const [chantiers, setChantiers] = useState(initialChantiers)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<Status | 'tous'>('tous')
  const [showCreate, setShowCreate] = useState(false)

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return chantiers.filter(c => {
      const matchSearch = !q ||
        c.title.toLowerCase().includes(q) ||
        (c.client?.company_name ?? '').toLowerCase().includes(q) ||
        (c.city ?? '').toLowerCase().includes(q)
      const matchStatus = filterStatus === 'tous' || c.status === filterStatus
      return matchSearch && matchStatus
    })
  }, [chantiers, search, filterStatus])

  const handleStatusChange = async (chantier: Chantier, newStatus: Status) => {
    setChantiers(prev => prev.map(c => c.id === chantier.id ? { ...c, status: newStatus } : c))
    await updateChantier(chantier.id, { status: newStatus })
  }

  const handleDuplicate = async (chantier: Chantier) => {
    const { chantierId, error } = await createChantier({
      title: `${chantier.title} (copie)`,
      clientId: chantier.client?.id ?? null,
      addressLine1: chantier.address_line1 ?? null,
      postalCode: chantier.postal_code ?? null,
      city: chantier.city ?? null,
      startDate: null,
      estimatedEndDate: null,
      budgetHt: chantier.budget_ht ?? 0,
    })
    if (!error && chantierId) {
      router.push(`/chantiers/${chantierId}`)
    }
  }

  const handleDelete = async (chantier: Chantier) => {
    if (!confirm(`Archiver le chantier "${chantier.title}" ?`)) return
    setChantiers(prev => prev.filter(c => c.id !== chantier.id))
    await deleteChantier(chantier.id)
  }

  const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '/'
  const fmtMoney = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

  return (
    <div className="page-container space-y-6">
      {/* Header */}
      <div className="card p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center flex-shrink-0">
            <HardHat className="w-6 h-6 text-accent" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-primary">Chantiers</h1>
            <p className="text-sm text-secondary font-medium">Gérez vos projets et suivez leur avancement</p>
          </div>
        </div>
        <div className="flex items-center gap-4 flex-wrap mt-4 md:mt-0">
          <Link
            href="/chantiers/planning"
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[var(--elevation-border)] text-sm font-semibold text-secondary hover:text-primary hover:border-accent/40 bg-base transition-all shadow-sm whitespace-nowrap"
          >
            <Calendar className="w-4 h-4" /> Planning global
          </Link>
          <Link
            href="/chantiers/heures"
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[var(--elevation-border)] text-sm font-semibold text-secondary hover:text-primary hover:border-accent/40 bg-base transition-all shadow-sm whitespace-nowrap"
          >
            <Clock className="w-4 h-4" /> Heures pointées
          </Link>
          {canCreate && (
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent text-white font-bold hover:bg-accent/90 shadow-sm shadow-accent/20 transition-all border border-accent/20 whitespace-nowrap"
            >
              <Plus className="w-5 h-5 text-white" /> Créer un chantier
            </button>
          )}
        </div>
      </div>

      {/* StatCards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total chantiers" value={stats.total} />
        <StatCard label="En cours" value={stats.enCours} />
        <StatCard label="Terminés ce mois" value={stats.terminesCeMois} />
        <StatCard label="Heures ce mois" value={fmtHours(stats.heuresCeMois)} />
      </div>

      {/* Barre recherche / filtre */}
      <div className="card p-4 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary" />
          <input
            className="input pl-9 w-full"
            placeholder="Rechercher un chantier, client, ville..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          className="input w-full sm:w-44"
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value as Status | 'tous')}
        >
          <option value="tous">Tous les statuts</option>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <HardHat className="w-12 h-12 text-secondary mx-auto mb-3 opacity-40" />
          <p className="text-secondary font-semibold">Aucun chantier trouvé</p>
          <p className="text-secondary text-sm mt-1">Créez votre premier chantier ou modifiez les filtres</p>
        </div>
      ) : (
        <div className="card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--elevation-border)] text-xs text-secondary uppercase tracking-wider">
                <th className="text-left px-4 py-3 font-semibold">Chantier / Client</th>
                <th className="text-left px-4 py-3 font-semibold hidden md:table-cell">Adresse</th>
                <th className="text-left px-4 py-3 font-semibold">Statut</th>
                <th className="text-left px-4 py-3 font-semibold hidden lg:table-cell">Dates</th>
                <th className="text-right px-4 py-3 font-semibold hidden lg:table-cell">Budget HT</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--elevation-border)]">
              {filtered.map((c, i) => (
                <tr
                  key={c.id}
                  className={`hover:bg-base/50 transition-colors cursor-pointer ${i === filtered.length - 1 ? '[&>td:first-child]:rounded-bl-3xl [&>td:last-child]:rounded-br-3xl' : ''}`}
                  onClick={() => router.push(`/chantiers/${c.id}`)}
                >
                  <td className="px-4 py-3">
                    <p className="font-semibold text-primary truncate max-w-[200px]">{c.title}</p>
                    {c.client?.company_name && (
                      <p className="text-xs text-secondary mt-0.5">{c.client.company_name}</p>
                    )}
                    {/* Badge récurrence si disponible */}
                    {(c as any).recurrence && (c as any).recurrence !== 'none' && (
                      <RecurrenceBadge recurrence={(c as any).recurrence} />
                    )}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    {c.city ? (
                      <span className="flex items-center gap-1 text-secondary text-xs">
                        <MapPin className="w-3 h-3" /> {c.city}
                      </span>
                    ) : (
                      <span className="text-secondary text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <div className="flex items-center gap-1 text-xs text-secondary">
                      <Calendar className="w-3 h-3" />
                      {fmtDate(c.start_date)} → {fmtDate(c.estimated_end_date)}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right hidden lg:table-cell">
                    <span className="font-semibold text-primary">{fmtMoney(c.budget_ht)}</span>
                  </td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <ActionMenu
                      status={c.status}
                      onReprendre={() => handleStatusChange(c, 'en_cours')}
                      onTerminer={() => handleStatusChange(c, 'termine')}
                      onSuspendre={() => handleStatusChange(c, 'suspendu')}
                      onAnnuler={() => handleStatusChange(c, 'annule')}
                      onDupliquer={() => handleDuplicate(c)}
                      onSupprimer={() => handleDelete(c)}
                      canDelete={canDelete}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateModal
          clients={clients}
          linkableQuotes={linkableQuotes}
          onClose={() => setShowCreate(false)}
          onCreated={id => { setShowCreate(false); router.push(`/chantiers/${id}`) }}
        />
      )}
    </div>
  )
}
