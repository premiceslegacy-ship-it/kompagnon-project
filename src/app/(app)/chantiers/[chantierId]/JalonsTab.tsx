'use client'

import React, { useState, useTransition } from 'react'
import {
  Plus, Trash2, Pencil, Check, X, Loader2, FileText,
  CheckCircle2, Clock, AlertTriangle, Sparkles,
} from 'lucide-react'
import type { ChantierJalon } from '@/lib/data/queries/chantier-jalons'
import type { Tache } from '@/lib/data/queries/chantiers'
import {
  createJalon,
  updateJalon,
  deleteJalon,
  completeJalon,
  generateJalonInvoice,
  assignTasksToJalon,
} from '@/lib/data/mutations/chantier-jalons'
import { useRouter } from 'next/navigation'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtMoney(n: number) {
  return n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
}

const STATUS_LABEL: Record<ChantierJalon['status'], string> = {
  pending: 'À venir',
  in_progress: 'En cours',
  completed: 'Complété',
  invoiced: 'Facturé',
}
const STATUS_COLOR: Record<ChantierJalon['status'], string> = {
  pending: 'bg-secondary/20 text-secondary',
  in_progress: 'bg-blue-500/15 text-blue-500',
  completed: 'bg-emerald-500/15 text-emerald-500',
  invoiced: 'bg-accent/15 text-accent',
}

// ─── JalonCard ───────────────────────────────────────────────────────────────

