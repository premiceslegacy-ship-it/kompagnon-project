'use client'
// @atelier-migrated
// Logique de la tournée : sites, ordre, trajets estimés, point de départ, duplication. L'affichage vit dans TourneeView.tsx.

import { useState, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { arrayMove } from '@dnd-kit/sortable'
import type { GlobalPlanning, Chantier, Equipe, TourneeSlot } from '@/lib/data/queries/chantiers'
import type { IndividualMember } from '@/lib/data/queries/members'
import { upsertTourneeSlot, reorderTournee, updateTourneeSlotTravelTimes, duplicateTournee, deletePlanningSlot, upsertTourneeRoute } from '@/lib/data/mutations/planning'
import { optimizeRouteOrder, buildTourneeWithTravel, estimateTravelMin } from './TourneeOptimizer'

import { addDays, addMinutesToTime, durationFromTimes, getLocalDateStr, memberFullName, type AssignableMember, type TourneeMember } from './tourneeModel'

type ModalMode = 'add' | 'edit' | null

export type TourneeProps = {
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
  orgDepartureLatitude?: number | null
  orgDepartureLongitude?: number | null
  routeDepartures?: Record<string, { address: string | null; postal_code: string | null; city: string | null; latitude: number | null; longitude: number | null }>
  onDeclareAbsent?: (memberId: string, memberName: string) => void
}

export function useTournee({  dayPlannings,
  chantiers,
  equipes,
  individualMembers,
  selectedDate,
  onPlanningsChange,
  canManage,
  orgDepartureAddress,
  orgDeparturePostalCode,
  orgDepartureCity,
  orgDepartureLatitude,
  orgDepartureLongitude,
  routeDepartures = {},
  onDeclareAbsent,
}: TourneeProps) {
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
  const [departureLatitude, setDepartureLatitude] = useState<number | null>(null)
  const [departureLongitude, setDepartureLongitude] = useState<number | null>(null)
  const [isSavingDeparture, setIsSavingDeparture] = useState(false)
  const [departureSaved, setDepartureSaved] = useState(false)

  // Optimisation
  const [isOptimizing, setIsOptimizing] = useState(false)

  // Duplication
  const [isDuplicating, setIsDuplicating] = useState(false)

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

  function membersForSlot(slot: TourneeSlot): TourneeMember[] {
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
  const resolvedDepartureLatitude = activeDeparture?.latitude ?? orgDepartureLatitude ?? null
  const resolvedDepartureLongitude = activeDeparture?.longitude ?? orgDepartureLongitude ?? null
  const hasDeparture = !!(resolvedDepartureAddress || resolvedDeparturePostalCode || resolvedDepartureCity)

  function openDepartureEditor() {
    setDepartureAddress(resolvedDepartureAddress)
    setDeparturePostalCode(resolvedDeparturePostalCode)
    setDepartureCity(resolvedDepartureCity)
    setDepartureLatitude(resolvedDepartureLatitude)
    setDepartureLongitude(resolvedDepartureLongitude)
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
      departureLatitude,
      departureLongitude,
    })
    setIsSavingDeparture(false)
    setDepartureSaved(true)
    setShowDepartureEditor(false)
    startTransition(() => { router.refresh() })
  }

  // ── Réordonner ──
  async function moveStop(index: number, delta: -1 | 1) {
    if (!effectiveRouteId) return
    const target = index + delta
    if (target < 0 || target >= routeSlots.length) return
    const reordered = arrayMove(routeSlots, index, target)
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
    // Une tournée ne porte que des créneaux de chantier (jamais d'événement libre).
    if (!slot.chantier_id) return
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
    // Une tournée ne porte que des créneaux de chantier (jamais d'événement libre).
    if (!slot.chantier_id) return
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

  return {
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
    orgDepartureLatitude,
    orgDepartureLongitude,
    routeDepartures,
    onDeclareAbsent,
    router,
    isPending,
    startTransition,
    activeRouteId,
    setActiveRouteId,
    localRouteSlots,
    setLocalRouteSlots,
    pendingNewRouteId,
    setPendingNewRouteId,
    modalMode,
    setModalMode,
    editingSlot,
    setEditingSlot,
    showDuplicateConfirm,
    setShowDuplicateConfirm,
    formChantier,
    setFormChantier,
    formStartTime,
    setFormStartTime,
    formDuration,
    setFormDuration,
    formLabel,
    setFormLabel,
    formTeamSize,
    setFormTeamSize,
    formEquipeId,
    setFormEquipeId,
    formMemberId,
    setFormMemberId,
    formNotes,
    setFormNotes,
    formError,
    setFormError,
    formSaving,
    setFormSaving,
    showDepartureEditor,
    setShowDepartureEditor,
    departureAddress,
    setDepartureAddress,
    departurePostalCode,
    setDeparturePostalCode,
    departureCity,
    setDepartureCity,
    departureLatitude,
    setDepartureLatitude,
    departureLongitude,
    setDepartureLongitude,
    isSavingDeparture,
    setIsSavingDeparture,
    departureSaved,
    setDepartureSaved,
    isOptimizing,
    setIsOptimizing,
    isDuplicating,
    setIsDuplicating,
    routeGroups,
    routeIds,
    freeSlots,
    assignableMembers,
    effectiveRouteId,
    routeSlots,
    summary,
    routeLabel,
    membersForSlot,
    activeDeparture,
    resolvedDepartureAddress,
    resolvedDeparturePostalCode,
    resolvedDepartureCity,
    resolvedDepartureLatitude,
    resolvedDepartureLongitude,
    hasDeparture,
    openDepartureEditor,
    saveDeparture,
    moveStop,
    handleOptimize,
    handleDuplicate,
    handleNewRoute,
    openAddModal,
    openEditModal,
    closeModal,
    handleSubmitModal,
    handleMoveExistingSlotToRoute,
    handleDelete,
  }
}

export type TourneeState = ReturnType<typeof useTournee>
