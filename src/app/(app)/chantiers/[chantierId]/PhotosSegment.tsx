'use client'
// @atelier-migrated
// Segment Photos : grille, sélection pour envoi au client, titre et légende, rapport PDF.

import { useRef, useState } from 'react'
import { Camera, Check } from 'lucide-react'
import { AlertDialog } from '@/components/ui/AlertDialog'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Sheet } from '@/components/ui/Sheet'
import { Switch } from '@/components/ui/Switch'
import type { ChantierPhoto } from '@/lib/data/queries/chantiers'
import { togglePhotoReportFlag, updateChantierPhotoCaption, updateChantierPhotoTitle } from '@/lib/data/mutations/chantiers'
import type { ChantierDetailState } from './useChantierDetail'
import screen from '@/components/layout/Screen.module.css'
import styles from '../../finances/quote-editor/QuoteEditor.module.css'
import fiche from './ChantierFiche.module.css'

const NB = ' '

/** Titre, légende et inclusion au rapport PDF d'une photo. */
function PhotoSheet({ q, photoId, onClose, onDelete }: {
  q: ChantierDetailState
  photoId: string
  onClose: () => void
  onDelete: (photo: ChantierPhoto) => void
}) {
  const photo = q.photos.find(p => p.id === photoId)
  const [title, setTitle] = useState(photo?.title ?? '')
  const [caption, setCaption] = useState(photo?.caption ?? '')
  const [saving, setSaving] = useState(false)
  if (!photo) return null

  const save = async () => {
    setSaving(true)
    await Promise.all([
      updateChantierPhotoTitle(photo.id, q.chantier.id, title || null),
      updateChantierPhotoCaption(photo.id, q.chantier.id, caption || null),
    ])
    q.setPhotos(prev => prev.map(p => p.id === photo.id ? { ...p, title: title || null, caption: caption || null } : p))
    setSaving(false)
    onClose()
  }

  const setReport = async (value: boolean) => {
    await togglePhotoReportFlag(photo.id, q.chantier.id, value)
    q.setPhotos(prev => prev.map(p => p.id === photo.id ? { ...p, include_in_report: value } : p))
  }

  return (
    <Sheet open onOpenChange={o => { if (!o) onClose() }} title="Photo" confirmLabel="Enregistrer" confirmLoading={saving} onConfirm={save}
      description={`Par ${photo.uploaded_by_name}${photo.taken_at ? ` · ${new Date(photo.taken_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}`}>
      <div className={styles.stack}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={fiche.photoView} src={photo.url ?? ''} alt={photo.caption ?? 'Photo du chantier'} />
        <div className={styles.fields}>
          <Field type="text" label="Titre" placeholder="Affiché dans le rapport PDF" value={title} onChange={e => setTitle(e.target.value)} />
          <Field type="text" label="Description" value={caption} onChange={e => setCaption(e.target.value)} />
        </div>
        <ListGroup description={photo.shared_with_client_at ? `Envoyée au client le ${new Date(photo.shared_with_client_at).toLocaleDateString('fr-FR')}.` : undefined}>
          <ListRow title="Inclure dans le rapport PDF" trailing={<Switch label="Inclure dans le rapport PDF" checked={photo.include_in_report} onChange={setReport} />} />
          <li className={styles.destructiveRow}>
            <button type="button" onClick={() => onDelete(photo)}>Supprimer la photo</button>
          </li>
        </ListGroup>
      </div>
    </Sheet>
  )
}

export default function PhotosSegment({ q }: { q: ChantierDetailState }) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selecting, setSelecting] = useState(false)
  const [photoId, setPhotoId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<ChantierPhoto | null>(null)
  const n = q.selectedPhotoIds.size

  const toggle = (id: string) => q.setSelectedPhotoIds(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  return (
    <>
      <input
        ref={fileInputRef}
        className={fiche.fileInput}
        type="file"
        accept="image/*"
        tabIndex={-1}
        aria-label="Ajouter une photo"
        onChange={e => q.handlePhotoUpload(e)}
      />
      {q.photos.length === 0 ? (
        <EmptyState
          title="Aucune photo pour l’instant"
          description="Ajoutez des photos pour documenter l’avancement du chantier."
          actionLabel="Ajouter une photo"
          onAction={() => fileInputRef.current?.click()}
        />
      ) : (
        <ListGroup
          title={`${q.photos.length}${NB}photo${q.photos.length > 1 ? 's' : ''}`}
          action={
            <Button size="sm" variant="text" onClick={() => { setSelecting(v => !v); q.setSelectedPhotoIds(new Set()) }}>
              {selecting ? 'Terminé' : 'Sélectionner'}
            </Button>
          }
          description={selecting ? undefined : 'Touchez une photo pour lui donner un titre et choisir si elle figure dans le rapport PDF.'}
        >
          <li style={{ listStyle: 'none', padding: 4 }}>
            <div className={fiche.photos}>
              {q.photos.map(photo => {
                const selected = q.selectedPhotoIds.has(photo.id)
                return (
                  <button
                    key={photo.id}
                    type="button"
                    className={fiche.photo}
                    data-selected={selected}
                    aria-pressed={selecting ? selected : undefined}
                    aria-label={`Photo : ${photo.title || photo.caption || 'sans titre'}`}
                    onClick={() => (selecting ? toggle(photo.id) : setPhotoId(photo.id))}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photo.url ?? ''} alt="" />
                    {selecting && <span className={fiche.photoCheck}>{selected && <Check size={14} aria-hidden="true" />}</span>}
                    {!selecting && photo.include_in_report && <span className={fiche.photoBadge}>PDF</span>}
                    {!selecting && photo.shared_with_client_at && <span className={fiche.photoCheck}><Check size={14} aria-hidden="true" /></span>}
                  </button>
                )
              })}
            </div>
          </li>
          {!selecting && (
            <ListRow
              title={q.photoLoading ? 'Envoi en cours…' : 'Ajouter une photo'}
              className={fiche.linkRow}
              leading={<Camera size={18} aria-hidden="true" />}
              disabled={q.photoLoading}
              onClick={() => fileInputRef.current?.click()}
            />
          )}
        </ListGroup>
      )}
      {q.photoError && <p className={screen.error} role="alert">{q.photoError}</p>}

      {selecting && (
        <div className={styles.stack} style={{ marginTop: 16 }}>
          <Button
            size="lg"
            disabled={n === 0}
            onClick={() => { q.setShowSendPhotosPanel(true); q.setPhotosEmailStatus('idle') }}
          >
            {n ? `Envoyer ${n} photo${n > 1 ? 's' : ''} au client` : 'Choisissez des photos'}
          </Button>
        </div>
      )}

      {photoId && <PhotoSheet q={q} photoId={photoId} onClose={() => setPhotoId(null)} onDelete={p => { setPhotoId(null); setDeleting(p) }} />}

      {q.showSendPhotosPanel && (
        <Sheet
          open
          onOpenChange={o => { if (!o) q.setShowSendPhotosPanel(false) }}
          title={`Envoyer ${n} photo${n > 1 ? 's' : ''}`}
          description="Le client reçoit les photos par email."
          confirmLabel={q.photosEmailStatus === 'done' ? 'Fermer' : 'Envoyer'}
          confirmLoading={q.photosEmailStatus === 'sending'}
          onConfirm={q.photosEmailStatus === 'done' ? () => { q.setShowSendPhotosPanel(false); q.setSelectedPhotoIds(new Set()); setSelecting(false) } : () => q.handleSendPhotosEmail()}
        >
          <div className={styles.stack}>
            <Field type="textarea" label="Message d’accompagnement" placeholder="Facultatif" value={q.photosEmailMsg} onChange={e => q.setPhotosEmailMsg(e.target.value)} />
            {q.photosEmailStatus === 'done' && <p className={screen.ok} role="status">Photos envoyées à {q.photosEmailRecipient}.</p>}
            {q.photosEmailStatus === 'error' && <p className={screen.error} role="alert">{q.photosEmailError}</p>}
          </div>
        </Sheet>
      )}

      <AlertDialog
        open={deleting !== null}
        onOpenChange={o => { if (!o) setDeleting(null) }}
        title="Supprimer cette photo ?"
        description="La photo sera retirée du chantier et du rapport."
        confirmLabel="Supprimer"
        onConfirm={() => { if (deleting) q.handleDeletePhoto(deleting); setDeleting(null) }}
      />
    </>
  )
}