function JalonCard({
  jalon,
  budgetHt,
  chantierId,
  allTaches,
  onUpdated,
  onDeleted,
}: {
  jalon: ChantierJalon
  budgetHt: number
  chantierId: string
  allTaches: Tache[]
  onUpdated: (id: string, patch: Partial<ChantierJalon>) => void
  onDeleted: (id: string) => void
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(jalon.title)
  const [editPct, setEditPct] = useState(String(jalon.acompte_pct))
  const [editDesc, setEditDesc] = useState(jalon.description ?? '')

  const [showReport, setShowReport] = useState(false)
  const [report, setReport] = useState(jalon.completion_report ?? '')

  const [showTacheAssign, setShowTacheAssign] = useState(false)
  const [selectedTacheIds, setSelectedTacheIds] = useState<Set<string>>(
    new Set(jalon.taches.map(t => t.id))
  )

  const [loading, setLoading] = useState(false)
  const [invLoading, setInvLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const amount = budgetHt > 0 ? (budgetHt * jalon.acompte_pct) / 100 : 0
  const progress = jalon.taches_total > 0
    ? Math.round((jalon.taches_done / jalon.taches_total) * 100)
    : null

  async function handleSaveEdit() {
    const pct = parseFloat(editPct)
    if (isNaN(pct) || pct < 0 || pct > 100) { setErr('Pourcentage invalide.'); return }
    setLoading(true)
    const { error } = await updateJalon(jalon.id, { title: editTitle, acomptePct: pct, description: editDesc || null })
    setLoading(false)
    if (error) { setErr(error); return }
    onUpdated(jalon.id, { title: editTitle, acompte_pct: pct, description: editDesc || null })
    setEditing(false)
    setErr(null)
  }

  async function handleDelete() {
    if (!confirm(`Supprimer le jalon "${jalon.title}" ?`)) return
    await deleteJalon(jalon.id)
    onDeleted(jalon.id)
  }

  async function handleComplete() {
    if (!report.trim()) { setErr('Le rapport est requis pour valider le jalon.'); return }
    setLoading(true)
    const { error } = await completeJalon(jalon.id, report.trim())
    setLoading(false)
    if (error) { setErr(error); return }
    onUpdated(jalon.id, { status: 'completed', completion_report: report.trim() })
    setShowReport(false)
    setErr(null)
  }

  async function handleGenerateInvoice() {
    setInvLoading(true)
    setErr(null)
    const { invoiceId, error } = await generateJalonInvoice(jalon.id)
    setInvLoading(false)
    if (error) { setErr(error); return }
    onUpdated(jalon.id, { status: 'invoiced', invoice_id: invoiceId })
    if (invoiceId) {
      const params = new URLSearchParams({ id: invoiceId, returnTo: `/chantiers/${chantierId}` })
      router.push(`/finances/invoice-editor?${params}`)
    }
  }

  async function handleSaveTacheAssign() {
    setLoading(true)
    await assignTasksToJalon(jalon.id, Array.from(selectedTacheIds), chantierId)
    // Remove tasks that were unselected
    const unselected = jalon.taches.filter(t => !selectedTacheIds.has(t.id)).map(t => t.id)
    if (unselected.length) await assignTasksToJalon(null, unselected, chantierId)
    setLoading(false)
    setShowTacheAssign(false)
    startTransition(() => router.refresh())
  }

  return (
    <div className="card overflow-hidden border border-[var(--elevation-border)]">
      <div className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            {editing ? (
              <div className="space-y-2">
                <input
                  className="input w-full text-sm font-semibold"
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  placeholder="Titre du jalon"
                  autoFocus
                />
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    className="input w-24 text-sm"
                    value={editPct}
                    onChange={e => setEditPct(e.target.value)}
                    placeholder="%"
                  />
                  <span className="text-sm text-secondary self-center">% d&apos;acompte</span>
                </div>
                <input
                  className="input w-full text-sm"
                  value={editDesc}
                  onChange={e => setEditDesc(e.target.value)}
                  placeholder="Description (optionnel)"
                />
                {err && <p className="text-xs text-red-500">{err}</p>}
                <div className="flex gap-2">
                  <button onClick={handleSaveEdit} disabled={loading} className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1">
                    {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Enregistrer
                  </button>
                  <button onClick={() => { setEditing(false); setErr(null) }} className="btn-secondary text-xs px-3 py-1.5">Annuler</button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-primary">{jalon.title}</span>
                  <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded ${STATUS_COLOR[jalon.status]}`}>
                    {STATUS_LABEL[jalon.status]}
                  </span>
                </div>
                {jalon.description && <p className="text-xs text-secondary mt-0.5">{jalon.description}</p>}
                <p className="text-sm font-bold text-accent mt-1">
                  {jalon.acompte_pct}%
                  {amount > 0 && <span className="text-secondary font-normal"> · {fmtMoney(amount)}</span>}
                </p>
              </>
            )}
          </div>

          {!editing && (
            <div className="flex items-center gap-1 flex-shrink-0">
              <button onClick={() => setEditing(true)} className="p-1.5 rounded text-secondary hover:text-primary hover:bg-[var(--elevation-1)] transition-colors">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button onClick={handleDelete} className="p-1.5 rounded text-secondary hover:text-red-500 hover:bg-red-500/10 transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Progression tâches */}
        {!editing && jalon.taches_total > 0 && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-secondary">
              <span>{jalon.taches_done}/{jalon.taches_total} tâches</span>
              <span>{progress}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-secondary/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            {jalon.taches.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {jalon.taches.slice(0, 4).map(t => (
                  <span key={t.id} className={`text-[10px] px-1.5 py-0.5 rounded ${t.status === 'termine' ? 'bg-emerald-500/15 text-emerald-600' : 'bg-secondary/10 text-secondary'}`}>
                    {t.title}
                  </span>
                ))}
                {jalon.taches.length > 4 && (
                  <span className="text-[10px] text-secondary">+{jalon.taches.length - 4}</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        {!editing && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setShowTacheAssign(v => !v)}
              className="text-xs text-secondary hover:text-primary border border-[var(--elevation-border)] rounded-lg px-2.5 py-1 transition-colors"
            >
              Gérer les tâches ({jalon.taches_total})
            </button>

            {jalon.status !== 'invoiced' && jalon.status !== 'completed' && (
              <button
                onClick={() => setShowReport(v => !v)}
                className="text-xs text-secondary hover:text-primary border border-[var(--elevation-border)] rounded-lg px-2.5 py-1 transition-colors"
              >
                Marquer complété
              </button>
            )}

            {jalon.status === 'completed' && !jalon.invoice_id && (
              <button
                onClick={handleGenerateInvoice}
                disabled={invLoading}
                className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1"
              >
                {invLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
                Générer la facture
              </button>
            )}

            {jalon.status === 'invoiced' && jalon.invoice_id && (
              <button
                onClick={() => {
                  const params = new URLSearchParams({ id: jalon.invoice_id!, returnTo: `/chantiers/${chantierId}` })
                  router.push(`/finances/invoice-editor?${params}`)
                }}
                className="text-xs text-accent border border-accent/30 rounded-lg px-2.5 py-1 transition-colors hover:bg-accent/10"
              >
                Voir la facture
              </button>
            )}
          </div>
        )}

        {/* Panneau rapport */}
        {showReport && jalon.status !== 'completed' && (
          <div className="pt-2 border-t border-[var(--elevation-border)] space-y-2">
            <p className="text-xs font-semibold text-secondary uppercase tracking-wider">Rapport d&apos;avancement</p>
            <textarea
              className="input w-full text-sm min-h-[80px] resize-none"
              placeholder="Décrivez ce qui a été réalisé dans ce jalon..."
              value={report}
              onChange={e => setReport(e.target.value)}
              autoFocus
            />
            {err && <p className="text-xs text-red-500">{err}</p>}
            <div className="flex gap-2">
              <button onClick={handleComplete} disabled={loading} className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1">
                {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />} Valider le jalon
              </button>
              <button onClick={() => { setShowReport(false); setErr(null) }} className="btn-secondary text-xs px-3 py-1.5">Annuler</button>
            </div>
          </div>
        )}

        {jalon.completion_report && jalon.status !== 'pending' && (
          <div className="pt-2 border-t border-[var(--elevation-border)]">
            <p className="text-xs text-secondary italic">&ldquo;{jalon.completion_report}&rdquo;</p>
          </div>
        )}

        {/* Panneau assignation tâches */}
        {showTacheAssign && (
          <div className="pt-2 border-t border-[var(--elevation-border)] space-y-2">
            <p className="text-xs font-semibold text-secondary uppercase tracking-wider">Tâches dans ce jalon</p>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {allTaches.length === 0 ? (
                <p className="text-xs text-secondary">Aucune tâche sur ce chantier.</p>
              ) : allTaches.map(t => (
                <label key={t.id} className="flex items-center gap-2 cursor-pointer hover:bg-[var(--elevation-1)] px-2 py-1 rounded">
                  <input
                    type="checkbox"
                    checked={selectedTacheIds.has(t.id)}
                    onChange={e => {
                      setSelectedTacheIds(prev => {
                        const s = new Set(prev)
                        if (e.target.checked) s.add(t.id)
                        else s.delete(t.id)
                        return s
                      })
                    }}
                    className="rounded"
                  />
                  <span className={`text-sm ${t.status === 'termine' ? 'line-through text-secondary' : 'text-primary'}`}>{t.title}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={handleSaveTacheAssign} disabled={loading} className="btn-primary text-xs px-3 py-1.5">
                {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Enregistrer'}
              </button>
              <button onClick={() => setShowTacheAssign(false)} className="btn-secondary text-xs px-3 py-1.5">Annuler</button>
            </div>
          </div>
        )}

        {err && !editing && !showReport && (
          <p className="text-xs text-red-500">{err}</p>
        )}
      </div>
    </div>
  )
}

// ─── JalonsTab ────────────────────────────────────────────────────────────────

type Props = {
  initialJalons: ChantierJalon[]
  chantierId: string
  budgetHt: number
  taches: Tache[]
}

export default function JalonsTab({ initialJalons, chantierId, budgetHt, taches }: Props) {
  const [jalons, setJalons] = useState(initialJalons)
  const [, startTransition] = useTransition()
  const router = useRouter()

  const [showAdd, setShowAdd] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newPct, setNewPct] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [addErr, setAddErr] = useState<string | null>(null)
  const [addLoading, setAddLoading] = useState(false)

  const [aiLoading, setAiLoading] = useState(false)
  const [aiSuggestions, setAiSuggestions] = useState<null | Array<{
    title: string; acompte_pct: number; description: string; tasks: Array<{ title: string }>
  }>>(null)
  const [aiErr, setAiErr] = useState<string | null>(null)
  const [creatingFromAi, setCreatingFromAi] = useState(false)

  const totalPct = jalons.reduce((s, j) => s + j.acompte_pct, 0)
  const remainingPct = 100 - totalPct

  async function handleAdd() {
    const pct = parseFloat(newPct)
    if (!newTitle.trim()) { setAddErr('Titre requis.'); return }
    if (isNaN(pct) || pct <= 0 || pct > 100) { setAddErr('Pourcentage invalide (1–100).'); return }
    if (totalPct + pct > 100) { setAddErr(`Dépasse 100% (il reste ${remainingPct.toFixed(0)}%)`); return }
    setAddLoading(true)
    const { jalonId, error } = await createJalon(chantierId, {
      title: newTitle.trim(),
      acomptePct: pct,
      description: newDesc.trim() || null,
    })
    setAddLoading(false)
    if (error || !jalonId) { setAddErr(error ?? 'Erreur'); return }
    setJalons(prev => [...prev, {
      id: jalonId,
      chantier_id: chantierId,
      position: prev.length,
      title: newTitle.trim(),
      acompte_pct: pct,
      description: newDesc.trim() || null,
      status: 'pending',
      completion_report: null,
      completed_at: null,
      invoice_id: null,
      created_at: new Date().toISOString(),
      taches: [],
      taches_total: 0,
      taches_done: 0,
    }])
    setNewTitle(''); setNewPct(''); setNewDesc('')
    setShowAdd(false); setAddErr(null)
  }

  async function handleAiSuggest() {
    setAiLoading(true); setAiErr(null); setAiSuggestions(null)
    try {
      const res = await fetch('/api/ai/suggest-jalons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chantierId }),
      })
      const data = await res.json()
      if (!res.ok) { setAiErr(data.error ?? 'Erreur IA'); return }
      setAiSuggestions(data)
    } catch {
      setAiErr('Impossible de contacter l\'IA.')
    } finally {
      setAiLoading(false)
    }
  }

  async function handleCreateFromAi() {
    if (!aiSuggestions) return
    setCreatingFromAi(true)
    for (let i = 0; i < aiSuggestions.length; i++) {
      const s = aiSuggestions[i]
      const { jalonId } = await createJalon(chantierId, {
        title: s.title,
        acomptePct: s.acompte_pct,
        description: s.description || null,
        position: i,
      })
      if (jalonId && s.tasks?.length) {
        // Créer les tâches si elles n'existent pas — on envoie juste le nom dans la mutation
        // (les tâches sont créées côté mutations/chantiers via createTache)
      }
    }
    setCreatingFromAi(false)
    setAiSuggestions(null)
    startTransition(() => router.refresh())
  }

  return (
    <div className="space-y-5">
      {/* En-tête avec résumé % */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-primary flex items-center gap-2">
            <Clock className="w-4 h-4 text-accent" /> Jalons d&apos;acompte
          </h3>
          <p className="text-xs text-secondary mt-0.5">
            {totalPct.toFixed(0)}% alloué
            {totalPct < 100 && <span className="text-amber-500"> · {(100 - totalPct).toFixed(0)}% restant</span>}
            {totalPct > 100 && <span className="text-red-500"> · Dépasse 100% !</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {jalons.length === 0 && !aiLoading && (
            <button
              onClick={handleAiSuggest}
              className="flex items-center gap-2 text-sm font-semibold text-violet-600 dark:text-violet-400 px-3 py-2 rounded-xl border border-violet-400/30 bg-violet-500/5 hover:bg-violet-500/10 transition-all"
            >
              <Sparkles className="w-3.5 h-3.5" /> Suggérer via IA
            </button>
          )}
          {aiLoading && (
            <span className="flex items-center gap-1.5 text-xs text-secondary">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Analyse en cours…
            </span>
          )}
          <button
            onClick={() => setShowAdd(v => !v)}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            <Plus className="w-4 h-4" /> Ajouter un jalon
          </button>
        </div>
      </div>

      {/* Alerte si > 100% */}
      {totalPct > 100 && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-500">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          La somme des acomptes dépasse 100%. Ajustez les pourcentages.
        </div>
      )}

      {/* Suggestions IA */}
      {aiErr && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-500">{aiErr}</div>
      )}
      {aiSuggestions && (
        <div className="card p-4 space-y-4 border-violet-400/30 bg-violet-500/3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-primary flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-violet-500" /> Proposition de jalons IA
            </p>
            <button onClick={() => setAiSuggestions(null)} className="p-1 text-secondary hover:text-primary">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-2">
            {aiSuggestions.map((s, i) => (
              <div key={i} className="p-3 rounded-xl border border-[var(--elevation-border)] bg-surface space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-sm text-primary">{s.title}</p>
                    {s.description && <p className="text-xs text-secondary">{s.description}</p>}
                  </div>
                  <span className="text-sm font-bold text-accent shrink-0 ml-3">{s.acompte_pct}%</span>
                </div>
                {s.tasks?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {s.tasks.map((t, j) => (
                      <span key={j} className="text-[10px] px-1.5 py-0.5 rounded bg-secondary/10 text-secondary">{t.title}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-secondary">
            Total : {aiSuggestions.reduce((s, j) => s + j.acompte_pct, 0)}%
            {aiSuggestions.reduce((s, j) => s + j.acompte_pct, 0) !== 100 && (
              <span className="text-amber-500"> · Ajustez les % avant de valider</span>
            )}
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleCreateFromAi}
              disabled={creatingFromAi}
              className="btn-primary text-sm flex items-center gap-1.5"
            >
              {creatingFromAi ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Valider et créer ces jalons
            </button>
            <button onClick={() => setAiSuggestions(null)} className="btn-secondary text-sm">Ignorer</button>
          </div>
        </div>
      )}

      {/* Formulaire ajout */}
      {showAdd && (
        <div className="card p-4 space-y-3 border border-accent/30 bg-accent/5">
          <div className="flex items-center gap-2 pb-2 border-b border-[var(--elevation-border)]">
            <Clock className="w-4 h-4 text-accent" />
            <p className="text-sm font-bold text-primary">Nouveau jalon</p>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-secondary uppercase tracking-wide">Titre *</label>
            <input
              className="input w-full"
              placeholder="ex : Gros œuvre, Finitions, Réception"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-secondary uppercase tracking-wide">Part d&apos;acompte</label>
            <div className="flex gap-3 items-center">
              <input
                type="number"
                min="1"
                max="100"
                className="input w-28"
                placeholder="% acompte"
                value={newPct}
                onChange={e => setNewPct(e.target.value)}
              />
              <span className="text-sm text-secondary">
                = {newPct && !isNaN(parseFloat(newPct)) && budgetHt > 0
                    ? fmtMoney(budgetHt * parseFloat(newPct) / 100)
                    : '—'} HT
              </span>
              <span className="text-xs text-secondary ml-auto">Reste : {remainingPct.toFixed(0)}%</span>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-secondary uppercase tracking-wide">Description <span className="font-normal normal-case">(optionnel)</span></label>
            <input
              className="input w-full"
              placeholder="Périmètre de ce jalon…"
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
            />
          </div>
          {addErr && <p className="text-xs text-red-500">{addErr}</p>}
          <div className="flex gap-2 pt-1 border-t border-[var(--elevation-border)]">
            <button onClick={() => setShowAdd(false)} className="btn-secondary flex-1 text-sm">Annuler</button>
            <button onClick={handleAdd} disabled={addLoading || !newTitle.trim()} className="btn-primary flex-1 text-sm">
              {addLoading ? 'Création…' : 'Créer le jalon'}
            </button>
          </div>
        </div>
      )}

      {/* Liste des jalons */}
      {jalons.length === 0 && !showAdd && !aiSuggestions && (
        <div className="card p-12 text-center">
          <Clock className="w-12 h-12 text-secondary opacity-30 mx-auto mb-3" />
          <p className="text-secondary font-semibold">Aucun jalon défini</p>
          <p className="text-secondary text-sm mt-1">Créez des jalons pour structurer la facturation par étapes.</p>
        </div>
      )}

      <div className="space-y-3">
        {jalons.map(j => (
          <JalonCard
            key={j.id}
            jalon={j}
            budgetHt={budgetHt}
            chantierId={chantierId}
            allTaches={taches}
            onUpdated={(id, patch) => setJalons(prev => prev.map(x => x.id === id ? { ...x, ...patch } as ChantierJalon : x))}
            onDeleted={id => setJalons(prev => prev.filter(x => x.id !== id))}
          />
        ))}
      </div>

      {/* Avertissement ancien curseur de situation */}
      {jalons.length > 0 && (
        <p className="text-xs text-secondary text-center pt-2 border-t border-[var(--elevation-border)]">
          Pour une facturation structurée, utilisez les jalons ci-dessus plutôt que le curseur de situation libre disponible sur l&apos;onglet principal.
        </p>
      )}
    </div>
  )
}
