'use client'
// @atelier-migrated
// Réception du chantier : procès-verbal, réserves, retenue de garantie, décompte général définitif.

import { useState, useTransition } from 'react'
import { AlertDialog } from '@/components/ui/AlertDialog'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Sheet } from '@/components/ui/Sheet'
import { StatusPill, type StatusPillStatus } from '@/components/ui/StatusPill'
import type { Chantier, ChantierReserve } from '@/lib/data/queries/chantiers'
import { pronounceReception, upsertReserve, resolveReserve, deleteReserve } from '@/lib/data/mutations/chantiers'
import { DateRow } from '../FormRows'
import screen from '@/components/layout/Screen.module.css'
import styles from '../../finances/quote-editor/QuoteEditor.module.css'
import fiche from './ChantierFiche.module.css'

const NB = ' '

type Reception = NonNullable<Chantier['reception_status']>

const RECEPTION_PILL: Record<Reception, { label: string; status: StatusPillStatus }> = {
  sans_reserve: { label: 'Sans réserve', status: 'success' },
  avec_reserve: { label: 'Avec réserves', status: 'wait' },
  reserve_levee: { label: 'Réserves levées', status: 'success' },
}

export default function ReceptionSection({ chantier, reserves: initialReserves, canEdit }: {
  chantier: Chantier
  reserves: ChantierReserve[]
  canEdit: boolean
}) {
  const [, startTransition] = useTransition()
  const [pending, setPending] = useState(false)
  const [reserves, setReserves] = useState<ChantierReserve[]>(initialReserves)
  const [receptionStatus, setReceptionStatus] = useState(chantier.reception_status)
  const [receptionAt, setReceptionAt] = useState(chantier.reception_at?.slice(0, 10) ?? new Date().toISOString().slice(0, 10))
  const [receptionNotes, setReceptionNotes] = useState(chantier.reception_notes ?? '')
  const [receptionOpen, setReceptionOpen] = useState(false)
  const [pronounce, setPronounce] = useState<'sans_reserve' | 'avec_reserve'>('sans_reserve')
  const [newOpen, setNewOpen] = useState(false)
  const [newDesc, setNewDesc] = useState('')
  const [newLot, setNewLot] = useState('')
  const [reserveId, setReserveId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<ChantierReserve | null>(null)
  const [error, setError] = useState<string | null>(null)

  const openReserves = reserves.filter(r => r.status === 'ouverte')
  const retention = chantier.default_retention_pct ?? 0
  const released = receptionStatus === 'reserve_levee' || receptionStatus === 'sans_reserve'
  const selected = reserves.find(r => r.id === reserveId) ?? null

  async function handlePronounce() {
    setPending(true)
    const res = await pronounceReception(chantier.id, { status: pronounce, reception_at: receptionAt, notes: receptionNotes || null })
    setPending(false)
    if (res.error) { setError(res.error); return }
    setReceptionStatus(pronounce)
    setReceptionOpen(false)
  }

  async function handleAddReserve() {
    if (!newDesc.trim()) return
    setPending(true)
    const res = await upsertReserve(chantier.id, { description: newDesc.trim(), lot: newLot.trim() || null, position: reserves.length })
    setPending(false)
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
    setNewOpen(false)
  }

  function handleResolve(id: string) {
    startTransition(async () => {
      const res = await resolveReserve(id, chantier.id)
      if (res.error) { setError(res.error); return }
      setReserves(prev => prev.map(r => r.id === id ? { ...r, status: 'levee', resolved_at: new Date().toISOString() } : r))
      const stillOpen = reserves.filter(r => r.id !== id && r.status === 'ouverte')
      if (stillOpen.length === 0) setReceptionStatus('reserve_levee')
    })
  }

  function handleDelete(r: ChantierReserve) {
    startTransition(async () => {
      const res = await deleteReserve(r.id, chantier.id)
      if (res.error) { setError(res.error); return }
      setReserves(prev => prev.filter(x => x.id !== r.id))
    })
  }

  const pill = receptionStatus ? RECEPTION_PILL[receptionStatus] : null
  const pillNode = pill ? <StatusPill status={pill.status}>{pill.label}</StatusPill> : undefined
  const pvDescription = receptionStatus
    ? `PV du ${new Date(receptionAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`
    : 'Non prononcée'

  return (
    <>
      {error && <p className={screen.error} role="alert">{error}</p>}

      <ListGroup
        title="Réception"
        description={receptionStatus ? chantier.reception_notes ?? undefined : 'Le procès-verbal ouvre le décompte général et la libération de la retenue de garantie.'}
      >
        {canEdit ? (
          <ListRow title="Réception du chantier" description={pvDescription} trailing={pillNode} onClick={() => { setPronounce(receptionStatus === 'avec_reserve' ? 'avec_reserve' : 'sans_reserve'); setReceptionOpen(true) }} />
        ) : (
          <ListRow title="Réception du chantier" description={pvDescription} trailing={pillNode} />
        )}
      </ListGroup>

      {receptionStatus && (
        <>
          <ListGroup
            title={`Réserves${reserves.length ? ` · ${openReserves.length}${NB}ouverte${openReserves.length > 1 ? 's' : ''}` : ''}`}
            description={reserves.length === 0 ? 'Aucune réserve ouverte.' : undefined}
          >
            {reserves.map(r => (
              <ListRow
                key={r.id}
                title={r.description}
                description={[r.lot, r.status === 'ouverte' ? 'Ouverte' : `Levée${r.resolved_at ? ` le ${new Date(r.resolved_at).toLocaleDateString('fr-FR')}` : ''}`].filter(Boolean).join(' · ')}
                leading={
                  <button
                    type="button"
                    className={fiche.tick}
                    disabled={!canEdit || r.status !== 'ouverte'}
                    aria-label={r.status === 'ouverte' ? 'Marquer la réserve comme levée' : 'Réserve levée'}
                    onClick={() => handleResolve(r.id)}
                  >
                    <span className={fiche.tickDot} data-state={r.status === 'ouverte' ? 'a_faire' : 'termine'}>
                      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.2 8.3 3.1 3.1 6.5-6.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </span>
                  </button>
                }
                onClick={() => setReserveId(r.id)}
              />
            ))}
            {canEdit && <ListRow title="Ajouter une réserve" onClick={() => setNewOpen(true)} className={fiche.linkRow} />}
          </ListGroup>

          <ListGroup title="Clôture">
            {retention > 0 && (
              <ListRow
                title={`Retenue de garantie · ${retention}${NB}%`}
                description={released
                  ? 'Toutes les réserves sont levées. Créez une facture de libération de la retenue de garantie.'
                  : openReserves.length > 0
                    ? `${openReserves.length} réserve${openReserves.length > 1 ? 's' : ''} ouverte${openReserves.length > 1 ? 's' : ''}. Elle sera libérable à la levée de toutes les réserves.`
                    : 'Prononcez la réception pour gérer la libération de la retenue de garantie.'}
              />
            )}
            <ListRow
              title="Décompte général définitif"
              description="PDF : marché, avenants, situations et retenue de garantie"
              href={`/api/pdf/dgd/${chantier.id}`}
              target="_blank"
              rel="noopener noreferrer"
            />
          </ListGroup>
        </>
      )}

      {receptionOpen && (
        <Sheet
          open
          onOpenChange={o => { if (!o) setReceptionOpen(false) }}
          title="Réception du chantier"
          confirmLabel="Prononcer la réception"
          confirmLoading={pending}
          onConfirm={handlePronounce}
        >
          <div className={styles.stack}>
            <SegmentedControl
              fullWidth
              label="Réception"
              options={[{ value: 'sans_reserve', label: 'Sans réserve' }, { value: 'avec_reserve', label: 'Avec réserves' }]}
              value={pronounce}
              onChange={v => setPronounce(v as 'sans_reserve' | 'avec_reserve')}
            />
            <div className={styles.fields}>
              <DateRow label="Date du PV" value={receptionAt} onChange={setReceptionAt} />
            </div>
            <Field type="textarea" label="Notes et observations" placeholder="Conditions de réception, présents…" value={receptionNotes} onChange={e => setReceptionNotes(e.target.value)} />
          </div>
        </Sheet>
      )}

      {newOpen && (
        <Sheet
          open
          onOpenChange={o => { if (!o) setNewOpen(false) }}
          title="Nouvelle réserve"
          confirmLabel="Ajouter"
          confirmLoading={pending}
          confirmDisabled={!newDesc.trim()}
          onConfirm={handleAddReserve}
        >
          <div className={styles.stack}>
            <div className={styles.fields}>
              <Field type="text" label="Lot" placeholder="Peinture (facultatif)" value={newLot} onChange={e => setNewLot(e.target.value)} />
            </div>
            <Field type="textarea" label="Description" placeholder="Décrire la réserve…" value={newDesc} onChange={e => setNewDesc(e.target.value)} />
          </div>
        </Sheet>
      )}

      {selected && (
        <Sheet
          open
          onOpenChange={o => { if (!o) setReserveId(null) }}
          title="Réserve"
          description={[selected.lot ? `Lot : ${selected.lot}` : null, selected.status === 'ouverte' ? 'Ouverte' : 'Levée'].filter(Boolean).join(' · ')}
          confirmLabel={canEdit && selected.status === 'ouverte' ? 'Marquer comme levée' : undefined}
          onConfirm={canEdit && selected.status === 'ouverte' ? () => { handleResolve(selected.id); setReserveId(null) } : undefined}
          cancelLabel="Fermer"
        >
          <div className={styles.stack}>
            <p className={styles.requestText}>{selected.description}</p>
            {canEdit && (
              <ListGroup>
                <li className={styles.destructiveRow}>
                  <button type="button" onClick={() => { setDeleting(selected); setReserveId(null) }}>Supprimer la réserve</button>
                </li>
              </ListGroup>
            )}
          </div>
        </Sheet>
      )}

      <AlertDialog
        open={deleting !== null}
        onOpenChange={o => { if (!o) setDeleting(null) }}
        title="Supprimer cette réserve ?"
        description="La réserve sera retirée du procès-verbal."
        confirmLabel="Supprimer"
        onConfirm={() => { if (deleting) handleDelete(deleting); setDeleting(null) }}
      />
    </>
  )
}
