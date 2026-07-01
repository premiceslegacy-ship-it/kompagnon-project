'use client'

import { useState, useTransition } from 'react'
import { CheckCircle2, Circle, Plus, Trash2, AlertTriangle, FileText } from 'lucide-react'
import type { Chantier } from '@/lib/data/queries/chantiers'
import type { ChantierReserve } from '@/lib/data/queries/chantiers'
import { pronounceReception, upsertReserve, resolveReserve, deleteReserve } from '@/lib/data/mutations/chantiers'

type Props = {
  chantier: Chantier
  reserves: ChantierReserve[]
  canEdit: boolean
}

export default function ReceptionTab({ chantier, reserves: initialReserves, canEdit }: Props) {
  const [isPending, startTransition] = useTransition()
  const [reserves, setReserves] = useState<ChantierReserve[]>(initialReserves)
  const [receptionStatus, setReceptionStatus] = useState(chantier.reception_status)
  const [receptionAt, setReceptionAt] = useState(chantier.reception_at?.slice(0, 10) ?? new Date().toISOString().slice(0, 10))
  const [receptionNotes, setReceptionNotes] = useState(chantier.reception_notes ?? '')
  const [showReceptionForm, setShowReceptionForm] = useState(!chantier.reception_status)
  const [newDesc, setNewDesc] = useState('')
  const [newLot, setNewLot] = useState('')
  const [error, setError] = useState<string | null>(null)

  const openReserves = reserves.filter(r => r.status === 'ouverte')
  const closedReserves = reserves.filter(r => r.status === 'levee')

  function handlePronounce(status: 'sans_reserve' | 'avec_reserve') {
    startTransition(async () => {
      const res = await pronounceReception(chantier.id, {
        status,
        reception_at: receptionAt,
        notes: receptionNotes || null,
      })
      if (res.error) { setError(res.error); return }
      setReceptionStatus(status)
      setShowReceptionForm(false)
    })
  }

  function handleAddReserve() {
    if (!newDesc.trim()) return
    startTransition(async () => {
      const res = await upsertReserve(chantier.id, {
        description: newDesc.trim(),
        lot: newLot.trim() || null,
        position: reserves.length,
      })
      if (res.error) { setError(res.error); return }
      setReserves(prev => [...prev, {
        id: res.reserveId!,
        chantier_id: chantier.id,
        description: newDesc.trim(),
        lot: newLot.trim() || null,
        status: 'ouverte',
        resolved_at: null,
        resolved_notes: null,
        position: prev.length,
        created_at: new Date().toISOString(),
      }])
      setNewDesc('')
      setNewLot('')
    })
  }

  function handleResolve(reserveId: string) {
    startTransition(async () => {
      const res = await resolveReserve(reserveId, chantier.id)
      if (res.error) { setError(res.error); return }
      setReserves(prev => prev.map(r => r.id === reserveId
        ? { ...r, status: 'levee', resolved_at: new Date().toISOString() }
        : r
      ))
      const stillOpen = reserves.filter(r => r.id !== reserveId && r.status === 'ouverte')
      if (stillOpen.length === 0) setReceptionStatus('reserve_levee')
    })
  }

  function handleDelete(reserveId: string) {
    startTransition(async () => {
      const res = await deleteReserve(reserveId, chantier.id)
      if (res.error) { setError(res.error); return }
      setReserves(prev => prev.filter(r => r.id !== reserveId))
    })
  }

  const statusLabel = receptionStatus === 'sans_reserve'
    ? 'Réceptionnée sans réserve'
    : receptionStatus === 'avec_reserve'
    ? 'Réceptionnée avec réserves'
    : receptionStatus === 'reserve_levee'
    ? 'Réserves levées — RG libérable'
    : null

  const statusColor = receptionStatus === 'sans_reserve' || receptionStatus === 'reserve_levee'
    ? 'text-green-500'
    : 'text-amber-500'

  return (
    <div className="space-y-6 pb-10">

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-500 bg-red-500/10 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* ── Statut réception ── */}
      <div className="bg-[var(--elevation-1)] border border-[var(--elevation-border)] rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-primary">Réception de chantier</p>
          {statusLabel && (
            <span className={`text-xs font-semibold ${statusColor}`}>{statusLabel}</span>
          )}
        </div>

        {receptionStatus && !showReceptionForm ? (
          <div className="space-y-1">
            {chantier.reception_at && (
              <p className="text-xs text-secondary">
                PV prononcé le {new Date(chantier.reception_at).toLocaleDateString('fr-FR')}
              </p>
            )}
            {chantier.reception_notes && (
              <p className="text-xs text-secondary">{chantier.reception_notes}</p>
            )}
            {canEdit && (
              <button onClick={() => setShowReceptionForm(true)} className="text-xs text-accent hover:underline mt-1">
                Modifier
              </button>
            )}
          </div>
        ) : canEdit ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-secondary">Date du PV</label>
              <input
                type="date"
                value={receptionAt}
                onChange={e => setReceptionAt(e.target.value)}
                className="w-full text-sm bg-[var(--elevation-2)] border border-[var(--elevation-border)] rounded-lg px-3 py-2 text-primary"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-secondary">Notes / observations (optionnel)</label>
              <textarea
                value={receptionNotes}
                onChange={e => setReceptionNotes(e.target.value)}
                rows={2}
                className="w-full text-sm bg-[var(--elevation-2)] border border-[var(--elevation-border)] rounded-lg px-3 py-2 text-primary resize-none"
                placeholder="Conditions de réception, présents..."
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handlePronounce('sans_reserve')}
                disabled={isPending}
                className="flex-1 text-sm font-medium bg-green-500/10 text-green-500 border border-green-500/20 rounded-lg px-3 py-2 hover:bg-green-500/20 transition-colors disabled:opacity-50"
              >
                Sans réserve
              </button>
              <button
                onClick={() => handlePronounce('avec_reserve')}
                disabled={isPending}
                className="flex-1 text-sm font-medium bg-amber-500/10 text-amber-500 border border-amber-500/20 rounded-lg px-3 py-2 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
              >
                Avec réserves
              </button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-secondary">Réception non prononcée.</p>
        )}
      </div>

      {/* ── DGD ── */}
      {receptionStatus && (
        <div className="flex items-center justify-between bg-[var(--elevation-1)] border border-[var(--elevation-border)] rounded-xl px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-primary">Décompte Général Définitif</p>
            <p className="text-xs text-secondary mt-0.5">PDF récapitulatif — marché + avenants + situations + RG</p>
          </div>
          <a
            href={`/api/pdf/dgd/${chantier.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm font-medium text-accent border border-accent rounded-lg px-3 py-1.5 hover:bg-accent/10 transition-colors"
          >
            <FileText className="w-4 h-4" />
            Générer
          </a>
        </div>
      )}

      {/* ── Retenue de garantie ── */}
      {(chantier.default_retention_pct ?? 0) > 0 && (
        <div className={`rounded-xl border px-4 py-3 space-y-1 ${receptionStatus === 'reserve_levee' || receptionStatus === 'sans_reserve' ? 'border-green-500/30 bg-green-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
          <p className="text-xs font-semibold text-primary">
            Retenue de garantie — {chantier.default_retention_pct}%
          </p>
          <p className="text-xs text-secondary">
            {receptionStatus === 'reserve_levee' || receptionStatus === 'sans_reserve'
              ? 'Toutes les réserves sont levées. La RG peut être libérée : créez une facture de libération de retenue de garantie.'
              : openReserves.length > 0
              ? `${openReserves.length} réserve${openReserves.length > 1 ? 's' : ''} ouverte${openReserves.length > 1 ? 's' : ''}. La RG sera libérable à la levée totale des réserves.`
              : 'Prononcez la réception pour gérer la libération de la RG.'}
          </p>
        </div>
      )}

      {/* ── Réserves ouvertes ── */}
      <div className="space-y-3">
        <p className="text-xs font-bold text-secondary uppercase tracking-wider">
          Réserves ouvertes {openReserves.length > 0 && `(${openReserves.length})`}
        </p>

        {openReserves.length === 0 && (
          <p className="text-sm text-secondary">Aucune réserve ouverte.</p>
        )}

        {openReserves.map(r => (
          <div key={r.id} className="flex items-start gap-3 bg-[var(--elevation-1)] border border-[var(--elevation-border)] rounded-xl px-4 py-3">
            <button
              onClick={() => handleResolve(r.id)}
              disabled={!canEdit || isPending}
              className="mt-0.5 text-secondary hover:text-green-500 transition-colors disabled:opacity-40 shrink-0"
              title="Marquer comme levée"
              aria-label="Marquer la réserve comme levée"
            >
              <Circle className="w-4 h-4" />
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-primary">{r.description}</p>
              {r.lot && <p className="text-xs text-secondary mt-0.5">Lot : {r.lot}</p>}
            </div>
            {canEdit && (
              <button
                onClick={() => handleDelete(r.id)}
                disabled={isPending}
                className="text-secondary hover:text-red-500 transition-colors disabled:opacity-40 shrink-0"
                title="Supprimer la réserve"
                aria-label="Supprimer la réserve"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}

        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <input
              value={newLot}
              onChange={e => setNewLot(e.target.value)}
              placeholder="Lot (optionnel)"
              className="w-full sm:w-28 text-sm bg-[var(--elevation-1)] border border-[var(--elevation-border)] rounded-lg px-3 py-2 text-primary placeholder:text-secondary"
            />
            <input
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAddReserve() }}
              placeholder="Décrire la réserve..."
              className="flex-1 text-sm bg-[var(--elevation-1)] border border-[var(--elevation-border)] rounded-lg px-3 py-2 text-primary placeholder:text-secondary"
            />
            <button
              onClick={handleAddReserve}
              disabled={!newDesc.trim() || isPending}
              className="text-accent border border-accent rounded-lg px-3 py-2 hover:bg-accent/10 transition-colors disabled:opacity-40"
              title="Ajouter la réserve"
              aria-label="Ajouter la réserve"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* ── Réserves levées ── */}
      {closedReserves.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-bold text-secondary uppercase tracking-wider">
            Réserves levées ({closedReserves.length})
          </p>
          {closedReserves.map(r => (
            <div key={r.id} className="flex items-start gap-3 opacity-60">
              <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-primary line-through">{r.description}</p>
                {r.lot && <p className="text-xs text-secondary">Lot : {r.lot}</p>}
                {r.resolved_at && (
                  <p className="text-xs text-secondary">
                    Levée le {new Date(r.resolved_at).toLocaleDateString('fr-FR')}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

    </div>
  )
}
