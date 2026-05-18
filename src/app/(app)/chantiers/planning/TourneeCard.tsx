'use client'

import React, { useEffect, useState, useTransition } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  GripVertical,
  MapPin,
  Clock,
  Users,
  Pencil,
  Trash2,
  Navigation,
  Timer,
  LogIn,
  LogOut,
  Loader2,
} from 'lucide-react'
import type { TourneeSlot } from '@/lib/data/queries/chantiers'
import { createMemberPointageAdmin, createPointage } from '@/lib/data/mutations/chantiers'
import { useRouter } from 'next/navigation'

const CHANTIER_COLORS = [
  { bg: 'bg-indigo-500/20',  border: 'border-indigo-400', text: 'text-indigo-700 dark:text-indigo-300',   hex: '#6366f1' },
  { bg: 'bg-blue-500/20',    border: 'border-blue-400',   text: 'text-blue-700 dark:text-blue-300',       hex: '#3b82f6' },
  { bg: 'bg-emerald-500/20', border: 'border-emerald-400',text: 'text-emerald-700 dark:text-emerald-300', hex: '#10b981' },
  { bg: 'bg-amber-500/20',   border: 'border-amber-400',  text: 'text-amber-700 dark:text-amber-300',     hex: '#f59e0b' },
  { bg: 'bg-purple-500/20',  border: 'border-purple-400', text: 'text-purple-700 dark:text-purple-300',   hex: '#a855f7' },
  { bg: 'bg-rose-500/20',    border: 'border-rose-400',   text: 'text-rose-700 dark:text-rose-300',       hex: '#f43f5e' },
  { bg: 'bg-teal-500/20',    border: 'border-teal-400',   text: 'text-teal-700 dark:text-teal-300',       hex: '#14b8a6' },
  { bg: 'bg-orange-500/20',  border: 'border-orange-400', text: 'text-orange-700 dark:text-orange-300',   hex: '#f97316' },
  { bg: 'bg-sky-500/20',     border: 'border-sky-400',    text: 'text-sky-700 dark:text-sky-300',         hex: '#0ea5e9' },
  { bg: 'bg-lime-500/20',    border: 'border-lime-400',   text: 'text-lime-700 dark:text-lime-300',       hex: '#84cc16' },
  { bg: 'bg-pink-500/20',    border: 'border-pink-400',   text: 'text-pink-700 dark:text-pink-300',       hex: '#ec4899' },
  { bg: 'bg-cyan-500/20',    border: 'border-cyan-400',   text: 'text-cyan-700 dark:text-cyan-300',       hex: '#06b6d4' },
]

function fmtMin(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m}min`
  if (m === 0) return `${h}h`
  return `${h}h${String(m).padStart(2, '0')}`
}

function fmtTime(t: string): string {
  const [h, m] = t.split(':').map(Number)
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`
}

interface TourneeCardProps {
  slot: TourneeSlot
  index: number
  isFirst: boolean
  members?: TourneeCardMember[]
  onEdit?: (slot: TourneeSlot) => void
  onDelete?: (slotId: string) => void
  disabled?: boolean
}

export type TourneeCardMember = {
  id: string
  fullName: string
  roleLabel?: string | null
  email?: string | null
}

const STORAGE_KEY = (slotId: string) => `tournee-arrived-${slotId}`

