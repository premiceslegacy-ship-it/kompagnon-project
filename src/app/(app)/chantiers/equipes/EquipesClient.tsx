'use client'

import React, { useState, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  Users, UserPlus, Plus, Pencil, Trash2, X, Loader2,
  ChevronRight, Mail, Euro, Shield, UserCheck, UserMinus,
  HardHat, Check, ArrowLeft,
} from 'lucide-react'
import type { Equipe, EquipeMembre } from '@/lib/data/queries/chantiers'
import type { IndividualMember } from '@/lib/data/queries/members'
import type { TeamMember } from '@/lib/data/queries/team'
import {
  createEquipe, updateEquipe, deleteEquipe,
  addEquipeMembre, removeEquipeMembre, updateEquipeMembreTaux,
  addMembreExistantToEquipe, retirerMembreDeEquipe, updateMembreInfos,
} from '@/lib/data/mutations/chantiers'
import { createIndividualMember, deleteIndividualMember, sendMemberSpaceInvite } from '@/lib/data/mutations/members'
import { updateMemberLaborRate } from '@/lib/data/mutations/team'
import MemberGoalsSettings from '@/app/(app)/settings/MemberGoalsSettings'
import type { MemberGoal } from '@/lib/data/queries/member-goals'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fullName(m: { prenom?: string | null; name: string }): string {
  return [m.prenom, m.name].filter(Boolean).join(' ')
}

function initials(m: { prenom?: string | null; name: string }): string {
  const f = m.prenom?.[0] ?? ''
  const l = m.name?.[0] ?? ''
  return (f + l).toUpperCase() || '?'
}

const EQUIPE_COLORS = [
  '#6366f1', '#3b82f6', '#10b981', '#f59e0b',
  '#a855f7', '#f43f5e', '#14b8a6', '#f97316',
  '#0ea5e9', '#84cc16', '#ec4899', '#06b6d4',
]

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  equipes: Equipe[]
  soloMembers: IndividualMember[]
  appMembers: TeamMember[]
  canManageTeam: boolean
  canEditRates: boolean
  canEditGoals: boolean
  memberGoals: (MemberGoal & { display_name: string; display_sub: string | null })[]
  currentUserId: string
}

type MembreModalState = {
  mode: 'new-solo' | 'new-in-equipe' | 'edit'
  equipeId?: string
  membre?: EquipeMembre | IndividualMember
}

type EquipeModalState = {
  mode: 'create' | 'edit'
  equipe?: Equipe
}

// ─── Sous-composants ──────────────────────────────────────────────────────────

function TauxBadge({
  taux, onSave, disabled,
}: { taux: number | null; onSave: (v: number | null) => void; disabled?: boolean }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(taux != null ? String(taux) : '')

  if (!editing) {
    return (
      <button
        onClick={() => !disabled && setEditing(true)}
        className="flex items-center gap-1 rounded-md border border-[var(--elevation-border)] bg-interactive px-2 py-0.5 text-xs font-medium text-secondary transition-colors hover:border-accent hover:text-primary dark:bg-white/[0.04]"
        title="Modifier le taux horaire"
      >
        <Euro className="h-3 w-3" />
        {taux != null ? `${taux} €/h` : 'Taux —'}
      </button>
    )
  }

  return (
    <form
      onSubmit={e => {
        e.preventDefault()
        const n = parseFloat(val)
        onSave(isNaN(n) || n <= 0 ? null : n)
        setEditing(false)
      }}
      className="flex items-center gap-1"
    >
      <input
        autoFocus
        type="number"
        min={0}
        step={0.5}
        value={val}
        onChange={e => setVal(e.target.value)}
        className="w-20 rounded-md border border-accent bg-interactive px-2 py-0.5 text-xs text-primary focus:outline-none dark:bg-white/[0.06]"
        placeholder="€/h"
      />
      <button type="submit" className="p-1 rounded text-emerald-500 hover:bg-emerald-500/10 transition-colors">
        <Check className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={() => setEditing(false)} className="p-1 rounded text-secondary hover:bg-interactive transition-colors">
        <X className="h-3.5 w-3.5" />
      </button>
    </form>
  )
}

