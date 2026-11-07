'use client'
// @atelier-migrated
// Logique de la page Équipes : équipes, intervenants, comptes de l'application, taux horaires, invitations.

import React, { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import type { Equipe, EquipeMembre } from '@/lib/data/queries/chantiers'
import type { IndividualMember } from '@/lib/data/queries/members'
import type { TeamMember } from '@/lib/data/queries/team'
import type { OrgRole } from '@/lib/data/queries/roles'
import { createEquipe, updateEquipe, deleteEquipe, addEquipeMembre, removeEquipeMembre, updateEquipeMembreTaux, addMembreExistantToEquipe, retirerMembreDeEquipe, updateMembreInfos } from '@/lib/data/mutations/chantiers'
import { createIndividualMember, deleteIndividualMember, sendMemberSpaceInvite } from '@/lib/data/mutations/members'
import { updateMemberLaborRate } from '@/lib/data/mutations/team'

import type { MemberGoal } from '@/lib/data/queries/member-goals'

// ─── Helpers ──────────────────────────────────────────────────────────────────
import { EQUIPE_COLORS, membresDispoForEquipe } from './equipesModel'

export type EquipesProps = {
  equipes: Equipe[]
  soloMembers: IndividualMember[]
  appMembers: TeamMember[]
  orgRoles: OrgRole[]
  canManageTeam: boolean
  canEditRates: boolean
  canEditGoals: boolean
  memberGoals: (MemberGoal & { display_name: string; display_sub: string | null })[]
  currentUserId: string
}

export type MembreModalState = {
  mode: 'new-solo' | 'new-in-equipe' | 'edit'
  equipeId?: string
  membre?: EquipeMembre | IndividualMember
}

export type EquipeModalState = {
  mode: 'create' | 'edit'
  equipe?: Equipe
}

export function useEquipes({ equipes: initialEquipes, soloMembers: initialSolo, appMembers, orgRoles, canManageTeam, canEditRates, canEditGoals, memberGoals, currentUserId }: EquipesProps) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  const [membreModal, setMembreModal] = useState<MembreModalState | null>(null)
  const [equipeModal, setEquipeModal] = useState<EquipeModalState | null>(null)
  const [showAddExistant, setShowAddExistant] = useState<string | null>(null) // equipeId
  const [confirmDelete, setConfirmDelete] = useState<{ type: 'equipe' | 'membre'; id: string; label: string; soloMembre?: boolean } | null>(null)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inviteSent, setInviteSent] = useState<Set<string>>(new Set())
  const inviteTimers = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Formulaire membre
  const [fPrenom, setFPrenom] = useState('')
  const [fName, setFName] = useState('')
  const [fEmail, setFEmail] = useState('')
  const [fRole, setFRole] = useState('')
  const [fTaux, setFTaux] = useState('')
  const [fProfileId, setFProfileId] = useState('')
  const [fSendInvite, setFSendInvite] = useState(false)

  // Formulaire équipe
  const [fEquipeName, setFEquipeName] = useState('')
  const [fEquipeColor, setFEquipeColor] = useState(EQUIPE_COLORS[0])
  const [fEquipeDesc, setFEquipeDesc] = useState('')

  // Ajout membre existant
  const [selectedExistant, setSelectedExistant] = useState('')

  // Edition taux horaire membre app
  const [editingAppMemberId, setEditingAppMemberId] = useState<string | null>(null)
  const [editAppTaux, setEditAppTaux] = useState('')
  const [editAppSaving, setEditAppSaving] = useState(false)
  const [editAppError, setEditAppError] = useState<string | null>(null)
  const [appMembersState, setAppMembersState] = useState<typeof appMembers>(appMembers)

  const startEditAppMember = (m: (typeof appMembers)[number]) => {
    setEditingAppMemberId(m.membership_id)
    setEditAppTaux(m.labor_cost_per_hour != null ? String(m.labor_cost_per_hour) : '')
    setEditAppError(null)
  }

  const cancelEditAppMember = () => {
    setEditingAppMemberId(null)
    setEditAppError(null)
  }

  const saveEditAppMember = async (membershipId: string) => {
    const taux = editAppTaux ? parseFloat(editAppTaux.replace(',', '.')) : null
    if (editAppTaux && (taux === null || isNaN(taux) || taux < 0)) {
      setEditAppError('Taux invalide.')
      return
    }
    setEditAppSaving(true)
    setEditAppError(null)
    const { error: err } = await updateMemberLaborRate(membershipId, taux)
    setEditAppSaving(false)
    if (err) { setEditAppError(err); return }
    setAppMembersState(prev => prev.map(m =>
      m.membership_id === membershipId ? { ...m, labor_cost_per_hour: taux } : m
    ))
    setEditingAppMemberId(null)
  }

  const refresh = () => startTransition(() => router.refresh())

  const membresDispo = (equipeId: string) => membresDispoForEquipe(initialEquipes, initialSolo, equipeId)

  // ── Handlers membres ─────────────────────────────────────────────────────────

  function openNewSolo() {
    if (!canManageTeam) return
    setFPrenom(''); setFName(''); setFEmail(''); setFRole(''); setFTaux(''); setFProfileId(''); setFSendInvite(false)
    setError(null)
    setMembreModal({ mode: 'new-solo' })
  }

  function openNewInEquipe(equipeId: string) {
    if (!canManageTeam) return
    setFPrenom(''); setFName(''); setFEmail(''); setFRole(''); setFTaux(''); setFProfileId(''); setFSendInvite(false)
    setError(null)
    setMembreModal({ mode: 'new-in-equipe', equipeId })
  }

  function openEditMembre(membre: EquipeMembre | IndividualMember) {
    if (!canManageTeam) return
    setFPrenom(membre.prenom ?? '')
    setFName(membre.name)
    setFEmail(membre.email ?? '')
    setFRole(membre.role_label ?? '')
    setFTaux(membre.taux_horaire != null ? String(membre.taux_horaire) : '')
    setFProfileId(membre.profile_id ?? '')
    setFSendInvite(false)
    setError(null)
    setMembreModal({ mode: 'edit', membre })
  }

  async function handleSaveMembre() {
    if (!canManageTeam) return
    if (!fName.trim()) { setError('Le nom est requis.'); return }
    setSaving(true); setError(null)

    const tauxN = parseFloat(fTaux)
    const taux = canEditRates && !isNaN(tauxN) && tauxN > 0 ? tauxN : null
    const profileId = fProfileId || null

    if (membreModal?.mode === 'edit' && membreModal.membre) {
      const { error: e } = await updateMembreInfos(membreModal.membre.id, {
        prenom: fPrenom || null,
        name: fName,
        email: fEmail || null,
        roleLabel: fRole || null,
        ...(canEditRates && { tauxHoraire: taux }),
      })
      if (e) { setError(e); setSaving(false); return }
    } else if (membreModal?.mode === 'new-in-equipe' && membreModal.equipeId) {
      const { error: e } = await addEquipeMembre(membreModal.equipeId, {
        name: fName,
        roleLabel: fRole || null,
        ...(canEditRates && { tauxHoraire: taux }),
        profileId,
      })
      if (e) { setError(e); setSaving(false); return }
    } else {
      const { error: e, id } = await createIndividualMember({
        prenom: fPrenom || null,
        name: fName,
        email: fEmail || null,
        roleLabel: fRole || null,
        ...(canEditRates && { tauxHoraire: taux }),
        linkToProfileId: profileId,
        sendInvite: fSendInvite,
      })
      if (e) { setError(e); setSaving(false); return }
      if (id && fSendInvite) setInviteSent(prev => new Set(prev).add(id))
    }

    setSaving(false)
    setMembreModal(null)
    refresh()
  }

  async function handleDeleteEquipeMembre(id: string) {
    if (!canManageTeam) return
    setSaving(true)
    await removeEquipeMembre(id)
    setSaving(false)
    setConfirmDelete(null)
    refresh()
  }

  async function handleDeleteSoloMembre(id: string) {
    if (!canManageTeam) return
    setSaving(true)
    await deleteIndividualMember(id)
    setSaving(false)
    setConfirmDelete(null)
    refresh()
  }

  async function handleRetirerDeEquipe(membreId: string) {
    if (!canManageTeam) return
    await retirerMembreDeEquipe(membreId)
    refresh()
  }

  async function handleTaux(membreId: string, taux: number | null) {
    if (!canManageTeam || !canEditRates) return
    await updateEquipeMembreTaux(membreId, taux)
    refresh()
  }

  async function handleInvite(membreId: string) {
    if (!canManageTeam) return
    if (inviteSent.has(membreId)) return
    const { error: e } = await sendMemberSpaceInvite(membreId)
    if (e) { setError(e); return }
    setInviteSent(prev => new Set(prev).add(membreId))
    const existing = inviteTimers.current.get(membreId)
    if (existing) clearTimeout(existing)
    const t = setTimeout(() => {
      setInviteSent(prev => { const s = new Set(prev); s.delete(membreId); return s })
      inviteTimers.current.delete(membreId)
    }, 3000)
    inviteTimers.current.set(membreId, t)
  }

  async function handleAddExistant(equipeId: string) {
    if (!canManageTeam) return
    if (!selectedExistant) return
    setSaving(true)
    const { error: e } = await addMembreExistantToEquipe(selectedExistant, equipeId)
    setSaving(false)
    if (e) { setError(e); return }
    setShowAddExistant(null)
    setSelectedExistant('')
    refresh()
  }

  // ── Handlers équipes ─────────────────────────────────────────────────────────

  function openCreateEquipe() {
    if (!canManageTeam) return
    setFEquipeName(''); setFEquipeColor(EQUIPE_COLORS[0]); setFEquipeDesc('')
    setError(null)
    setEquipeModal({ mode: 'create' })
  }

  function openEditEquipe(equipe: Equipe) {
    if (!canManageTeam) return
    setFEquipeName(equipe.name)
    setFEquipeColor(equipe.color)
    setFEquipeDesc(equipe.description ?? '')
    setError(null)
    setEquipeModal({ mode: 'edit', equipe })
  }

  async function handleSaveEquipe() {
    if (!canManageTeam) return
    if (!fEquipeName.trim()) { setError("Le nom de l'équipe est requis."); return }
    setSaving(true); setError(null)

    if (equipeModal?.mode === 'edit' && equipeModal.equipe) {
      const { error: e } = await updateEquipe(equipeModal.equipe.id, {
        name: fEquipeName,
        color: fEquipeColor,
        description: fEquipeDesc || null,
      })
      if (e) { setError(e); setSaving(false); return }
    } else {
      const { error: e } = await createEquipe({ name: fEquipeName, color: fEquipeColor, description: fEquipeDesc || null })
      if (e) { setError(e); setSaving(false); return }
    }

    setSaving(false)
    setEquipeModal(null)
    refresh()
  }

  async function handleDeleteEquipe(equipeId: string) {
    if (!canManageTeam) return
    setSaving(true)
    const { error: e } = await deleteEquipe(equipeId)
    setSaving(false)
    if (e) { setError(e); setConfirmDelete(null); return }
    setConfirmDelete(null)
    refresh()
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const totalIntervenants = initialEquipes.reduce((s, e) => s + e.membres.length, 0) + initialSolo.length

  return {
    initialEquipes,
    initialSolo,
    appMembers,
    orgRoles,
    canManageTeam,
    canEditRates,
    canEditGoals,
    memberGoals,
    currentUserId,
    router,
    startTransition,
    membreModal,
    setMembreModal,
    equipeModal,
    setEquipeModal,
    showAddExistant,
    setShowAddExistant,
    confirmDelete,
    setConfirmDelete,
    saving,
    setSaving,
    error,
    setError,
    inviteSent,
    setInviteSent,
    inviteTimers,
    fPrenom,
    setFPrenom,
    fName,
    setFName,
    fEmail,
    setFEmail,
    fRole,
    setFRole,
    fTaux,
    setFTaux,
    fProfileId,
    setFProfileId,
    fSendInvite,
    setFSendInvite,
    fEquipeName,
    setFEquipeName,
    fEquipeColor,
    setFEquipeColor,
    fEquipeDesc,
    setFEquipeDesc,
    selectedExistant,
    setSelectedExistant,
    editingAppMemberId,
    setEditingAppMemberId,
    editAppTaux,
    setEditAppTaux,
    editAppSaving,
    setEditAppSaving,
    editAppError,
    setEditAppError,
    appMembersState,
    setAppMembersState,
    startEditAppMember,
    cancelEditAppMember,
    saveEditAppMember,
    refresh,
    membresDispo,
    openNewSolo,
    openNewInEquipe,
    openEditMembre,
    handleSaveMembre,
    handleDeleteEquipeMembre,
    handleDeleteSoloMembre,
    handleRetirerDeEquipe,
    handleTaux,
    handleInvite,
    handleAddExistant,
    openCreateEquipe,
    openEditEquipe,
    handleSaveEquipe,
    handleDeleteEquipe,
    totalIntervenants,
  }
}

export type EquipesState = ReturnType<typeof useEquipes>