export function TourneeCard({ slot, index, isFirst, members = [], onEdit, onDelete, disabled }: TourneeCardProps) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const color = CHANTIER_COLORS[slot.chantier_color_idx % CHANTIER_COLORS.length]

  // Arrivée persistée dans localStorage pour survivre aux router.refresh()
  const [arrivedAt, setArrivedAt] = useState<Date | null>(() => {
    if (typeof window === 'undefined') return null
    const stored = localStorage.getItem(STORAGE_KEY(slot.id))
    if (!stored) return null
    const d = new Date(stored)
    return isNaN(d.getTime()) ? null : d
  })
  const [isPointing, setIsPointing] = useState(false)
  const [pointageError, setPointageError] = useState<string | null>(null)
  const [pointageDone, setPointageDone] = useState(false)
  const [presentMemberIds, setPresentMemberIds] = useState<Set<string>>(() => new Set(members.map(m => m.id)))

  useEffect(() => {
    setPresentMemberIds(new Set(members.map(m => m.id)))
  }, [members])

  // Chrono affiché — re-render toutes les secondes quand sur site
  const [elapsed, setElapsed] = useState('')
  useEffect(() => {
    if (!arrivedAt) { setElapsed(''); return }
    const tick = () => {
      const diffMs = Date.now() - arrivedAt.getTime()
      const totalMin = Math.floor(diffMs / 60000)
      const h = Math.floor(totalMin / 60)
      const m = totalMin % 60
      setElapsed(h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`)
    }
    tick()
    const id = setInterval(tick, 30000)
    return () => clearInterval(id)
  }, [arrivedAt])

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: slot.id,
    disabled,
  })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  }

  const address = [slot.chantier_address_line1, slot.chantier_postal_code, slot.chantier_city]
    .filter(Boolean)
    .join(', ')

  const mapsUrl = address
    ? `https://maps.google.com/maps?q=${encodeURIComponent(address)}`
    : null

  function handleArrivee() {
    const now = new Date()
    localStorage.setItem(STORAGE_KEY(slot.id), now.toISOString())
    setArrivedAt(now)
    setPointageError(null)
    setPointageDone(false)
  }

  async function handleDepart() {
    if (!arrivedAt) return
    setIsPointing(true)
    setPointageError(null)

    const now = new Date()
    const diffMin = Math.round((now.getTime() - arrivedAt.getTime()) / 60000)
    const hours = diffMin / 60
    const startHH = String(arrivedAt.getHours()).padStart(2, '0')
    const startMM = String(arrivedAt.getMinutes()).padStart(2, '0')
    const startTime = `${startHH}:${startMM}`
    const date = slot.planned_date

    if (diffMin <= 0) {
      setIsPointing(false)
      setPointageError('Durée trop courte pour être enregistrée.')
      return
    }

    const pointagePayload = {
      date,
      hours,
      start_time: startTime,
      description: `Tournée — ${slot.chantier_title}`,
    }

    let result: { error: string | null } = { error: null }
    if (slot.member_id) {
      result = await createMemberPointageAdmin(slot.chantier_id, slot.member_id, pointagePayload)
    } else if (members.length > 0) {
      const presentMembers = members.filter(m => presentMemberIds.has(m.id))
      if (presentMembers.length === 0) {
        setIsPointing(false)
        setPointageError('Sélectionnez au moins une personne présente.')
        return
      }
      for (const member of presentMembers) {
        result = await createMemberPointageAdmin(slot.chantier_id, member.id, {
          ...pointagePayload,
          description: `Tournée — ${slot.chantier_title} — ${member.fullName}`,
        })
        if (result.error) break
      }
    } else {
      result = await createPointage(slot.chantier_id, pointagePayload)
    }

    setIsPointing(false)
    if (result.error) {
      setPointageError(result.error)
    } else {
      localStorage.removeItem(STORAGE_KEY(slot.id))
      setPointageDone(true)
      setArrivedAt(null)
      startTransition(() => { router.refresh() })
    }
  }

  return (
    <div ref={setNodeRef} style={style} className="relative">
      {/* Badge trajet depuis site précédent */}
      {!isFirst && slot.travel_from_prev_min != null && (
        <div className="flex items-center gap-1.5 px-4 py-1.5 text-xs text-secondary">
          <div className="flex-1 h-px border-t border-dashed border-[var(--elevation-border)]" />
          <Navigation className="w-3 h-3 shrink-0" />
          <span>~{fmtMin(slot.travel_from_prev_min)} de trajet</span>
          <div className="flex-1 h-px border-t border-dashed border-[var(--elevation-border)]" />
        </div>
      )}

      {/* Carte principale */}
      <div
        className={`group relative flex gap-0 overflow-hidden rounded-xl border bg-surface shadow-sm transition-colors hover:border-secondary/25 dark:bg-white/[0.04] ${color.border}`}
      >
        {/* Barre colorée gauche */}
        <div className="w-1 shrink-0" style={{ backgroundColor: color.hex }} />

        {/* Handle drag */}
        <button
          {...attributes}
          {...listeners}
          className="flex items-center px-2 text-secondary/70 hover:text-primary cursor-grab active:cursor-grabbing touch-none"
          tabIndex={-1}
          aria-label="Déplacer"
        >
          <GripVertical className="w-4 h-4" />
        </button>

        {/* Contenu */}
        <div className="flex-1 py-3 pr-3 min-w-0">
          <div className="flex items-start gap-3">
            {/* Numéro */}
            <div
              className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white mt-0.5"
              style={{ backgroundColor: color.hex }}
            >
              {index + 1}
            </div>

            {/* Infos principales */}
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-primary text-sm leading-tight truncate">
                {slot.chantier_title}
              </p>

              {address && (
                <div className="flex items-start gap-1 mt-0.5">
                  <MapPin className="w-3 h-3 shrink-0 mt-0.5 text-secondary" />
                  <p className="text-xs text-secondary truncate">{address}</p>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                {slot.start_time && (
                  <span className="flex items-center gap-1 text-xs text-secondary">
                    <Clock className="w-3 h-3" />
                    {fmtTime(slot.start_time)}
                    {slot.end_time && <> → {fmtTime(slot.end_time)}</>}
                  </span>
                )}
                {slot.duration_min != null && (
                  <span className="flex items-center gap-1 text-xs text-secondary">
                    <Timer className="w-3 h-3" />
                    {fmtMin(slot.duration_min)} sur site
                  </span>
                )}
                {slot.team_size > 1 && (
                  <span className="flex items-center gap-1 text-xs text-secondary">
                    <Users className="w-3 h-3" />
                    {slot.team_size} pers.
                  </span>
                )}
                {slot.label && (
                  <span className={`text-xs font-medium ${color.text}`}>{slot.label}</span>
                )}
              </div>

              {members.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {members.map(member => (
                    <span
                      key={member.id}
                      className="inline-flex items-center gap-1 rounded-full border border-[var(--elevation-border)] bg-interactive px-2 py-0.5 text-[11px] font-medium text-secondary dark:bg-white/[0.04]"
                      title={member.email ?? undefined}
                    >
                      <Users className="h-3 w-3" />
                      {member.fullName}
                    </span>
                  ))}
                </div>
              )}

              {slot.notes && (
                <p className="text-xs text-secondary mt-1 italic line-clamp-2">{slot.notes}</p>
              )}
            </div>

            {/* Actions (hover) */}
            <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0">
              {mapsUrl && (
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded-lg bg-interactive/70 hover:bg-interactive text-secondary hover:text-primary transition-colors dark:bg-white/[0.05] dark:hover:bg-white/[0.08]"
                  title="Ouvrir dans Maps"
                >
                  <Navigation className="w-3.5 h-3.5" />
                </a>
              )}
              {onEdit && (
                <button
                  onClick={() => onEdit(slot)}
                  className="p-1.5 rounded-lg bg-interactive/70 hover:bg-interactive text-secondary hover:text-primary transition-colors dark:bg-white/[0.05] dark:hover:bg-white/[0.08]"
                  title="Modifier"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
              {onDelete && (
                <button
                  onClick={() => onDelete(slot.id)}
                  className="p-1.5 rounded-lg bg-interactive/70 hover:bg-rose-500/10 text-secondary hover:text-rose-500 transition-colors dark:bg-white/[0.05]"
                  title="Supprimer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Boutons Arrivée / Départ */}
          <div className="mt-2.5 pt-2.5 border-t border-[var(--elevation-border)] flex items-center gap-2 flex-wrap">
            {!arrivedAt && !pointageDone && (
              <button
                onClick={handleArrivee}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors"
              >
                <LogIn className="w-3.5 h-3.5" />
                Arrivée
              </button>
            )}
            {arrivedAt && !pointageDone && (
              <>
                <span className="text-xs text-secondary">
                  Sur site depuis {arrivedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  {elapsed && <span className="ml-1 font-semibold text-primary">({elapsed})</span>}
                </span>
                {members.length > 1 && (
                  <div className="flex w-full flex-wrap gap-1.5">
                    <span className="mr-1 text-xs font-medium text-secondary">Présents :</span>
                    {members.map(member => {
                      const checked = presentMemberIds.has(member.id)
                      return (
                        <label
                          key={member.id}
                          className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-1 text-xs transition-colors ${
                            checked
                              ? 'border-accent bg-accent/10 text-primary'
                              : 'border-[var(--elevation-border)] text-secondary hover:text-primary'
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={checked}
                            onChange={() => {
                              setPresentMemberIds(prev => {
                                const next = new Set(prev)
                                if (next.has(member.id)) next.delete(member.id)
                                else next.add(member.id)
                                return next
                              })
                            }}
                          />
                          {member.fullName}
                        </label>
                      )
                    })}
                  </div>
                )}
                <button
                  onClick={handleDepart}
                  disabled={isPointing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 transition-colors disabled:opacity-50"
                >
                  {isPointing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5" />}
                  Départ
                </button>
              </>
            )}
            {pointageDone && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Pointage enregistré</span>
            )}
            {pointageError && (
              <span className="text-xs text-rose-500">{pointageError}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