// ─── Composant principal ──────────────────────────────────────────────────────

export default function EquipesClient({ equipes: initialEquipes, soloMembers: initialSolo, appMembers, canManageTeam, canEditRates, canEditGoals, memberGoals, currentUserId }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  const [membreModal, setMembreModal] = useState<MembreModalState | null>(null)
  const [equipeModal, setEquipeModal] = useState<EquipeModalState | null>(null)
  const [showAddExistant, setShowAddExistant] = useState<string | null>(null) // equipeId
  const [confirmDelete, setConfirmDelete] = useState<{ type: 'equipe' | 'membre'; id: string; label: string } | null>(null)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inviteSent, setInviteSent] = useState<Set<string>>(new Set())

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

  // Membres disponibles pour "ajouter existant" : soloMembers + membres d'autres équipes
  function membresDispoForEquipe(equipeId: string): Array<IndividualMember | EquipeMembre & { equipe_name?: string }> {
    const inThisEquipe = new Set(
      initialEquipes.find(e => e.id === equipeId)?.membres.map(m => m.id) ?? [],
    )
    const soloOk = initialSolo.filter(m => !inThisEquipe.has(m.id))
    const autresEquipes = initialEquipes
      .filter(e => e.id !== equipeId)
      .flatMap(e => e.membres.map(m => ({ ...m, equipe_name: e.name })))
      .filter(m => !inThisEquipe.has(m.id))
    return [...soloOk, ...autresEquipes]
  }

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

  async function handleDeleteMembre(id: string) {
    if (!canManageTeam) return
    setSaving(true)
    await deleteIndividualMember(id)
    setSaving(false)
    setConfirmDelete(null)
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
    const { error: e } = await sendMemberSpaceInvite(membreId)
    if (!e) setInviteSent(prev => new Set(prev).add(membreId))
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
    await deleteEquipe(equipeId)
    setSaving(false)
    setConfirmDelete(null)
    refresh()
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const totalIntervenants = initialEquipes.reduce((s, e) => s + e.membres.length, 0) + initialSolo.length

  return (
    <div className="page-container space-y-6" style={{ maxWidth: '72rem' }}>

      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => router.back()}
          className="p-2 rounded-lg hover:bg-[var(--elevation-1)] text-secondary hover:text-primary transition-colors border border-[var(--elevation-border)] flex-shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl font-extrabold text-primary flex items-center gap-2">
            <Users className="w-5 h-5 sm:w-6 sm:h-6 text-accent flex-shrink-0" />
            Équipes & Intervenants
          </h1>
          <p className="text-sm text-secondary mt-0.5">
            {totalIntervenants} intervenant{totalIntervenants > 1 ? 's' : ''} · {initialEquipes.length} équipe{initialEquipes.length > 1 ? 's' : ''}
          </p>
        </div>
        {canManageTeam && <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={openNewSolo}
            className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[var(--elevation-border)] text-sm font-semibold text-secondary hover:text-primary hover:border-accent/40 bg-base transition-all whitespace-nowrap"
          >
            <UserPlus className="w-4 h-4" />
            <span className="hidden sm:inline">Ajouter un intervenant</span>
          </button>
          <button
            onClick={openCreateEquipe}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-white font-bold hover:bg-accent/90 transition-all whitespace-nowrap"
          >
            <Plus className="w-4 h-4 text-white" />
            <span className="hidden sm:inline">Créer une équipe</span>
          </button>
        </div>}
      </div>

      {/* Note contextuelle */}
      <div className="rounded-xl border border-[var(--elevation-border)] bg-surface px-4 py-3 text-sm text-secondary dark:bg-white/[0.03]">
        <span className="font-semibold text-primary">Note :</span> un intervenant peut appartenir à une équipe et intervenir en solo sur d&apos;autres chantiers.
        Les pointages d&apos;heures sont toujours individuels par intervenant, que ce soit en équipe ou non.
        {canEditRates && <> Le taux horaire sert au calcul de la rentabilité chantier.</>}
      </div>

      {/* Équipes */}
      {initialEquipes.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-secondary">Équipes ({initialEquipes.length})</h2>
          {initialEquipes.map(equipe => {
            const dispoDrop = membresDispoForEquipe(equipe.id)
            return (
              <div key={equipe.id} className="card overflow-hidden">
                {/* En-tête équipe */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--elevation-border)]">
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-8 rounded-full shrink-0" style={{ backgroundColor: equipe.color }} />
                    <div>
                      <p className="font-bold text-primary">{equipe.name}</p>
                      {equipe.description && <p className="text-xs text-secondary mt-0.5">{equipe.description}</p>}
                    </div>
                    <span className="ml-2 rounded-full bg-interactive px-2 py-0.5 text-xs font-medium text-secondary dark:bg-white/[0.06]">
                      {equipe.membres.length} membre{equipe.membres.length > 1 ? 's' : ''}
                    </span>
                  </div>
                  {canManageTeam && <div className="flex items-center gap-1">
                    <button
                      onClick={() => openEditEquipe(equipe)}
                      className="p-2 rounded-lg text-secondary hover:text-primary hover:bg-interactive transition-colors dark:hover:bg-white/[0.08]"
                      title="Modifier l'équipe"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setConfirmDelete({ type: 'equipe', id: equipe.id, label: equipe.name })}
                      className="p-2 rounded-lg text-secondary hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
                      title="Supprimer l'équipe"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>}
                </div>

                {/* Membres de l'équipe */}
                <div className="divide-y divide-[var(--elevation-border)]">
                  {equipe.membres.length === 0 && (
                    <p className="px-5 py-4 text-sm text-secondary italic">Aucun membre pour l&apos;instant.</p>
                  )}
                  {equipe.membres.map(membre => (
                    <div key={membre.id} className="flex items-center gap-3 px-5 py-3 hover:bg-interactive/30 transition-colors dark:hover:bg-white/[0.02]">
                      {/* Avatar */}
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                        style={{ backgroundColor: equipe.color }}
                      >
                        {initials(membre)}
                      </div>
                      {/* Infos */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-primary truncate">{fullName(membre)}</p>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                          {membre.role_label && <span className="text-xs text-secondary">{membre.role_label}</span>}
                          {membre.email && <span className="text-xs text-secondary">{membre.email}</span>}
                          {membre.profile_id && (
                            <span className="flex items-center gap-0.5 text-xs text-emerald-600 dark:text-emerald-400">
                              <Shield className="w-3 h-3" /> Compte app
                            </span>
                          )}
                        </div>
                      </div>
                      {/* Taux horaire éditable inline */}
                      {canEditRates && (
                        <TauxBadge
                          taux={membre.taux_horaire}
                          onSave={v => handleTaux(membre.id, v)}
                        />
                      )}
                      {/* Actions */}
                      {canManageTeam && <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => openEditMembre(membre)}
                          className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-interactive transition-colors dark:hover:bg-white/[0.08]"
                          title="Modifier"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleRetirerDeEquipe(membre.id)}
                          className="p-1.5 rounded-lg text-secondary hover:text-amber-500 hover:bg-amber-500/10 transition-colors"
                          title="Retirer de l'équipe (reste dans les intervenants)"
                        >
                          <UserMinus className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setConfirmDelete({ type: 'membre', id: membre.id, label: fullName(membre) })}
                          className="p-1.5 rounded-lg text-secondary hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
                          title="Supprimer définitivement"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>}
                    </div>
                  ))}
                </div>

                {/* Actions bas de carte équipe */}
                {canManageTeam && <div className="flex items-center gap-2 px-5 py-3 border-t border-[var(--elevation-border)] bg-base/50 dark:bg-white/[0.01]">
                  <button
                    onClick={() => openNewInEquipe(equipe.id)}
                    className="flex items-center gap-1.5 text-xs font-medium text-secondary hover:text-primary transition-colors px-2 py-1.5 rounded-lg hover:bg-interactive dark:hover:bg-white/[0.08]"
                  >
                    <UserPlus className="w-3.5 h-3.5" /> Nouveau membre
                  </button>
                  {dispoDrop.length > 0 && (
                    showAddExistant === equipe.id ? (
                      <div className="flex items-center gap-2 flex-1">
                        <select
                          value={selectedExistant}
                          onChange={e => setSelectedExistant(e.target.value)}
                          className="flex-1 px-2 py-1.5 rounded-lg border border-[var(--elevation-border)] bg-interactive text-xs text-primary focus:outline-none focus:border-accent dark:bg-white/[0.04]"
                        >
                          <option value="">Choisir un intervenant...</option>
                          {dispoDrop.map(m => (
                            <option key={m.id} value={m.id}>
                              {fullName(m)}
                              {'equipe_name' in m && m.equipe_name ? ` (${m.equipe_name})` : ' (solo)'}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleAddExistant(equipe.id)}
                          disabled={!selectedExistant || saving}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-accent text-xs font-semibold text-black hover:opacity-90 transition-opacity disabled:opacity-50"
                        >
                          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                          Ajouter
                        </button>
                        <button
                          onClick={() => { setShowAddExistant(null); setSelectedExistant('') }}
                          className="p-1.5 rounded-lg text-secondary hover:bg-interactive transition-colors dark:hover:bg-white/[0.08]"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setShowAddExistant(equipe.id); setSelectedExistant('') }}
                        className="flex items-center gap-1.5 text-xs font-medium text-secondary hover:text-primary transition-colors px-2 py-1.5 rounded-lg hover:bg-interactive dark:hover:bg-white/[0.08]"
                      >
                        <ChevronRight className="w-3.5 h-3.5" /> Ajouter un intervenant existant
                      </button>
                    )
                  )}
                </div>}
              </div>
            )
          })}
        </section>
      )}

      {/* Intervenants solo */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-secondary">
            Intervenants sans équipe ({initialSolo.length})
          </h2>
          {canManageTeam && <button
            onClick={openNewSolo}
            className="flex items-center gap-1.5 text-xs font-medium text-secondary hover:text-primary transition-colors px-2 py-1.5 rounded-lg hover:bg-interactive dark:hover:bg-white/[0.08]"
          >
            <Plus className="w-3.5 h-3.5" /> Ajouter
          </button>}
        </div>

        {initialSolo.length === 0 && (
          <div className="rounded-xl border border-dashed border-[var(--elevation-border)] bg-surface px-4 py-10 text-center dark:bg-white/[0.02]">
            <UserPlus className="w-8 h-8 text-secondary/30 mx-auto mb-2" />
            <p className="text-sm text-secondary">Aucun intervenant solo. Ajoutez-en un ou créez une équipe.</p>
          </div>
        )}

        {initialSolo.length > 0 && (
          <div className="card divide-y divide-[var(--elevation-border)] overflow-hidden">
            {initialSolo.map(membre => (
              <div key={membre.id} className="flex items-center gap-3 px-5 py-3 hover:bg-interactive/30 transition-colors dark:hover:bg-white/[0.02]">
                {/* Avatar */}
                <div className="w-8 h-8 rounded-full bg-accent/15 flex items-center justify-center text-xs font-bold text-accent shrink-0">
                  {initials(membre)}
                </div>
                {/* Infos */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-primary truncate">{fullName(membre)}</p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                    {membre.role_label && <span className="text-xs text-secondary">{membre.role_label}</span>}
                    {membre.email && <span className="text-xs text-secondary">{membre.email}</span>}
                    {membre.profile_id && (
                      <span className="flex items-center gap-0.5 text-xs text-emerald-600 dark:text-emerald-400">
                        <Shield className="w-3 h-3" /> Compte app
                      </span>
                    )}
                  </div>
                </div>
                {/* Taux horaire */}
                {canEditRates && (
                  <TauxBadge
                    taux={membre.taux_horaire}
                    onSave={v => handleTaux(membre.id, v)}
                  />
                )}
                {/* Actions */}
                {canManageTeam && <div className="flex items-center gap-1 shrink-0">
                  {membre.email && !membre.profile_id && (
                    <button
                      onClick={() => handleInvite(membre.id)}
                      className={`p-1.5 rounded-lg transition-colors ${
                        inviteSent.has(membre.id)
                          ? 'text-emerald-500 bg-emerald-500/10'
                          : 'text-secondary hover:text-primary hover:bg-interactive dark:hover:bg-white/[0.08]'
                      }`}
                      title={inviteSent.has(membre.id) ? 'Invitation envoyée' : 'Envoyer accès espace membre'}
                    >
                      {inviteSent.has(membre.id) ? <Check className="w-3.5 h-3.5" /> : <Mail className="w-3.5 h-3.5" />}
                    </button>
                  )}
                  <button
                    onClick={() => openEditMembre(membre)}
                    className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-interactive transition-colors dark:hover:bg-white/[0.08]"
                    title="Modifier"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setConfirmDelete({ type: 'membre', id: membre.id, label: fullName(membre) })}
                    className="p-1.5 rounded-lg text-secondary hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
                    title="Supprimer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Membres app (compte Supabase Auth) */}
      {appMembersState.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-secondary">
            Membres avec compte application ({appMembersState.length})
          </h2>
          <div className="card divide-y divide-[var(--elevation-border)] overflow-hidden">
            {appMembersState.map(m => {
              const isEditing = editingAppMemberId === m.membership_id
              return (
                <div key={m.membership_id} className="flex items-center gap-3 px-5 py-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-500/15 flex items-center justify-center text-xs font-bold text-emerald-600 dark:text-emerald-400 shrink-0">
                    {(m.full_name ?? m.email)?.[0]?.toUpperCase() ?? '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-primary truncate">{m.full_name ?? m.email}</p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                      <span className="text-xs text-secondary truncate">{m.email}</span>
                      <span className="text-xs rounded-full bg-interactive px-2 py-0.5 text-secondary dark:bg-white/[0.06] shrink-0">{m.role_name}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <div className="flex items-center gap-1">
                      <UserCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium whitespace-nowrap">Accès complet</span>
                    </div>
                    {canEditRates && (
                      isEditing ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            step={0.5}
                            autoFocus
                            value={editAppTaux}
                            onChange={e => setEditAppTaux(e.target.value)}
                            placeholder="€/h"
                            className="w-20 px-2 py-1 text-xs rounded border border-accent bg-base text-primary focus:outline-none"
                          />
                          <button
                            onClick={() => saveEditAppMember(m.membership_id)}
                            disabled={editAppSaving}
                            className="p-1 rounded text-emerald-600 hover:bg-emerald-500/10"
                          >
                            {editAppSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                          </button>
                          <button onClick={cancelEditAppMember} className="p-1 rounded text-secondary hover:bg-interactive">
                            <X className="w-3.5 h-3.5" />
                          </button>
                          {editAppError && <span className="text-xs text-red-500">{editAppError}</span>}
                        </div>
                      ) : (
                        <button
                          onClick={() => startEditAppMember(m)}
                          className="flex items-center gap-1 rounded-md border border-[var(--elevation-border)] bg-base px-2 py-0.5 text-xs text-primary hover:border-accent hover:text-accent transition-colors"
                          title="Modifier le taux horaire"
                        >
                          <Euro className="h-3 w-3" />
                          {m.labor_cost_per_hour != null ? `${m.labor_cost_per_hour} €/h` : 'Taux'}
                          <Pencil className="h-2.5 w-2.5 opacity-60" />
                        </button>
                      )
                    )}
                    {!canEditRates && m.labor_cost_per_hour != null && (
                      <span className="flex items-center gap-1 rounded-md border border-[var(--elevation-border)] bg-interactive px-2 py-0.5 text-xs text-secondary dark:bg-white/[0.04]">
                        <Euro className="h-3 w-3" />{m.labor_cost_per_hour} €/h
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ─── Objectifs membres ──────────────────────────────────────────────── */}
      {canEditGoals && (initialSolo.length > 0 || appMembers.length > 0) && (
        <section className="space-y-3">
          <div className="rounded-2xl border border-[var(--elevation-border)] bg-surface p-6 dark:bg-white/[0.02]">
            <MemberGoalsSettings
              intervenants={initialSolo}
              orgMembers={appMembersState}
              initialGoals={memberGoals}
              currentUserId={currentUserId}
            />
          </div>
        </section>
      )}

      {/* ─── Modal membre ───────────────────────────────────────────────────── */}
      {membreModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50">
          <div className="w-full max-w-md bg-surface rounded-2xl shadow-xl border border-[var(--elevation-border)] overflow-hidden dark:bg-[#121212]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--elevation-border)]">
              <h3 className="font-semibold text-primary">
                {membreModal.mode === 'edit' ? 'Modifier l\'intervenant' :
                  membreModal.mode === 'new-in-equipe' ? 'Ajouter un membre à l\'équipe' :
                  'Nouvel intervenant'}
              </h3>
              <button onClick={() => setMembreModal(null)} className="p-1.5 rounded-lg hover:bg-interactive text-secondary transition-colors dark:hover:bg-white/[0.08]">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1">Prénom</label>
                  <input value={fPrenom} onChange={e => setFPrenom(e.target.value)} placeholder="Prénom"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--elevation-border)] bg-interactive text-sm text-primary focus:outline-none focus:border-accent dark:bg-white/[0.04]" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1">Nom *</label>
                  <input value={fName} onChange={e => setFName(e.target.value)} placeholder="Nom de famille"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--elevation-border)] bg-interactive text-sm text-primary focus:outline-none focus:border-accent dark:bg-white/[0.04]" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-secondary mb-1">Email</label>
                <input type="email" value={fEmail} onChange={e => setFEmail(e.target.value)} placeholder="email@exemple.com"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--elevation-border)] bg-interactive text-sm text-primary focus:outline-none focus:border-accent dark:bg-white/[0.04]" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1">Rôle / Poste</label>
                  <input value={fRole} onChange={e => setFRole(e.target.value)} placeholder="Chef d'équipe…"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--elevation-border)] bg-interactive text-sm text-primary focus:outline-none focus:border-accent dark:bg-white/[0.04]" />
                </div>
                {canEditRates && (
                  <div>
                    <label className="block text-xs font-medium text-secondary mb-1">Taux horaire (€/h)</label>
                    <input type="number" min={0} step={0.5} value={fTaux} onChange={e => setFTaux(e.target.value)} placeholder="0.00"
                      className="w-full px-3 py-2 rounded-lg border border-[var(--elevation-border)] bg-interactive text-sm text-primary focus:outline-none focus:border-accent dark:bg-white/[0.04]" />
                  </div>
                )}
              </div>
              {/* Option invite uniquement pour nouveau solo avec email */}
              {membreModal.mode === 'new-solo' && fEmail && (
                <label className="flex items-center gap-2 text-sm text-secondary cursor-pointer">
                  <input type="checkbox" checked={fSendInvite} onChange={e => setFSendInvite(e.target.checked)}
                    className="rounded border-[var(--elevation-border)] accent-accent" />
                  Envoyer l&apos;accès espace personnel par email
                </label>
              )}
              {error && <p className="text-sm text-rose-500">{error}</p>}
            </div>
            <div className="flex gap-2 px-5 py-4 border-t border-[var(--elevation-border)]">
              <button onClick={() => setMembreModal(null)}
                className="flex-1 py-2 rounded-xl border border-[var(--elevation-border)] text-sm font-medium text-secondary hover:bg-interactive transition-colors dark:hover:bg-white/[0.08]">
                Annuler
              </button>
              <button onClick={handleSaveMembre} disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl bg-accent text-black text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {membreModal.mode === 'edit' ? 'Enregistrer' : 'Ajouter'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Modal équipe ───────────────────────────────────────────────────── */}
      {equipeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="w-full max-w-sm bg-surface rounded-2xl shadow-xl border border-[var(--elevation-border)] overflow-hidden dark:bg-[#121212]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--elevation-border)]">
              <h3 className="font-semibold text-primary">
                {equipeModal.mode === 'create' ? 'Créer une équipe' : 'Modifier l\'équipe'}
              </h3>
              <button onClick={() => setEquipeModal(null)} className="p-1.5 rounded-lg hover:bg-interactive text-secondary transition-colors dark:hover:bg-white/[0.08]">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-secondary mb-1">Nom de l&apos;équipe *</label>
                <input value={fEquipeName} onChange={e => setFEquipeName(e.target.value)} placeholder="Équipe Nettoyage…"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--elevation-border)] bg-interactive text-sm text-primary focus:outline-none focus:border-accent dark:bg-white/[0.04]" />
              </div>
              <div>
                <label className="block text-xs font-medium text-secondary mb-1">Couleur</label>
                <div className="flex flex-wrap gap-2">
                  {EQUIPE_COLORS.map(c => (
                    <button key={c} onClick={() => setFEquipeColor(c)}
                      className={`w-7 h-7 rounded-full transition-transform ${fEquipeColor === c ? 'scale-125 ring-2 ring-offset-2 ring-accent' : 'hover:scale-110'}`}
                      style={{ backgroundColor: c }} />
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-secondary mb-1">Description (optionnel)</label>
                <input value={fEquipeDesc} onChange={e => setFEquipeDesc(e.target.value)} placeholder="Spécialité, zone géographique…"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--elevation-border)] bg-interactive text-sm text-primary focus:outline-none focus:border-accent dark:bg-white/[0.04]" />
              </div>
              {error && <p className="text-sm text-rose-500">{error}</p>}
            </div>
            <div className="flex gap-2 px-5 py-4 border-t border-[var(--elevation-border)]">
              <button onClick={() => setEquipeModal(null)}
                className="flex-1 py-2 rounded-xl border border-[var(--elevation-border)] text-sm font-medium text-secondary hover:bg-interactive transition-colors dark:hover:bg-white/[0.08]">
                Annuler
              </button>
              <button onClick={handleSaveEquipe} disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl bg-accent text-black text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {equipeModal.mode === 'create' ? 'Créer' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Confirmation suppression ───────────────────────────────────────── */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="w-full max-w-sm bg-surface rounded-2xl shadow-xl border border-[var(--elevation-border)] p-5 space-y-4 dark:bg-[#121212]">
            <h3 className="font-semibold text-primary">Confirmer la suppression</h3>
            <p className="text-sm text-secondary">
              {confirmDelete.type === 'equipe'
                ? <>Supprimer l&apos;équipe <strong>{confirmDelete.label}</strong> ? Les membres resteront dans l&apos;annuaire mais seront détachés de l&apos;équipe.</>
                : <>Supprimer <strong>{confirmDelete.label}</strong> ? L&apos;historique des pointages sera conservé mais le membre ne sera plus accessible.</>
              }
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDelete(null)}
                className="flex-1 py-2 rounded-xl border border-[var(--elevation-border)] text-sm font-medium text-secondary hover:bg-interactive transition-colors dark:hover:bg-white/[0.08]">
                Annuler
              </button>
              <button
                onClick={() => {
                  if (confirmDelete.type === 'equipe') handleDeleteEquipe(confirmDelete.id)
                  else handleDeleteEquipeMembre(confirmDelete.id)
                }}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl bg-rose-500 text-white text-sm font-semibold hover:bg-rose-600 transition-colors disabled:opacity-50"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
