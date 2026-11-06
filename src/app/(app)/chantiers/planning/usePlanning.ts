'use client'
// @atelier-migrated
// Logique du planning global : vue, filtres, création, duplication, absence, assistante. L'affichage vit dans PlanningGlobalClient.tsx.

import { useState, useMemo, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'

import type { GlobalPlanning, Chantier, Equipe } from '@/lib/data/queries/chantiers'
import type { IndividualMember } from '@/lib/data/queries/members'

import { planWeekWithAI, createPlanningSlot, createPlanningSlots, createMaintenancePlanningSlots, createAITournee, deletePlanningEntry, duplicatePlanningEntry, duplicatePlanningRange } from '@/lib/data/mutations/planning'
import type { AIPlanningDeletion, AIPlanningSlot, AIUnknownPerson, AITour, PlanningEventType } from '@/lib/data/mutations/planning'
import { createIndividualMember } from '@/lib/data/mutations/members'
import { declareMemberAbsence, type ConflictingSlot } from '@/lib/data/mutations/absences'
import { todayParis } from '@/lib/utils'

// ─── Palette de couleurs (12 couleurs pour les chantiers) ────────────────────
import { getMonday, getLocalDateStr, dateFromYmd, sIsChantierSlot } from './planningModel'

// ─── Props ───────────────────────────────────────────────────────────────────

export type PlanningProps = {
  initialPlannings: GlobalPlanning[]
  chantiers: Chantier[]
  equipes: Equipe[]
  individualMembers: IndividualMember[]
  planningAiEnabled: boolean
  orgId: string | null
  icalToken: string | null
  canManage: boolean
  orgDepartureAddress?: string | null
  orgDeparturePostalCode?: string | null
  orgDepartureCity?: string | null
  orgDepartureLatitude?: number | null
  orgDepartureLongitude?: number | null
  routeDepartures?: Record<string, { address: string | null; postal_code: string | null; city: string | null; latitude: number | null; longitude: number | null }>
}

export function usePlanning({initialPlannings, chantiers, equipes, individualMembers, planningAiEnabled, orgId, icalToken, canManage, orgDepartureAddress, orgDeparturePostalCode, orgDepartureCity, orgDepartureLatitude, orgDepartureLongitude, routeDepartures = {}}: PlanningProps) {
  const router = useRouter()

  // State
  const [plannings, setPlannings] = useState(initialPlannings)
  
  const [selectedDate, setSelectedDate] = useState(() => dateFromYmd(todayParis()))
  const weekStart = useMemo(() => getMonday(selectedDate), [selectedDate])

  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const [viewMode, setViewMode] = useState<'jour' | 'semaine' | 'liste' | 'tournee' | null>(null)
  const effectiveView = viewMode ?? (isMobile ? 'jour' : 'semaine')

  const [filterChantier, setFilterChantier] = useState<string>('tous')
  const [filterStatus, setFilterStatus] = useState<string>('tous')

  const [showIcalModal, setShowIcalModal] = useState(false)
  const [icalCopied, setIcalCopied] = useState(false)

  const icalUrl = orgId && icalToken
    ? `${typeof window !== 'undefined' ? window.location.origin : process.env.NEXT_PUBLIC_APP_URL ?? ''}/api/planning/ical?orgId=${orgId}&token=${icalToken}`
    : null

  const webcalUrl = icalUrl ? icalUrl.replace(/^https?:\/\//, 'webcal://') : null

  function copyIcalUrl() {
    if (!icalUrl) return
    navigator.clipboard.writeText(icalUrl).then(() => {
      setIcalCopied(true)
      setTimeout(() => setIcalCopied(false), 2000)
    })
  }

  // ─── Agent IA ────────────────────────────────────────────────────────────────
  const [aiModalOpen, setAiModalOpen] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiStatus, setAiStatus] = useState<'idle' | 'loading' | 'new_member' | 'preview' | 'saving' | 'done' | 'error'>('idle')
  const [planningBriefBanner, setPlanningBriefBanner] = useState<string | null>(null)
  const [sarahInfoBanner, setSarahInfoBanner] = useState<string | null>(null)
  // Fenêtre courte pendant laquelle on vérifie un brief Sarah en attente : évite
  // que le modal de planification s'ouvre "brusquement" sans aucun signal avant coup.
  const [checkingSarahBrief, setCheckingSarahBrief] = useState(false)
  const [aiSlots, setAiSlots] = useState<AIPlanningSlot[]>([])
  const [aiDeletions, setAiDeletions] = useState<AIPlanningDeletion[]>([])
  const [aiTours, setAiTours] = useState<AITour[]>([])
  const [aiUnknownPeople, setAiUnknownPeople] = useState<AIUnknownPerson[]>([])
  const [aiSummary, setAiSummary] = useState('')
  const [aiError, setAiError] = useState('')
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false)
  const [duplicateTargetDate, setDuplicateTargetDate] = useState('')
  const [duplicateSlot, setDuplicateSlot] = useState<GlobalPlanning | null>(null)
  const [duplicateLoading, setDuplicateLoading] = useState(false)
  const [duplicateError, setDuplicateError] = useState<string | null>(null)

  // ─── Déclaration d'absence ─────────────────────────────────────────────────
  const [absenceModalOpen, setAbsenceModalOpen] = useState(false)
  const [absenceMemberId, setAbsenceMemberId] = useState<string | null>(null)
  const [absenceMemberName, setAbsenceMemberName] = useState('')
  const [absenceStartDate, setAbsenceStartDate] = useState('')
  const [absenceEndDate, setAbsenceEndDate] = useState('')
  const [absenceReason, setAbsenceReason] = useState('')
  const [absenceLoading, setAbsenceLoading] = useState(false)
  const [absenceError, setAbsenceError] = useState<string | null>(null)
  const [absenceConflicts, setAbsenceConflicts] = useState<ConflictingSlot[] | null>(null)
  const [absencePickMember, setAbsencePickMember] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  // ─── Création manuelle d'un créneau (sans IA) ──────────────────────────────
  const [newSlotModalOpen, setNewSlotModalOpen] = useState(false)
  const [newSlotEventType, setNewSlotEventType] = useState<PlanningEventType>('chantier')
  const [newSlotChantierId, setNewSlotChantierId] = useState('')
  const [newSlotTitle, setNewSlotTitle] = useState('')
  const [newSlotDate, setNewSlotDate] = useState('')
  const [newSlotStartTime, setNewSlotStartTime] = useState('08:00')
  const [newSlotEndTime, setNewSlotEndTime] = useState('12:00')
  const [newSlotAssigneeType, setNewSlotAssigneeType] = useState<'membre' | 'equipe'>('membre')
  const [newSlotMemberId, setNewSlotMemberId] = useState('')
  const [newSlotEquipeId, setNewSlotEquipeId] = useState('')
  const [newSlotLabel, setNewSlotLabel] = useState('')
  const [newSlotLoading, setNewSlotLoading] = useState(false)
  const [newSlotError, setNewSlotError] = useState<string | null>(null)

  function openNewSlotModal(prefillDate?: Date) {
    setNewSlotEventType('chantier')
    setNewSlotChantierId(chantiers[0]?.id ?? '')
    setNewSlotTitle('')
    setNewSlotDate(getLocalDateStr(prefillDate ?? selectedDate))
    setNewSlotStartTime('08:00')
    setNewSlotEndTime('12:00')
    setNewSlotAssigneeType('membre')
    setNewSlotMemberId(individualMembers[0]?.id ?? '')
    setNewSlotEquipeId(equipes[0]?.id ?? '')
    setNewSlotLabel('')
    setNewSlotError(null)
    setNewSlotModalOpen(true)
  }

  function closeNewSlotModal() {
    setNewSlotModalOpen(false)
  }

  async function handleCreateSlotConfirm() {
    const isFreeEvent = newSlotEventType !== 'chantier'
    if (isFreeEvent ? !newSlotTitle.trim() : !newSlotChantierId) return
    if (!newSlotDate) return
    const assigneeName = newSlotAssigneeType === 'membre'
      ? (() => {
          const m = individualMembers.find(mm => mm.id === newSlotMemberId)
          return m ? [m.prenom, m.name].filter(Boolean).join(' ') : ''
        })()
      : (equipes.find(e => e.id === newSlotEquipeId)?.name ?? '')
    const chantierTitle = chantiers.find(c => c.id === newSlotChantierId)?.title ?? ''
    const label = newSlotLabel.trim() || assigneeName || (isFreeEvent ? newSlotTitle.trim() : chantierTitle)
    if (!label) { setNewSlotError('Choisissez un membre, une équipe, ou saisissez un libellé.'); return }

    setNewSlotLoading(true)
    setNewSlotError(null)
    const result = await createPlanningSlot({
      chantierId: isFreeEvent ? null : newSlotChantierId,
      eventType: newSlotEventType,
      title: isFreeEvent ? newSlotTitle.trim() : null,
      plannedDate: newSlotDate,
      startTime: newSlotStartTime || null,
      endTime: newSlotEndTime || null,
      label,
      memberId: newSlotAssigneeType === 'membre' ? (newSlotMemberId || null) : null,
      equipeId: newSlotAssigneeType === 'equipe' ? (newSlotEquipeId || null) : null,
    })
    setNewSlotLoading(false)
    if (result.error) { setNewSlotError(result.error); return }
    setNewSlotModalOpen(false)
    router.refresh()
  }

  // Modale nouveau membre
  const [newMemberQueue, setNewMemberQueue] = useState<AIUnknownPerson[]>([])
  const [newMemberCurrent, setNewMemberCurrent] = useState<AIUnknownPerson | null>(null)
  const [newMemberPrenom, setNewMemberPrenom] = useState('')
  const [newMemberNom, setNewMemberNom] = useState('')
  const [newMemberEmail, setNewMemberEmail] = useState('')
  const [newMemberTaux, setNewMemberTaux] = useState('')
  const [newMemberSaving, setNewMemberSaving] = useState(false)
  const [newMemberError, setNewMemberError] = useState('')

  const [, startTransition] = useTransition()

  useEffect(() => {
    setPlannings(initialPlannings)
  }, [initialPlannings])

  // Brief laissé par Sarah pour le planning : deux natures très différentes.
  // - kind 'info' : Sarah a DÉJÀ agi (absence déclarée, créneau modifié...).
  //   Simple bandeau d'information sur la page — surtout pas le modal de
  //   génération, qui laissait croire qu'il restait quelque chose à générer.
  // - brief de planification réel : ouvrir le modal de planification pré-rempli.
  useEffect(() => {
    if (!planningAiEnabled) return
    setCheckingSarahBrief(true)
    fetch('/api/sarah/briefs?target=planning')
      .then(r => r.json())
      .then(({ brief }: { brief: { id: string; payload: { kind?: string; description?: string; chantier_title?: string } } | null }) => {
        if (!brief?.payload?.description?.trim()) return
        const desc = brief.payload.description.trim()
        if (brief.payload.kind === 'info') {
          setSarahInfoBanner(desc)
        } else {
          const chantierHint = brief.payload.chantier_title ? ` pour "${brief.payload.chantier_title}"` : ''
          setAiPrompt(desc)
          setPlanningBriefBanner(`Brief transmis par Sarah${chantierHint}.`)
          setAiModalOpen(true)
        }
        fetch('/api/sarah/briefs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ briefId: brief.id }),
        }).catch(() => {})
      })
      .catch(() => {})
      .finally(() => setCheckingSarahBrief(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function openAiModal() {
    if (!planningAiEnabled) return
    setAiPrompt('')
    setAiStatus('idle')
    setAiSlots([])
    setAiDeletions([])
    setAiTours([])
    setAiUnknownPeople([])
    setAiSummary('')
    setAiError('')
    setNewMemberQueue([])
    setNewMemberCurrent(null)
    setAiModalOpen(true)
  }

  async function handleAiGenerate() {
    if (!aiPrompt.trim()) return
    setAiStatus('loading')
    setAiError('')
    const weekDateStr = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`
    const result = await planWeekWithAI(aiPrompt, weekDateStr)
    if (result.error || (!result.slots.length && !result.deletions.length && !result.unknownPeople.length)) {
      setAiError(result.error ?? 'Aucune action détectée. Reformulez votre demande.')
      setAiStatus('error')
      return
    }
    setAiSlots(result.slots)
    setAiDeletions(result.deletions)
    setAiTours(result.tours)
    setAiUnknownPeople(result.unknownPeople)
    setAiSummary(result.summary)

    // Si des noms inconnus existent, lancer le flow d'ajout avant la preview
    if (result.unknownPeople.length > 0) {
      setNewMemberQueue(result.unknownPeople.slice(1))
      startNewMemberFlow(result.unknownPeople[0])
      return
    }
    setAiStatus('preview')
  }

  function startNewMemberFlow(person: AIUnknownPerson) {
    const parts = person.name.trim().split(/\s+/)
    setNewMemberPrenom(parts[0] ?? '')
    setNewMemberNom(parts.slice(1).join(' '))
    setNewMemberEmail('')
    setNewMemberTaux('')
    setNewMemberError('')
    setNewMemberCurrent(person)
    setAiStatus('new_member')
  }

  async function handleNewMemberSave() {
    if (!newMemberNom.trim() && !newMemberPrenom.trim()) return
    setNewMemberSaving(true)
    setNewMemberError('')
    const result = await createIndividualMember({
      prenom: newMemberPrenom.trim() || null,
      name: (newMemberNom.trim() || newMemberPrenom.trim()),
      email: newMemberEmail.trim() || null,
      tauxHoraire: newMemberTaux ? parseFloat(newMemberTaux) : null,
    })
    setNewMemberSaving(false)
    if (result.error) {
      setNewMemberError(result.error)
      return
    }
    advanceNewMemberQueue()
  }

  function handleNewMemberSkip() {
    advanceNewMemberQueue()
  }

  function advanceNewMemberQueue() {
    setNewMemberCurrent(null)
    if (newMemberQueue.length > 0) {
      const [next, ...rest] = newMemberQueue
      setNewMemberQueue(rest)
      startNewMemberFlow(next)
    } else {
      setAiStatus('preview')
    }
  }

  function openDuplicateWeek() {
    const target = new Date(weekStart)
    target.setDate(target.getDate() + 7)
    setDuplicateSlot(null)
    setDuplicateTargetDate(getLocalDateStr(target))
    setDuplicateError(null)
    setDuplicateModalOpen(true)
  }

  function openDuplicateSlot(slot: GlobalPlanning) {
    const target = dateFromYmd(slot.planned_date)
    target.setDate(target.getDate() + 7)
    setDuplicateSlot(slot)
    setDuplicateTargetDate(getLocalDateStr(target))
    setDuplicateError(null)
    setDuplicateModalOpen(true)
  }

  async function handleDuplicateConfirm() {
    if (!duplicateTargetDate) return
    setDuplicateLoading(true)
    setDuplicateError(null)
    const result = duplicateSlot
      ? await duplicatePlanningEntry(duplicateSlot.id, duplicateTargetDate)
      : await duplicatePlanningRange(getLocalDateStr(weekStart), getLocalDateStr(days[days.length - 1] ?? weekStart), duplicateTargetDate)
    setDuplicateLoading(false)
    if (result.error) {
      setDuplicateError(result.error)
      return
    }
    setDuplicateModalOpen(false)
    setDuplicateSlot(null)
    router.refresh()
  }

  // memberId vide = ouverture depuis la barre d'outils : le membre se choisit
  // dans le modal (parcours sans IA).
  function openAbsenceModal(memberId: string, memberName: string) {
    const today = getLocalDateStr(new Date())
    setAbsencePickMember(!memberId)
    setAbsenceMemberId(memberId || null)
    setAbsenceMemberName(memberName)
    setAbsenceStartDate(today)
    setAbsenceEndDate(today)
    setAbsenceReason('')
    setAbsenceError(null)
    setAbsenceConflicts(null)
    setAbsenceModalOpen(true)
  }

  function closeAbsenceModal() {
    setAbsenceModalOpen(false)
    setAbsenceMemberId(null)
    setAbsenceConflicts(null)
  }

  async function handleDeclareAbsenceConfirm() {
    if (!absenceMemberId || !absenceStartDate || !absenceEndDate) return
    setAbsenceLoading(true)
    setAbsenceError(null)
    const result = await declareMemberAbsence({
      memberId: absenceMemberId,
      startDate: absenceStartDate,
      endDate: absenceEndDate,
      reason: absenceReason || null,
    })
    setAbsenceLoading(false)
    if (result.error) {
      setAbsenceError(result.error)
      return
    }
    setAbsenceConflicts(result.conflictingSlots ?? [])
    router.refresh()
  }

  async function handleAiConfirm() {
    setAiStatus('saving')
    startTransition(async () => {
      let error: string | null = null

      for (const deletion of aiDeletions) {
        const result = await deletePlanningEntry(deletion.id)
        if (result.error) { error = result.error; break }
      }

      if (!error) {
        // Indices des slots qui font partie d'une tournée
        const tourSlotIndices = new Set(
          aiTours.flatMap(t => t.slotIndices).filter(i => aiSlots[i]?.source !== 'maintenance' && !aiSlots[i]?.maintenanceContractId)
        )

        // Créer les tournées IA (les slots qu'elles contiennent)
        for (const tour of aiTours) {
          if (error) break
          const tourSlots = tour.slotIndices.map(i => aiSlots[i]).filter(s => s && s.source !== 'maintenance' && !s.maintenanceContractId)
          if (tourSlots.length < 2) continue
          const result = await createAITournee(
            tourSlots.map(s => ({
              chantierId: s.chantierId,
              plannedDate: s.plannedDate,
              startTime: s.startTime,
              endTime: s.endTime,
              label: s.label,
              teamSize: s.teamSize,
              notes: s.notes,
              equipeId: s.equipeId ?? null,
              memberId: s.memberId ?? null,
            })),
            tour.date,
            orgDepartureAddress ?? null,
            orgDeparturePostalCode ?? null,
            orgDepartureCity ?? null,
          )
          if (result.error) error = result.error
        }

        // Créer les slots hors tournée
        const standaloneSlots = aiSlots.filter((_, i) => !tourSlotIndices.has(i) && sIsChantierSlot(aiSlots[i]))
        if (!error && standaloneSlots.length > 0) {
          const result = await createPlanningSlots(standaloneSlots.map(s => ({
            chantierId: s.chantierId,
            plannedDate: s.plannedDate,
            startTime: s.startTime,
            endTime: s.endTime,
            label: s.label,
            teamSize: s.teamSize,
            notes: s.notes,
            equipeId: s.equipeId ?? null,
            memberId: s.memberId ?? null,
          })))
          if (result.error) error = result.error
        }

        const maintenanceSlots = aiSlots.filter(s => s.source === 'maintenance' || s.maintenanceContractId)
        if (!error && maintenanceSlots.length > 0) {
          const result = await createMaintenancePlanningSlots(maintenanceSlots.flatMap(s => (
            s.maintenanceContractId
              ? [{
                  maintenanceContractId: s.maintenanceContractId,
                  plannedDate: s.plannedDate,
                  startTime: s.startTime,
                  endTime: s.endTime,
                  label: s.label,
                  notes: s.notes,
                  memberId: s.memberId ?? null,
                }]
              : []
          )))
          if (result.error) error = result.error
        }
      }

      if (error) {
        setAiError(error)
        setAiStatus('error')
      } else {
        setPlannings(prev => prev.filter(p => !aiDeletions.some(d => d.id === p.id)))
        setAiStatus('done')
        setTimeout(() => { setAiModalOpen(false); router.refresh() }, 1200)
      }
    })
  }

  async function handleDeletePlanning(planning: GlobalPlanning) {
    setPlannings(prev => prev.filter(p => p.id !== planning.id))
    const { error } = await deletePlanningEntry(planning.id)
    if (error) {
      setPlannings(prev => [...prev, planning].sort((a, b) =>
        a.planned_date.localeCompare(b.planned_date) || (a.start_time ?? '').localeCompare(b.start_time ?? '')
      ))
      setActionError(error)
      return
    }
    router.refresh()
  }

  // Valeurs dérivées
  const isSingleDay = effectiveView === 'jour' || effectiveView === 'tournee' || (effectiveView === 'semaine' && isMobile)
  const days = Array.from({ length: isSingleDay ? 1 : 7 }, (_, i) => {
    const d = new Date(isSingleDay ? selectedDate : weekStart)
    if (!isSingleDay) {
      d.setDate(weekStart.getDate() + i)
    }
    return d
  })
  const todayStr = todayParis()
  const weekDates = days.map(getLocalDateStr)

  const filteredPlannings = useMemo(
    () =>
      plannings.filter(p => {
        if (filterChantier !== 'tous' && p.chantier_id !== filterChantier) return false
        if (filterStatus !== 'tous' && p.chantier_status !== filterStatus) return false
        return true
      }),
    [plannings, filterChantier, filterStatus]
  )

  const weekPlannings = useMemo(
    () => filteredPlannings.filter(p => weekDates.includes(p.planned_date)),
    [filteredPlannings, weekDates]
  )

  // Stats pour la semaine courante
  const weekStats = useMemo(() => {
    const chantiersIds = new Set(weekPlannings.map(p => p.chantier_id))
    const totalPersonnes = weekPlannings.reduce((s, p) => s + p.team_size, 0)
    const byDayCount = weekPlannings.reduce<Record<string, number>>((acc, p) => {
      acc[p.planned_date] = (acc[p.planned_date] ?? 0) + p.team_size
      return acc
    }, {})
    const jourLePlusCharge = Object.entries(byDayCount).sort(([, a], [, b]) => b - a)[0]
    return { chantiersActifs: chantiersIds.size, totalPersonnes, jourLePlusCharge }
  }, [weekPlannings])

  const byDay = useMemo(
    () =>
      weekPlannings.reduce<Record<string, GlobalPlanning[]>>((acc, p) => {
        acc[p.planned_date] = [...(acc[p.planned_date] ?? []), p]
        return acc
      }, {}),
    [weekPlannings]
  )

  // Chantiers uniques dans la semaine (pour la légende) — les événements
  // libres (sans chantier) n'ont pas leur place dans une légende par chantier.
  const uniqueChantiers = useMemo(() => {
    const seen = new Set<string>()
    return weekPlannings.filter((p): p is typeof p & { chantier_id: string } => {
      if (!p.chantier_id) return false
      if (seen.has(p.chantier_id)) return false
      seen.add(p.chantier_id)
      return true
    })
  }, [weekPlannings])

  // Navigation semaine
  const prevDate = () => {
    const d = new Date(selectedDate)
    d.setDate(d.getDate() - (isSingleDay ? 1 : 7))
    setSelectedDate(d)
  }
  const nextDate = () => {
    const d = new Date(selectedDate)
    d.setDate(d.getDate() + (isSingleDay ? 1 : 7))
    setSelectedDate(d)
  }
  const goToday = () => setSelectedDate(dateFromYmd(todayParis()))

  // Heure actuelle pour la ligne rouge
  const now = new Date()
  const nowH = now.getHours() + now.getMinutes() / 60

  // Jour le plus chargé - libellé lisible
  const jourLePlusChargeLabel = useMemo(() => {
    if (!weekStats.jourLePlusCharge) return '/'
    const [dateStr] = weekStats.jourLePlusCharge
    try {
      return new Date(dateStr + 'T12:00:00').toLocaleDateString('fr-FR', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      })
    } catch {
      return dateStr
    }
  }, [weekStats.jourLePlusCharge])

  return {
    initialPlannings,
    chantiers,
    equipes,
    individualMembers,
    planningAiEnabled,
    orgId,
    icalToken,
    canManage,
    orgDepartureAddress,
    orgDeparturePostalCode,
    orgDepartureCity,
    orgDepartureLatitude,
    orgDepartureLongitude,
    routeDepartures,
    router,
    plannings,
    setPlannings,
    selectedDate,
    setSelectedDate,
    weekStart,
    isMobile,
    setIsMobile,
    viewMode,
    setViewMode,
    effectiveView,
    filterChantier,
    setFilterChantier,
    filterStatus,
    setFilterStatus,
    showIcalModal,
    setShowIcalModal,
    icalCopied,
    setIcalCopied,
    icalUrl,
    webcalUrl,
    copyIcalUrl,
    aiModalOpen,
    setAiModalOpen,
    aiPrompt,
    setAiPrompt,
    aiStatus,
    setAiStatus,
    planningBriefBanner,
    setPlanningBriefBanner,
    sarahInfoBanner,
    setSarahInfoBanner,
    checkingSarahBrief,
    setCheckingSarahBrief,
    aiSlots,
    setAiSlots,
    aiDeletions,
    setAiDeletions,
    aiTours,
    setAiTours,
    aiUnknownPeople,
    setAiUnknownPeople,
    aiSummary,
    setAiSummary,
    aiError,
    setAiError,
    duplicateModalOpen,
    setDuplicateModalOpen,
    duplicateTargetDate,
    setDuplicateTargetDate,
    duplicateSlot,
    setDuplicateSlot,
    duplicateLoading,
    setDuplicateLoading,
    duplicateError,
    setDuplicateError,
    absenceModalOpen,
    setAbsenceModalOpen,
    absenceMemberId,
    setAbsenceMemberId,
    absenceMemberName,
    setAbsenceMemberName,
    absenceStartDate,
    setAbsenceStartDate,
    absenceEndDate,
    setAbsenceEndDate,
    absenceReason,
    setAbsenceReason,
    absenceLoading,
    setAbsenceLoading,
    absenceError,
    setAbsenceError,
    absenceConflicts,
    setAbsenceConflicts,
    absencePickMember,
    setAbsencePickMember,
    actionError,
    setActionError,
    newSlotModalOpen,
    setNewSlotModalOpen,
    newSlotEventType,
    setNewSlotEventType,
    newSlotChantierId,
    setNewSlotChantierId,
    newSlotTitle,
    setNewSlotTitle,
    newSlotDate,
    setNewSlotDate,
    newSlotStartTime,
    setNewSlotStartTime,
    newSlotEndTime,
    setNewSlotEndTime,
    newSlotAssigneeType,
    setNewSlotAssigneeType,
    newSlotMemberId,
    setNewSlotMemberId,
    newSlotEquipeId,
    setNewSlotEquipeId,
    newSlotLabel,
    setNewSlotLabel,
    newSlotLoading,
    setNewSlotLoading,
    newSlotError,
    setNewSlotError,
    openNewSlotModal,
    closeNewSlotModal,
    handleCreateSlotConfirm,
    newMemberQueue,
    setNewMemberQueue,
    newMemberCurrent,
    setNewMemberCurrent,
    newMemberPrenom,
    setNewMemberPrenom,
    newMemberNom,
    setNewMemberNom,
    newMemberEmail,
    setNewMemberEmail,
    newMemberTaux,
    setNewMemberTaux,
    newMemberSaving,
    setNewMemberSaving,
    newMemberError,
    setNewMemberError,
    startTransition,
    openAiModal,
    handleAiGenerate,
    startNewMemberFlow,
    handleNewMemberSave,
    handleNewMemberSkip,
    advanceNewMemberQueue,
    openDuplicateWeek,
    openDuplicateSlot,
    handleDuplicateConfirm,
    openAbsenceModal,
    closeAbsenceModal,
    handleDeclareAbsenceConfirm,
    handleAiConfirm,
    handleDeletePlanning,
    isSingleDay,
    days,
    todayStr,
    weekDates,
    filteredPlannings,
    weekPlannings,
    weekStats,
    byDay,
    uniqueChantiers,
    prevDate,
    nextDate,
    goToday,
    now,
    nowH,
    jourLePlusChargeLabel,
  }
}

export type PlanningState = ReturnType<typeof usePlanning>
