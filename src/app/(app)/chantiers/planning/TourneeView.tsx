'use client'

import React, { useState, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import {
  Plus,
  Zap,
  Copy,
  FileDown,
  Loader2,
  X,
  ChevronRight,
  Route,
  Clock,
  Timer,
  Navigation,
  MapPin,
  ListChecks,
  Home,
  Check,
} from 'lucide-react'
import type { GlobalPlanning, Chantier, Equipe, TourneeSlot } from '@/lib/data/queries/chantiers'
import type { IndividualMember } from '@/lib/data/queries/members'
import {
  upsertTourneeSlot,
  reorderTournee,
  updateTourneeSlotTravelTimes,
  duplicateTournee,
  deletePlanningSlot,
  upsertTourneeRoute,
} from '@/lib/data/mutations/planning'
import { TourneeCard, type TourneeCardMember } from './TourneeCard'
import { optimizeRouteOrder, buildTourneeWithTravel, estimateTravelMin } from './TourneeOptimizer'

function fmtMin(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m}min`
  if (m === 0) return `${h}h`
  return `${h}h${String(m).padStart(2, '0')}`
}

function addMinutesToTime(time: string | null, minutes: number): string {
  const [h, m] = (time ?? '08:00').split(':').map(Number)
  const total = h * 60 + m + minutes
  const hh = Math.floor(total / 60) % 24
  const mm = total % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

function durationFromTimes(start: string | null, end: string | null, fallback = 60): number {
  if (!start || !end) return fallback
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const diff = eh * 60 + em - (sh * 60 + sm)
  return diff > 0 ? diff : fallback
}

function fmtDateLabel(date: Date): string {
  return date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function getLocalDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

type AssignableMember = Pick<IndividualMember, 'id' | 'prenom' | 'name' | 'email' | 'role_label'>

function memberFullName(member: AssignableMember): string {
  return [member.prenom, member.name].filter(Boolean).join(' ') || member.name
}

interface TourneeViewProps {
  dayPlannings: GlobalPlanning[]
  chantiers: Chantier[]
  equipes: Equipe[]
  individualMembers: IndividualMember[]
  selectedDate: Date
  onPlanningsChange: (updated: GlobalPlanning[]) => void
  canManage: boolean
  orgDepartureAddress?: string | null
  orgDeparturePostalCode?: string | null
  orgDepartureCity?: string | null
  routeDepartures?: Record<string, { address: string | null; postal_code: string | null; city: string | null }>
}

type ModalMode = 'add' | 'edit' | null

export default function TourneeView({
  dayPlannings,
  chantiers,
  equipes,
  individualMembers,
  selectedDate,
  onPlanningsChange,
  canManage,
  orgDepartureAddress,
  orgDeparturePostalCode,
  orgDepartureCity,
  routeDepartures = {},
}: TourneeViewProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Route active
  const [activeRouteId, setActiveRouteId] = useState<string | null>(null)
  const [localRouteSlots, setLocalRouteSlots] = useState<TourneeSlot[] | null>(null)
  // ID brouillon pour une nouvelle tournée pas encore sauvegardée (n'écrase pas la vue actuelle)
  const [pendingNewRouteId, setPendingNewRouteId] = useState<string | null>(null)

  // Modals
  const [modalMode, setModalMode] = useState<ModalMode>(null)
  const [editingSlot, setEditingSlot] = useState<TourneeSlot | null>(null)
  const [showDuplicateConfirm, setShowDuplicateConfirm] = useState(false)

  // Form état ajout/edit
  const [formChantier, setFormChantier] = useState('')
  const [formStartTime, setFormStartTime] = useState('08:00')
  const [formDuration, setFormDuration] = useState(60)
  const [formLabel, setFormLabel] = useState('Equipe')
  const [formTeamSize, setFormTeamSize] = useState(1)
  const [formEquipeId, setFormEquipeId] = useState('')
  const [formMemberId, setFormMemberId] = useState('')
  const [formNotes, setFormNotes] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [formSaving, setFormSaving] = useState(false)

  // Point de départ de la tournée active
  const [showDepartureEditor, setShowDepartureEditor] = useState(false)
  const [departureAddress, setDepartureAddress] = useState('')
  const [departurePostalCode, setDeparturePostalCode] = useState('')
  const [departureCity, setDepartureCity] = useState('')
  const [isSavingDeparture, setIsSavingDeparture] = useState(false)
  const [departureSaved, setDepartureSaved] = useState(false)

  // Optimisation
  const [isOptimizing, setIsOptimizing] = useState(false)

  // Duplication
  const [isDuplicating, setIsDuplicating] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // Grouper les plannings par route_id
  const routeGroups = useMemo(() => {
    const groups = new Map<string, TourneeSlot[]>()
    for (const p of dayPlannings) {
      if (!p.route_id) continue
      const arr = groups.get(p.route_id) ?? []
      arr.push(p as TourneeSlot)
      groups.set(p.route_id, arr)
    }
    for (const [id, slots] of groups) {
      groups.set(id, [...slots].sort((a, b) => (a.route_order ?? 0) - (b.route_order ?? 0)))
    }
    return groups
  }, [dayPlannings])

  const routeIds = Array.from(routeGroups.keys())
  const freeSlots = useMemo(() => dayPlannings.filter(p => !p.route_id), [dayPlannings])
  const assignableMembers = useMemo(() => {
    const map = new Map<string, AssignableMember>()
    for (const member of individualMembers) map.set(member.id, member)
    for (const equipe of equipes) {
      for (const member of equipe.membres) {
        map.set(member.id, {
          id: member.id,
          prenom: member.prenom,
          name: member.name,
          email: member.email,
          role_label: member.role_label,
        })
      }
    }
    return Array.from(map.values()).sort((a, b) => memberFullName(a).localeCompare(memberFullName(b), 'fr'))
  }, [equipes, individualMembers])

  // Route sélectionnée : activeRouteId si elle existe dans routeGroups, sinon première route du jour
  const effectiveRouteId = activeRouteId && routeGroups.has(activeRouteId)
    ? activeRouteId
    : routeIds[0] ?? null

  // Slots de la route active (état local si drag en cours, sinon depuis props)
  const routeSlots: TourneeSlot[] = localRouteSlots ?? (
    effectiveRouteId ? routeGroups.get(effectiveRouteId) ?? [] : []
  )

  // Résumé
  const summary = useMemo(() => {
    const totalSiteMin = routeSlots.reduce((s, sl) => s + (sl.duration_min ?? 0), 0)
    const totalTravelMin = routeSlots.reduce((s, sl) => s + (sl.travel_from_prev_min ?? 0), 0)
    const startTime = routeSlots[0]?.start_time ?? null
    return { totalSiteMin, totalTravelMin, startTime, count: routeSlots.length }
  }, [routeSlots])

  // Route label (nom de l'équipe / label du premier slot)
  const routeLabel = useMemo(() => {
    if (!routeSlots.length) return 'Nouvelle tournée'
    const memberId = routeSlots[0].member_id
    if (memberId) {
      const member = assignableMembers.find(m => m.id === memberId)
      if (member) return memberFullName(member)
    }
    const equipeId = routeSlots[0].equipe_id
    if (equipeId) {
      const equipe = equipes.find(e => e.id === equipeId)
      if (equipe) return equipe.name
    }
    return routeSlots[0].label ?? 'Tournée'
  }, [routeSlots, equipes, assignableMembers])

  function membersForSlot(slot: TourneeSlot): TourneeCardMember[] {
    if (slot.member_id) {
      const member = assignableMembers.find(m => m.id === slot.member_id)
      return member
        ? [{
            id: member.id,
            fullName: memberFullName(member),
            roleLabel: member.role_label,
            email: member.email,
          }]
        : []
    }
    if (!slot.equipe_id) return []
    const equipe = equipes.find(e => e.id === slot.equipe_id)
    if (!equipe) return []
    return equipe.membres.map(member => ({
      id: member.id,
      fullName: memberFullName(member),
      roleLabel: member.role_label,
      email: member.email,
    }))
  }

  // Point de départ de la tournée active — initialisé depuis routeDepartures ou l'org
  const activeDeparture = effectiveRouteId ? (routeDepartures[effectiveRouteId] ?? null) : null
  const resolvedDepartureAddress = activeDeparture?.address ?? orgDepartureAddress ?? ''
  const resolvedDeparturePostalCode = activeDeparture?.postal_code ?? orgDeparturePostalCode ?? ''
  const resolvedDepartureCity = activeDeparture?.city ?? orgDepartureCity ?? ''
  const hasDeparture = !!(resolvedDepartureAddress || resolvedDeparturePostalCode || resolvedDepartureCity)

  function openDepartureEditor() {
    setDepartureAddress(resolvedDepartureAddress)
    setDeparturePostalCode(resolvedDeparturePostalCode)
    setDepartureCity(resolvedDepartureCity)
    setDepartureSaved(false)
    setShowDepartureEditor(true)
  }

  async function saveDeparture() {
    if (!effectiveRouteId) return
    setIsSavingDeparture(true)
    await upsertTourneeRoute(effectiveRouteId, {
      plannedDate: getLocalDateStr(selectedDate),
      departureAddress: departureAddress.trim() || null,
      departurePostalCode: departurePostalCode.trim() || null,
      departureCity: departureCity.trim() || null,
    })
    setIsSavingDeparture(false)
    setDepartureSaved(true)
    setShowDepartureEditor(false)
    startTransition(() => { router.refresh() })
  }

  // ── DnD ──────────────────────────────────────────────────────────────────────

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id || !effectiveRouteId) {
      setLocalRouteSlots(null)
      return
    }

    const oldIdx = routeSlots.findIndex(s => s.id === active.id)
    const newIdx = routeSlots.findIndex(s => s.id === over.id)
    if (oldIdx === -1 || newIdx === -1) return

    const reordered = arrayMove(routeSlots, oldIdx, newIdx)
    setLocalRouteSlots(reordered)

    const { error } = await reorderTournee(effectiveRouteId, reordered.map(s => s.id))
    if (error) {
      setLocalRouteSlots(null)
    } else {
      startTransition(() => {
        router.refresh()
        setLocalRouteSlots(null)
      })
    }
  }

  // ── Optimisation ─────────────────────────────────────────────────────────────

  async function handleOptimize() {
    if (!effectiveRouteId || routeSlots.length < 2) return
    setIsOptimizing(true)

    const optimizable = routeSlots.map(s => ({
      id: s.id,
      postal_code: s.chantier_postal_code,
      city: s.chantier_city,
      address_line1: s.chantier_address_line1,
    }))
    const departurePostal = resolvedDeparturePostalCode || null
    const orderedIds = optimizeRouteOrder(optimizable, departurePostal)
    const orderedSlots = orderedIds.map(id => routeSlots.find(s => s.id === id)!).filter(Boolean)
    const withTravel = buildTourneeWithTravel(
      orderedSlots.map(s => ({
        id: s.id,
        postal_code: s.chantier_postal_code,
        city: s.chantier_city,
        address_line1: s.chantier_address_line1,
      })),
      departurePostal,
    )

    // Optimistic
    const optimizedSlots = orderedSlots.map((s, i) => ({
      ...s,
      route_order: i + 1,
      travel_from_prev_min: withTravel[i].travel_from_prev_min,
    }))
    setLocalRouteSlots(optimizedSlots)

    const { error: reorderError } = await reorderTournee(effectiveRouteId, orderedIds)
    if (!reorderError) {
      await updateTourneeSlotTravelTimes(withTravel.map(w => ({ id: w.id, travel_from_prev_min: w.travel_from_prev_min })))
    }

    setIsOptimizing(false)
    startTransition(() => {
      router.refresh()
      setLocalRouteSlots(null)
    })
  }

  // ── Duplication ───────────────────────────────────────────────────────────────

  async function handleDuplicate() {
    if (!effectiveRouteId) return
    setIsDuplicating(true)
    const targetDate = getLocalDateStr(addDays(selectedDate, 7))
    const { error } = await duplicateTournee(effectiveRouteId, targetDate)
    setIsDuplicating(false)
    setShowDuplicateConfirm(false)
    if (!error) {
      startTransition(() => { router.refresh() })
    }
  }

  // ── Nouvelle tournée ─────────────────────────────────────────────────────────

  function handleNewRoute() {
    const newId = crypto.randomUUID()
    setPendingNewRouteId(newId)
    openAddModal(newId)
  }

  // ── Modal ajout / edit ───────────────────────────────────────────────────────

  function openAddModal(forNewRouteId?: string) {
    if (!forNewRouteId && !effectiveRouteId && routeIds.length === 0) {
      handleNewRoute()
      return
    }

    // Pour une nouvelle tournée, on part de zéro — pas de référence aux slots de l'ancienne route
    const slotsRef = forNewRouteId ? [] : routeSlots

    // Pré-remplir heure : fin du dernier slot + travel estimé
    const lastSlot = slotsRef[slotsRef.length - 1]
    let defaultStart = '08:00'
    if (lastSlot?.end_time) {
      defaultStart = addMinutesToTime(lastSlot.end_time, 15)
    } else if (lastSlot?.start_time && lastSlot.duration_min) {
      defaultStart = addMinutesToTime(lastSlot.start_time, lastSlot.duration_min + 15)
    }

    setFormChantier('')
    setFormStartTime(defaultStart)
    setFormDuration(60)
    setFormLabel(equipes[0]?.name ?? 'Equipe')
    setFormTeamSize(1)
    setFormEquipeId(slotsRef[0]?.equipe_id ?? equipes[0]?.id ?? '')
    setFormMemberId(slotsRef[0]?.member_id ?? '')
    setFormNotes('')
    setFormError(null)
    setEditingSlot(null)
    setModalMode('add')
  }

  function openEditModal(slot: TourneeSlot) {
    setFormChantier(slot.chantier_id)
    setFormStartTime(slot.start_time ?? '08:00')
    setFormDuration(slot.duration_min ?? 60)
    setFormLabel(slot.label)
    setFormTeamSize(slot.team_size)
    setFormEquipeId(slot.equipe_id ?? '')
    setFormMemberId(slot.member_id ?? '')
    setFormNotes(slot.notes ?? '')
    setFormError(null)
    setEditingSlot(slot)
    setModalMode('edit')
  }

  function closeModal() {
    setModalMode(null)
    setEditingSlot(null)
    setFormError(null)
    setPendingNewRouteId(null)
  }

  async function handleSubmitModal() {
    if (!formChantier) { setFormError('Sélectionnez un chantier.'); return }
    if (formDuration <= 0) { setFormError('La durée doit être supérieure à 0.'); return }

    // pendingNewRouteId = nouvelle tournée en cours de création (pas encore dans routeGroups)
    const routeId = pendingNewRouteId ?? effectiveRouteId ?? crypto.randomUUID()
    const isNewRoute = pendingNewRouteId !== null

    const equipeObj = equipes.find(e => e.id === formEquipeId)
    const memberObj = assignableMembers.find(m => m.id === formMemberId)
    const label = (memberObj ? memberFullName(memberObj) : equipeObj?.name ?? formLabel) || 'Equipe'
    const endTime = addMinutesToTime(formStartTime, formDuration)

    // Pour une nouvelle tournée, les slots de référence sont vides (routeSlots pointe encore l'ancienne route)
    const currentRouteSlots = isNewRoute ? [] : routeSlots

    // Calculer le trajet estimé depuis le dernier slot (ou le point de départ) vers ce chantier
    let travelFromPrevMin: number | null = null
    if (modalMode === 'add') {
      const newChantier = chantiers.find(c => c.id === formChantier)
      if (currentRouteSlots.length > 0) {
        const lastSlot = currentRouteSlots[currentRouteSlots.length - 1]
        if (lastSlot.chantier_postal_code || lastSlot.chantier_city) {
          travelFromPrevMin = estimateTravelMin(
            { id: lastSlot.id, postal_code: lastSlot.chantier_postal_code, city: lastSlot.chantier_city, address_line1: lastSlot.chantier_address_line1 },
            { id: formChantier, postal_code: newChantier?.postal_code ?? null, city: newChantier?.city ?? null, address_line1: newChantier?.address_line1 ?? null },
          )
        }
      } else if (resolvedDeparturePostalCode || resolvedDepartureCity) {
        // Premier site : calculer depuis le point de départ
        travelFromPrevMin = estimateTravelMin(
          { id: 'departure', postal_code: resolvedDeparturePostalCode || null, city: resolvedDepartureCity || null, address_line1: resolvedDepartureAddress || null },
          { id: formChantier, postal_code: newChantier?.postal_code ?? null, city: newChantier?.city ?? null, address_line1: newChantier?.address_line1 ?? null },
        )
      }
    } else if (modalMode === 'edit' && editingSlot) {
      travelFromPrevMin = editingSlot.travel_from_prev_min ?? null
    }

    const input = {
      chantierId: formChantier,
      plannedDate: getLocalDateStr(selectedDate),
      startTime: formStartTime,
      endTime,
      label,
      teamSize: formMemberId ? 1 : formTeamSize,
      notes: formNotes || null,
      equipeId: formMemberId ? null : formEquipeId || null,
      memberId: formMemberId || null,
      routeId,
      routeOrder: modalMode === 'edit' ? (editingSlot?.route_order ?? currentRouteSlots.length + 1) : currentRouteSlots.length + 1,
      durationMin: formDuration,
      travelFromPrevMin,
    }

    setFormSaving(true)
    setFormError(null)

    const result = modalMode === 'edit' && editingSlot
      ? await upsertTourneeSlot(input, editingSlot.id)
      : await upsertTourneeSlot(input)

    setFormSaving(false)

    if (result.error) {
      setFormError(result.error)
    } else {
      // Basculer sur la nouvelle route seulement après sauvegarde réussie
      if (isNewRoute) {
        setActiveRouteId(routeId)
        setLocalRouteSlots(null)
      }
      setPendingNewRouteId(null)
      setModalMode(null)
      setEditingSlot(null)
      setFormError(null)
      startTransition(() => { router.refresh() })
    }
  }

  async function handleMoveExistingSlotToRoute(slot: GlobalPlanning) {
    const routeId = effectiveRouteId ?? crypto.randomUUID()
    const willCreateRoute = !effectiveRouteId

    const duration = slot.duration_min ?? durationFromTimes(slot.start_time, slot.end_time)
    const startTime = slot.start_time ?? '08:00'
    const equipeObj = slot.equipe_id ? equipes.find(e => e.id === slot.equipe_id) : null
    const memberObj = slot.member_id ? assignableMembers.find(m => m.id === slot.member_id) : null
    const firstRouteEquipe = routeSlots[0]?.equipe_id
    const firstRouteLabel = firstRouteEquipe ? equipes.find(e => e.id === firstRouteEquipe)?.name : null

    const result = await upsertTourneeSlot({
      chantierId: slot.chantier_id,
      plannedDate: getLocalDateStr(selectedDate),
      startTime,
      endTime: slot.end_time ?? addMinutesToTime(startTime, duration),
      label: memberObj ? memberFullName(memberObj) : equipeObj?.name ?? firstRouteLabel ?? slot.label ?? 'Equipe',
      teamSize: slot.team_size,
      notes: slot.notes,
      equipeId: slot.member_id ? null : slot.equipe_id ?? routeSlots[0]?.equipe_id ?? null,
      memberId: slot.member_id,
      routeId,
      routeOrder: routeSlots.length + 1,
      durationMin: duration,
    }, slot.id)

    if (!result.error) {
      if (willCreateRoute) setActiveRouteId(routeId)
      startTransition(() => { router.refresh() })
    }
  }

  async function handleDelete(slotId: string) {
    const { error } = await deletePlanningSlot(slotId)
    if (!error) {
      startTransition(() => { router.refresh() })
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="rounded-xl border border-[var(--elevation-border)] bg-surface p-4 shadow-sm dark:bg-white/[0.04]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
                <Route className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold text-primary">Mode tournée</p>
                <p className="mt-1 max-w-2xl text-sm text-secondary">
                  Une tournée correspond à l&apos;ordre de passage d&apos;une équipe sur la journée sélectionnée.
                  Ajoutez les sites, réordonnez-les, puis exportez la feuille de route.
                </p>
              </div>
            </div>

            <div className="grid gap-2 text-xs text-secondary sm:grid-cols-3 lg:min-w-[520px]">
              {[
                ['1', 'Créer', 'choisir le premier chantier'],
                ['2', 'Composer', 'ajouter ou déplacer les sites'],
                ['3', 'Préparer', 'optimiser et exporter le PDF'],
              ].map(([step, title, text]) => (
                <div key={step} className="flex items-center gap-2 rounded-lg border border-[var(--elevation-border)] bg-interactive px-3 py-2 dark:bg-white/[0.03]">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-black">
                    {step}
                  </span>
                  <span>
                    <span className="block font-semibold text-primary">{title}</span>
                    <span>{text}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {canManage && (
          <button
            onClick={handleNewRoute}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-sm font-semibold text-black hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            Nouvelle tournée
          </button>
        )}

        {effectiveRouteId && (
          <>
            <button
              onClick={handleOptimize}
              disabled={isOptimizing || routeSlots.length < 2}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--elevation-border)] bg-surface text-sm font-medium text-secondary hover:text-primary hover:bg-interactive transition-colors disabled:opacity-50 disabled:cursor-not-allowed dark:bg-white/[0.04] dark:hover:bg-white/[0.08]"
            >
              {isOptimizing
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Zap className="w-4 h-4" />}
              Optimiser l&apos;ordre estimé
            </button>

            {canManage && (
              <button
                onClick={() => setShowDuplicateConfirm(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--elevation-border)] bg-surface text-sm font-medium text-secondary hover:text-primary hover:bg-interactive transition-colors dark:bg-white/[0.04] dark:hover:bg-white/[0.08]"
              >
                <Copy className="w-4 h-4" />
                Dupliquer J+7
              </button>
            )}

            <a
              href={`/api/pdf/tournee/${effectiveRouteId}?download=1`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--elevation-border)] bg-surface text-sm font-medium text-secondary hover:text-primary hover:bg-interactive transition-colors dark:bg-white/[0.04] dark:hover:bg-white/[0.08]"
            >
              <FileDown className="w-4 h-4" />
              Feuille de route PDF
            </a>

            <button
              onClick={openDepartureEditor}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                hasDeparture
                  ? 'border-accent/40 bg-accent/10 text-accent hover:bg-accent/15'
                  : 'border-[var(--elevation-border)] bg-surface text-secondary hover:text-primary hover:bg-interactive dark:bg-white/[0.04] dark:hover:bg-white/[0.08]'
              }`}
            >
              <Home className="w-4 h-4" />
              {hasDeparture ? [resolvedDeparturePostalCode, resolvedDepartureCity].filter(Boolean).join(' ') || 'Point de départ' : 'Point de départ'}
            </button>
          </>
        )}
      </div>

      {/* Sélecteur de route si plusieurs routes */}
      {routeIds.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {routeIds.map(rid => {
            const slots = routeGroups.get(rid) ?? []
            const firstSlot = slots[0]
            const equipeId = firstSlot?.equipe_id
            const equipe = equipes.find(e => e.id === equipeId)
            const label = equipe?.name ?? firstSlot?.label ?? 'Tournée'
            return (
              <button
                key={rid}
                onClick={() => { setActiveRouteId(rid); setLocalRouteSlots(null) }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
                  rid === effectiveRouteId
                    ? 'bg-accent text-black border-accent'
                    : 'border-[var(--elevation-border)] bg-surface text-secondary hover:text-primary hover:bg-interactive dark:bg-white/[0.04] dark:hover:bg-white/[0.08]'
                }`}
              >
                <Route className="w-3.5 h-3.5" />
                {label}
                <span className="text-xs opacity-70">({slots.length} site{slots.length > 1 ? 's' : ''})</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Bande résumé */}
      {effectiveRouteId && routeSlots.length > 0 && (
        <div className="flex flex-wrap items-center gap-4 px-4 py-2.5 rounded-xl bg-surface border border-[var(--elevation-border)] text-sm text-secondary shadow-sm dark:bg-white/[0.04]">
          <span className="font-semibold text-primary">{routeLabel}</span>
          <span className="flex items-center gap-1">
            <Route className="w-3.5 h-3.5" />
            {summary.count} site{summary.count > 1 ? 's' : ''}
          </span>
          {summary.totalSiteMin > 0 && (
            <span className="flex items-center gap-1">
              <Timer className="w-3.5 h-3.5" />
              {fmtMin(summary.totalSiteMin)} d&apos;intervention
            </span>
          )}
          {summary.totalTravelMin > 0 && (
            <span className="flex items-center gap-1">
              <Navigation className="w-3.5 h-3.5" />
              ~{fmtMin(summary.totalTravelMin)} de trajet
            </span>
          )}
          {summary.startTime && (
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              Départ : {summary.startTime.replace(':', 'h')}
            </span>
          )}
        </div>
      )}

      {/* Etat vide */}
      {routeIds.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--elevation-border)] bg-surface px-4 py-14 text-center dark:bg-white/[0.03]">
          <Route className="w-10 h-10 text-secondary/40 mb-3" />
          <p className="font-semibold text-primary mb-1">Aucune tournée pour cette journée</p>
          {canManage ? (
            <>
              <p className="max-w-xl text-sm text-secondary mb-4">
                Commencez par créer la tournée, puis choisissez le premier chantier dans la fenêtre qui s&apos;ouvre.
                Les autres sites pourront être ajoutés ensuite.
              </p>
              <button
                onClick={handleNewRoute}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-black font-semibold text-sm hover:opacity-90 transition-opacity shadow-lg shadow-accent/20"
              >
                <Plus className="w-4 h-4" />
                Créer la tournée et ajouter le 1er site
              </button>
            </>
          ) : (
            <p className="max-w-xl text-sm text-secondary">
              Aucune tournée planifiée pour cette journée.
            </p>
          )}
        </div>
      )}

      {/* Liste DnD */}
      {effectiveRouteId && (
        <div className="relative">
          {isPending && (
            <div className="absolute inset-0 z-10 flex flex-col gap-3 rounded-xl bg-surface/70 backdrop-blur-[2px] dark:bg-black/40">
              {Array.from({ length: Math.max(routeSlots.length, 2) }).map((_, i) => (
                <div key={i} className="h-[120px] rounded-xl border border-[var(--elevation-border)] bg-interactive animate-pulse dark:bg-white/[0.06]" />
              ))}
            </div>
          )}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={routeSlots.map(s => s.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-0">
                {routeSlots.map((slot, i) => (
                  <TourneeCard
                    key={slot.id}
                    slot={slot}
                    index={i}
                    isFirst={i === 0}
                    members={membersForSlot(slot)}
                    onEdit={canManage ? openEditModal : undefined}
                    onDelete={canManage ? handleDelete : undefined}
                    disabled={isPending}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      )}

      {/* Bouton ajouter un site */}
      {effectiveRouteId && canManage && (
        <button
          onClick={() => openAddModal()}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-[var(--elevation-border)] bg-surface text-sm font-medium text-secondary hover:text-primary hover:border-accent hover:bg-accent/5 transition-colors dark:bg-white/[0.03]"
        >
          <Plus className="w-4 h-4" />
          Ajouter un site
        </button>
      )}

      {/* Hors tournée */}
      {freeSlots.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 flex items-center gap-2">
            <ListChecks className="h-3.5 w-3.5 text-secondary" />
            <p className="text-xs font-semibold text-secondary uppercase tracking-wider">Créneaux hors tournée ce jour</p>
          </div>
          <div className="space-y-1">
            {freeSlots.map(slot => (
              <div
                key={slot.id}
                className="flex flex-col gap-2 rounded-lg border border-[var(--elevation-border)] bg-surface px-3 py-2 text-sm shadow-sm dark:bg-white/[0.04] sm:flex-row sm:items-center"
              >
                <div className="flex-1 min-w-0">
                  <span className="block truncate font-medium text-primary">{slot.chantier_title}</span>
                  {(slot.chantier_city || slot.chantier_postal_code) && (
                    <span className="mt-0.5 flex items-center gap-1 text-xs text-secondary">
                      <MapPin className="h-3 w-3" />
                      {[slot.chantier_postal_code, slot.chantier_city].filter(Boolean).join(' ')}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 sm:shrink-0">
                  {slot.start_time && (
                    <span className="text-xs text-secondary">{slot.start_time.replace(':', 'h')}</span>
                  )}
                  <button
                    onClick={() => handleMoveExistingSlotToRoute(slot)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--elevation-border)] px-2.5 py-1.5 text-xs font-medium text-secondary transition-colors hover:border-accent hover:text-primary hover:bg-accent/5"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                    {effectiveRouteId ? 'Ajouter à la tournée' : 'Créer une tournée avec ce créneau'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal point de départ */}
      {showDepartureEditor && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50">
          <div className="w-full max-w-md bg-surface rounded-2xl shadow-xl border border-[var(--elevation-border)] overflow-hidden dark:bg-[#121212]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--elevation-border)]">
              <div>
                <h3 className="font-semibold text-primary">Point de départ de la tournée</h3>
                <p className="mt-0.5 text-xs text-secondary">
                  Utilisé pour calculer le trajet vers le premier site.
                </p>
              </div>
              <button onClick={() => setShowDepartureEditor(false)} className="p-1.5 rounded-lg hover:bg-interactive text-secondary transition-colors dark:hover:bg-white/[0.08]">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-secondary mb-1.5">Adresse</label>
                <input
                  type="text"
                  value={departureAddress}
                  onChange={e => setDepartureAddress(e.target.value)}
                  placeholder="12 rue de l'Atelier"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--elevation-border)] bg-interactive text-sm text-primary focus:outline-none focus:border-accent dark:bg-white/[0.04]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1.5">Code postal</label>
                  <input
                    type="text"
                    value={departurePostalCode}
                    onChange={e => setDeparturePostalCode(e.target.value)}
                    placeholder="75001"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--elevation-border)] bg-interactive text-sm text-primary focus:outline-none focus:border-accent dark:bg-white/[0.04]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1.5">Ville</label>
                  <input
                    type="text"
                    value={departureCity}
                    onChange={e => setDepartureCity(e.target.value)}
                    placeholder="Paris"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--elevation-border)] bg-interactive text-sm text-primary focus:outline-none focus:border-accent dark:bg-white/[0.04]"
                  />
                </div>
              </div>
              <p className="text-xs text-secondary">
                Par défaut, l&apos;adresse de départ configurée dans vos paramètres organisation est utilisée. Vous pouvez la surcharger pour cette tournée spécifique.
              </p>
            </div>

            <div className="flex gap-2 px-5 py-4 border-t border-[var(--elevation-border)]">
              <button
                onClick={() => setShowDepartureEditor(false)}
                className="flex-1 py-2 rounded-xl border border-[var(--elevation-border)] text-sm font-medium text-secondary hover:bg-interactive transition-colors dark:hover:bg-white/[0.08]"
              >
                Annuler
              </button>
              <button
                onClick={saveDeparture}
                disabled={isSavingDeparture}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl bg-accent text-black text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {isSavingDeparture
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : departureSaved
                    ? <Check className="w-4 h-4" />
                    : null}
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal ajout / edit */}
      {modalMode && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50">
          <div className="w-full max-w-md bg-surface rounded-2xl shadow-xl border border-[var(--elevation-border)] overflow-hidden dark:bg-[#121212]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--elevation-border)]">
              <div>
                <h3 className="font-semibold text-primary">
                  {modalMode === 'add' ? 'Ajouter un site à la tournée' : 'Modifier le site'}
                </h3>
                {modalMode === 'add' && (
                  <p className="mt-0.5 text-xs text-secondary">
                    Ce site deviendra le prochain passage de la tournée du jour.
                  </p>
                )}
              </div>
              <button onClick={closeModal} className="p-1.5 rounded-lg hover:bg-interactive text-secondary transition-colors dark:hover:bg-white/[0.08]">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Chantier */}
              <div>
                <label className="block text-xs font-medium text-secondary mb-1.5">Chantier *</label>
                <select
                  value={formChantier}
                  onChange={e => setFormChantier(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--elevation-border)] bg-interactive text-sm text-primary focus:outline-none focus:border-accent dark:bg-white/[0.04]"
                >
                  <option value="">Sélectionner un chantier...</option>
                  {chantiers.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.title}{c.city ? ` — ${c.city}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Heure de début */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1.5">Heure de début</label>
                  <input
                    type="time"
                    value={formStartTime}
                    onChange={e => setFormStartTime(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--elevation-border)] bg-interactive text-sm text-primary focus:outline-none focus:border-accent dark:bg-white/[0.04]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1.5">Durée sur site (min) *</label>
                  <input
                    type="number"
                    min={15}
                    max={720}
                    value={formDuration}
                    onChange={e => setFormDuration(parseInt(e.target.value) || 60)}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--elevation-border)] bg-interactive text-sm text-primary focus:outline-none focus:border-accent dark:bg-white/[0.04]"
                  />
                </div>
              </div>

              {/* Affectation */}
              {(equipes.length > 0 || assignableMembers.length > 0) && (
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1.5">Affectation</label>
                  <select
                    value={formMemberId ? `member:${formMemberId}` : formEquipeId ? `equipe:${formEquipeId}` : ''}
                    onChange={e => {
                      const value = e.target.value
                      if (!value) {
                        setFormEquipeId('')
                        setFormMemberId('')
                        return
                      }
                      const [kind, id] = value.split(':')
                      if (kind === 'member') {
                        const member = assignableMembers.find(m => m.id === id)
                        setFormMemberId(id)
                        setFormEquipeId('')
                        setFormTeamSize(1)
                        if (member) setFormLabel(memberFullName(member))
                      } else {
                        const eq = equipes.find(eq => eq.id === id)
                        setFormEquipeId(id)
                        setFormMemberId('')
                        if (eq) {
                          setFormLabel(eq.name)
                          setFormTeamSize(eq.membres.length || 1)
                        }
                      }
                    }}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--elevation-border)] bg-interactive text-sm text-primary focus:outline-none focus:border-accent dark:bg-white/[0.04]"
                  >
                    <option value="">Non affecté</option>
                    {equipes.length > 0 && (
                      <optgroup label="Équipes">
                        {equipes.map(eq => (
                          <option key={eq.id} value={`equipe:${eq.id}`}>{eq.name} ({eq.membres.length || 1} pers.)</option>
                        ))}
                      </optgroup>
                    )}
                    {assignableMembers.length > 0 && (
                      <optgroup label="Membres et intervenants invités">
                        {assignableMembers.map(member => (
                          <option key={member.id} value={`member:${member.id}`}>
                            {memberFullName(member)}{member.role_label ? ` · ${member.role_label}` : ''}{member.email ? ` · ${member.email}` : ''}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  <p className="mt-1 text-xs text-secondary">
                    Un intervenant invité par mail verra ce créneau dans son espace personnel et ses heures seront pointées à son nom.
                  </p>
                </div>
              )}

              {/* Nb personnes + label */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1.5">Nb personnes</label>
                  <input
                    type="number"
                    min={1}
                    value={formTeamSize}
                    onChange={e => setFormTeamSize(parseInt(e.target.value) || 1)}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--elevation-border)] bg-interactive text-sm text-primary focus:outline-none focus:border-accent dark:bg-white/[0.04]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1.5">Label</label>
                  <input
                    type="text"
                    value={formLabel}
                    onChange={e => setFormLabel(e.target.value)}
                    placeholder="Équipe A"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--elevation-border)] bg-interactive text-sm text-primary focus:outline-none focus:border-accent dark:bg-white/[0.04]"
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-medium text-secondary mb-1.5">Notes</label>
                <textarea
                  value={formNotes}
                  onChange={e => setFormNotes(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder="Instructions spécifiques..."
                  className="w-full px-3 py-2 rounded-lg border border-[var(--elevation-border)] bg-interactive text-sm text-primary focus:outline-none focus:border-accent resize-none dark:bg-white/[0.04]"
                />
              </div>

              {formError && (
                <p className="text-sm text-rose-500">{formError}</p>
              )}
            </div>

            <div className="flex gap-2 px-5 py-4 border-t border-[var(--elevation-border)]">
              <button
                onClick={closeModal}
                className="flex-1 py-2 rounded-xl border border-[var(--elevation-border)] text-sm font-medium text-secondary hover:bg-interactive transition-colors dark:hover:bg-white/[0.08]"
              >
                Annuler
              </button>
              <button
                onClick={handleSubmitModal}
                disabled={formSaving}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl bg-accent text-black text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {formSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                {modalMode === 'add' ? 'Ajouter à la tournée' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation duplication */}
      {showDuplicateConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="w-full max-w-sm bg-surface rounded-2xl shadow-xl border border-[var(--elevation-border)] p-5 space-y-4 dark:bg-[#121212]">
            <h3 className="font-semibold text-primary">Dupliquer la tournée</h3>
            <p className="text-sm text-secondary">
              La tournée du <strong>{fmtDateLabel(selectedDate)}</strong> sera copiée au{' '}
              <strong>{fmtDateLabel(addDays(selectedDate, 7))}</strong> avec le même ordre et les mêmes horaires.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowDuplicateConfirm(false)}
                className="flex-1 py-2 rounded-xl border border-[var(--elevation-border)] text-sm font-medium text-secondary hover:bg-interactive transition-colors dark:hover:bg-white/[0.08]"
              >
                Annuler
              </button>
              <button
                onClick={handleDuplicate}
                disabled={isDuplicating}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl bg-accent text-black text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {isDuplicating && <Loader2 className="w-4 h-4 animate-spin" />}
                Dupliquer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
