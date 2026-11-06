'use client'

import { useState } from 'react'

import { Euro, Plus, Trash2, CheckCircle2, Users, UserPlus, ChevronDown, ChevronUp, X, Pencil, Check, Sparkles, Loader2 } from 'lucide-react'
import type { Equipe } from '@/lib/data/queries/chantiers'

import type { TeamMember } from '@/lib/data/queries/team'
import type { OrgRole } from '@/lib/data/queries/roles'
import { getQuoteItemsForSuggestions } from '@/lib/data/mutations/quotes'
import { createEquipe, deleteEquipe, addEquipeMembre, removeEquipeMembre, updateEquipeMembreTaux, updateEquipeMembreProfile, assignEquipeToChantier, removeEquipeFromChantier } from '@/lib/data/mutations/chantiers'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function RoleLabelSelect({
  value,
  onChange,
  roles,
  className = 'input w-full text-sm',
}: {
  value: string
  onChange: (value: string) => void
  roles: OrgRole[]
  className?: string
}) {
  if (roles.length === 0) {
    return (
      <input
        className={className}
        placeholder="Rôle"
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    )
  }

  const hasCustomValue = value && !roles.some(role => role.name === value)

  return (
    <select
      className={className}
      value={value}
      onChange={e => onChange(e.target.value)}
    >
      <option value="">Sans rôle</option>
      {hasCustomValue && <option value={value}>{value}</option>}
      {roles.map(role => (
        <option key={role.id} value={role.name}>{role.name}</option>
      ))}
    </select>
  )
}

// ─── Types ────────────────────────────────────────────────────────────────────

type TeamSuggestion = {
  _id: string
  designation: string
  quantity: number
  unit: string
  rate: number
  name: string
  color: string
  created: boolean
}

export function EquipesTab({
  chantierId,
  allEquipes: initialAllEquipes,
  chantierEquipes: initialChantierEquipes,
  linkedQuoteId,
  orgMembers,
  orgRoles,
  canEditRates,
  currentUserId,
}: {
  chantierId: string
  allEquipes: Equipe[]
  chantierEquipes: Equipe[]
  linkedQuoteId?: string | null
  orgMembers: TeamMember[]
  orgRoles: OrgRole[]
  canEditRates: boolean
  currentUserId?: string | null
}) {
  const [allEquipes, setAllEquipes] = useState(initialAllEquipes)
  const [assignedIds, setAssignedIds] = useState<Set<string>>(
    new Set(initialChantierEquipes.map(e => e.id))
  )
  const [showCreate, setShowCreate] = useState(false)
  const [newEquipeName, setNewEquipeName] = useState('')
  const [newEquipeColor, setNewEquipeColor] = useState('#6366f1')
  const [createLoading, setCreateLoading] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [memberForms, setMemberForms] = useState<Record<string, { name: string; role: string; taux: string; profileId: string | null }>>({})
  const [editingMembreTaux, setEditingMembreTaux] = useState<Record<string, string>>({})
  const [addingMembres, setAddingMembres] = useState<Set<string>>(new Set())
  const [removingMembres, setRemovingMembres] = useState<Set<string>>(new Set())
  const [deletingEquipes, setDeletingEquipes] = useState<Set<string>>(new Set())
  const [pendingMembreIds, setPendingMembreIds] = useState<Record<string, Set<string>>>({})

  // Team suggestions from quote MO lines
  const [teamSuggestions, setTeamSuggestions] = useState<TeamSuggestion[]>([])
  const [suggestTeamsLoading, setSuggestTeamsLoading] = useState(false)
  const [showTeamSuggestions, setShowTeamSuggestions] = useState(false)
  const SUGGEST_COLORS = ['#6366f1', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ef4444', '#14b8a6', '#f97316']

  const handleSuggestTeams = async () => {
    if (!linkedQuoteId) return
    setSuggestTeamsLoading(true)
    const { internal } = await getQuoteItemsForSuggestions(linkedQuoteId)
    setSuggestTeamsLoading(false)
    if (internal.length === 0) return
    setTeamSuggestions(internal.map((item, i) => ({
      _id: `tsugg_${i}_${Date.now()}`,
      designation: item.designation,
      quantity: item.quantity,
      unit: item.unit,
      rate: item.rate,
      name: item.designation,
      color: SUGGEST_COLORS[i % SUGGEST_COLORS.length],
      created: false,
    })))
    setShowTeamSuggestions(true)
  }

  const handleCreateFromSuggestion = async (id: string) => {
    const sugg = teamSuggestions.find(s => s._id === id)
    if (!sugg || sugg.created) return
    const { equipeId, error } = await createEquipe({
      name: sugg.name.trim(),
      color: sugg.color,
      description: `${sugg.quantity} ${sugg.unit} estimés`,
    })
    if (!error && equipeId) {
      const newE: Equipe = {
        id: equipeId, organization_id: '', name: sugg.name.trim(), color: sugg.color,
        description: `${sugg.quantity} ${sugg.unit} estimés`, created_at: new Date().toISOString(), membres: [],
      }
      setAllEquipes(prev => [...prev, newE])
      setTeamSuggestions(prev => prev.map(s => s._id === id ? { ...s, created: true } : s))
      // auto-assign
      setAssignedIds(prev => new Set([...prev, equipeId]))
      await assignEquipeToChantier(chantierId, equipeId)
    }
  }

  const toggleExpand = (id: string) =>
    setExpanded(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })

  const handleCreateEquipe = async () => {
    if (!newEquipeName.trim()) return
    setCreateLoading(true)
    const { equipeId, error } = await createEquipe({ name: newEquipeName.trim(), color: newEquipeColor })
    setCreateLoading(false)
    if (!error && equipeId) {
      const newE: Equipe = {
        id: equipeId, organization_id: '', name: newEquipeName.trim(), color: newEquipeColor,
        description: null, created_at: new Date().toISOString(), membres: [],
      }
      setAllEquipes(prev => [...prev, newE])
      setNewEquipeName('')
      setNewEquipeColor('#6366f1')
      setShowCreate(false)
    }
  }

  const handleDeleteEquipe = async (equipeId: string) => {
    if (!confirm("Supprimer cette équipe ? Les membres seront conservés comme intervenants solo.")) return
    setDeletingEquipes(prev => new Set([...prev, equipeId]))
    const { error } = await deleteEquipe(equipeId)
    setDeletingEquipes(prev => { const s = new Set(prev); s.delete(equipeId); return s })
    if (error) { alert(error); return }
    setAllEquipes(prev => prev.filter(e => e.id !== equipeId))
    setAssignedIds(prev => { const s = new Set(prev); s.delete(equipeId); return s })
  }

  const handleToggleAssign = async (equipeId: string) => {
    if (assignedIds.has(equipeId)) {
      setAssignedIds(prev => { const s = new Set(prev); s.delete(equipeId); return s })
      await removeEquipeFromChantier(chantierId, equipeId)
    } else {
      setAssignedIds(prev => new Set([...prev, equipeId]))
      await assignEquipeToChantier(chantierId, equipeId)
    }
  }

  const handleAddMembre = async (equipeId: string) => {
    const form = memberForms[equipeId]
    if (!form?.name.trim()) return
    setAddingMembres(prev => new Set([...prev, equipeId]))
    const taux = canEditRates && form.taux ? parseFloat(form.taux) : null
    const profileId = form.profileId ?? null
    const { membreId, error } = await addEquipeMembre(equipeId, { name: form.name.trim(), roleLabel: form.role.trim() || null, tauxHoraire: taux, profileId })
    setAddingMembres(prev => { const s = new Set(prev); s.delete(equipeId); return s })
    if (!error && membreId) {
      setAllEquipes(prev => prev.map(e => e.id !== equipeId ? e : {
        ...e,
        membres: [...e.membres, { id: membreId, equipe_id: equipeId, prenom: null, name: form.name.trim(), email: null, role_label: form.role.trim() || null, profile_id: profileId, taux_horaire: taux }],
      }))
      setMemberForms(prev => ({ ...prev, [equipeId]: { name: '', role: '', taux: '', profileId: null } }))
    }
  }

  const handleAddMultipleMembres = async (equipeId: string) => {
    const ids = [...(pendingMembreIds[equipeId] ?? new Set())]
    if (!ids.length) return
    setAddingMembres(prev => new Set([...prev, equipeId]))
    for (const uid of ids) {
      const member = orgMembers.find(m => m.user_id === uid)
      if (!member) continue
      const taux = canEditRates && member.labor_cost_per_hour != null ? member.labor_cost_per_hour : null
      const { membreId, error } = await addEquipeMembre(equipeId, {
        name: member.full_name ?? member.email,
        roleLabel: member.job_title ?? null,
        tauxHoraire: taux,
        profileId: uid,
      })
      if (!error && membreId) {
        setAllEquipes(prev => prev.map(e => e.id !== equipeId ? e : {
          ...e,
          membres: [...e.membres, { id: membreId, equipe_id: equipeId, prenom: null, name: member.full_name ?? member.email, email: null, role_label: member.job_title ?? null, profile_id: uid, taux_horaire: taux }],
        }))
      }
    }
    setAddingMembres(prev => { const s = new Set(prev); s.delete(equipeId); return s })
    setPendingMembreIds(prev => { const s = { ...prev }; delete s[equipeId]; return s })
  }

  const handleSaveMembreTaux = async (equipeId: string, membreId: string) => {
    if (!canEditRates) return
    const raw = editingMembreTaux[membreId]
    const taux = raw ? parseFloat(raw) : null
    await updateEquipeMembreTaux(membreId, taux)
    setAllEquipes(prev => prev.map(e => e.id !== equipeId ? e : {
      ...e,
      membres: e.membres.map(m => m.id !== membreId ? m : { ...m, taux_horaire: taux }),
    }))
    setEditingMembreTaux(prev => { const s = { ...prev }; delete s[membreId]; return s })
  }

  const handleRemoveMembre = async (equipeId: string, membreId: string) => {
    setRemovingMembres(prev => new Set([...prev, membreId]))
    const { error } = await removeEquipeMembre(membreId)
    setRemovingMembres(prev => { const s = new Set(prev); s.delete(membreId); return s })
    if (error) return
    setAllEquipes(prev => prev.map(e => e.id !== equipeId ? e : {
      ...e, membres: e.membres.filter(m => m.id !== membreId),
    }))
  }

  const PRESET_COLORS = ['#6366f1', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ef4444', '#14b8a6', '#f97316']

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-bold text-primary flex items-center gap-2">
            <Users className="w-4 h-4 text-accent" /> Équipes terrain
          </h3>
          <p className="text-xs text-secondary mt-0.5">Créez des équipes libres et assignez-les à ce chantier.</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          {linkedQuoteId && !showTeamSuggestions && (
            <button
              onClick={handleSuggestTeams}
              disabled={suggestTeamsLoading}
              className="flex items-center justify-center gap-2 text-sm font-semibold text-violet-600 dark:text-violet-400 px-3 py-2 rounded-xl border border-violet-400/30 bg-violet-500/5 hover:bg-violet-500/10 transition-all disabled:opacity-60"
            >
              {suggestTeamsLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              Suggérer depuis devis
            </button>
          )}
          <button onClick={() => setShowCreate(v => !v)} className="btn-primary flex items-center justify-center gap-2 text-sm">
            <Plus className="w-4 h-4" /> Créer une équipe
          </button>
        </div>
      </div>

      {/* Team suggestions panel */}
      {showTeamSuggestions && teamSuggestions.length > 0 && (
        <div className="card p-4 space-y-3 border-violet-400/30 bg-violet-500/3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-primary flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-violet-500" />
              Équipes suggérées depuis la MO du devis
            </p>
            <button onClick={() => { setTeamSuggestions([]); setShowTeamSuggestions(false) }} className="p-1 text-secondary hover:text-primary">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-2">
            {teamSuggestions.map(sugg => (
              <div key={sugg._id} className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${sugg.created ? 'border-emerald-400/30 bg-emerald-500/5 opacity-70' : 'border-[var(--elevation-border)] bg-surface dark:bg-white/[0.03]'}`}>
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: sugg.color }} />
                <div className="flex-1 min-w-0">
                  <input
                    value={sugg.name}
                    onChange={e => setTeamSuggestions(prev => prev.map(s => s._id === sugg._id ? { ...s, name: e.target.value } : s))}
                    disabled={sugg.created}
                    className="bg-transparent outline-none text-sm font-semibold text-primary w-full disabled:cursor-default"
                  />
                  <p className="text-xs text-secondary">{sugg.quantity} {sugg.unit} estimés · {sugg.rate}€/{sugg.unit}</p>
                </div>
                {sugg.created ? (
                  <span className="text-xs text-emerald-500 flex items-center gap-1 flex-shrink-0">
                    <CheckCircle2 className="w-3.5 h-3.5" />Créée
                  </span>
                ) : (
                  <button
                    onClick={() => handleCreateFromSuggestion(sugg._id)}
                    className="btn-primary text-xs px-3 py-1.5 flex-shrink-0"
                  >
                    Créer
                  </button>
                )}
              </div>
            ))}
          </div>
          <button onClick={() => { setTeamSuggestions([]); setShowTeamSuggestions(false) }} className="btn-secondary w-full text-sm">
            Fermer
          </button>
        </div>
      )}

      {showCreate && (
        <div className="card p-4 border-accent/30 bg-accent/5 space-y-3">
          <p className="text-sm font-semibold text-primary">Nouvelle équipe</p>
          <input
            className="input w-full"
            placeholder="Nom de l'équipe (ex : Équipe Nettoyage Nord)"
            value={newEquipeName}
            onChange={e => setNewEquipeName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreateEquipe()}
            autoFocus
          />
          <div>
            <label className="text-xs font-semibold text-secondary block mb-1.5">Couleur</label>
            <div className="flex items-center gap-2 flex-wrap">
              {PRESET_COLORS.map(c => (
                <button key={c} onClick={() => setNewEquipeColor(c)}
                  className={`w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 ${newEquipeColor === c ? 'border-primary scale-110 ring-2 ring-primary/20' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowCreate(false)} className="btn-secondary flex-1 text-sm">Annuler</button>
            <button onClick={handleCreateEquipe} disabled={createLoading || !newEquipeName.trim()} className="btn-primary flex-1 text-sm">
              {createLoading ? 'Création...' : "Créer l'équipe"}
            </button>
          </div>
        </div>
      )}

      {allEquipes.length === 0 && !showCreate && (
        <div className="card p-12 text-center">
          <Users className="w-12 h-12 text-secondary opacity-30 mx-auto mb-3" />
          <p className="text-secondary font-semibold">Aucune équipe créée</p>
          <p className="text-secondary text-sm mt-1">Créez des équipes pour organiser votre personnel sur le chantier</p>
        </div>
      )}

      {allEquipes.map(equipe => {
        const isAssigned = assignedIds.has(equipe.id)
        const isOpen = expanded.has(equipe.id)
        const mForm = memberForms[equipe.id] ?? { name: '', role: '', taux: '', profileId: null }
        return (
          <div key={equipe.id} className={`card overflow-hidden border-2 transition-colors ${isAssigned ? 'border-accent/40' : 'border-[var(--elevation-border)]'}`}>
            <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: equipe.color }} />
              <div className="w-full min-w-0 flex-1">
                <p className="font-semibold text-primary">{equipe.name}</p>
                <p className="text-xs text-secondary mt-0.5">
                  {equipe.membres.length} membre{equipe.membres.length !== 1 ? 's' : ''}
                  {isAssigned && <span className="ml-2 text-accent font-semibold">· Assignée à ce chantier</span>}
                </p>
              </div>
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <button
                  onClick={() => handleToggleAssign(equipe.id)}
                  className={`flex-1 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors sm:flex-none ${isAssigned ? 'border-red-400/40 text-red-500 hover:bg-red-500/10' : 'border-accent/40 text-accent hover:bg-accent/10'}`}
                >
                  {isAssigned ? 'Retirer' : 'Assigner'}
                </button>
                <button onClick={() => toggleExpand(equipe.id)} className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-[var(--elevation-1)] transition-colors">
                  {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
                <button onClick={() => handleDeleteEquipe(equipe.id)} disabled={deletingEquipes.has(equipe.id)} className="p-1.5 rounded-lg text-secondary hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-40">
                  {deletingEquipes.has(equipe.id) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {isOpen && (
              <div className="border-t border-[var(--elevation-border)] bg-[var(--elevation-1)] p-4 space-y-2">
                {equipe.membres.length === 0 && (
                  <p className="text-xs text-secondary italic">Aucun membre. Ajoutez-en ci-dessous.</p>
                )}
                {equipe.membres.map(m => {
                  const isMe = currentUserId && m.profile_id === currentUserId
                  return (
                    <div key={m.id} className="flex flex-col gap-2 rounded-lg border border-[var(--elevation-border)] bg-[var(--elevation-0)] px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3">
                      <div className="flex min-w-0 items-start gap-2 sm:flex-1">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0" style={{ backgroundColor: equipe.color }}>
                          {m.name[0]?.toUpperCase() ?? '?'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-primary flex flex-wrap items-center gap-1">
                            <span className="min-w-0 truncate">{m.name}</span>
                            {isMe && (
                              <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-accent/15 text-accent">Moi</span>
                            )}
                            {m.profile_id ? (
                              <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-500">Lié</span>
                            ) : (
                              <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500">Externe</span>
                            )}
                          </p>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5">
                          {m.role_label && <p className="text-xs text-secondary">{m.role_label}</p>}
                          {canEditRates && editingMembreTaux[m.id] !== undefined ? (
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min="0"
                                step="0.5"
                                className="input w-16 text-xs py-0.5 px-1.5"
                                placeholder="€/h"
                                value={editingMembreTaux[m.id]}
                                onChange={e => setEditingMembreTaux(prev => ({ ...prev, [m.id]: e.target.value }))}
                                onKeyDown={e => { if (e.key === 'Enter') handleSaveMembreTaux(equipe.id, m.id) }}
                                autoFocus
                              />
                              <button onClick={() => handleSaveMembreTaux(equipe.id, m.id)} className="p-0.5 text-accent hover:text-accent/80 transition-colors">
                                <Check className="w-3 h-3" />
                              </button>
                              <button onClick={() => setEditingMembreTaux(prev => { const s = { ...prev }; delete s[m.id]; return s })} className="p-0.5 text-secondary hover:text-primary transition-colors">
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ) : canEditRates ? (
                            <button
                              onClick={() => setEditingMembreTaux(prev => ({ ...prev, [m.id]: m.taux_horaire != null ? String(m.taux_horaire) : '' }))}
                              className="flex items-center gap-0.5 text-xs text-secondary hover:text-primary transition-colors"
                            >
                              <Euro className="w-2.5 h-2.5" />
                              {m.taux_horaire != null ? <span>{m.taux_horaire}€/h</span> : <span className="opacity-40">€/h</span>}
                              <Pencil className="w-2.5 h-2.5 opacity-40" />
                            </button>
                          ) : null}
                          {!m.profile_id && orgMembers.length > 0 && (
                            <select
                              className="mt-0.5 input text-xs py-0.5 px-1 max-w-[160px]"
                              defaultValue=""
                              onChange={async e => {
                                const uid = e.target.value
                                if (!uid) return
                                await updateEquipeMembreProfile(m.id, uid)
                                setAllEquipes(prev => prev.map(eq => eq.id !== equipe.id ? eq : {
                                  ...eq,
                                  membres: eq.membres.map(mm => mm.id !== m.id ? mm : { ...mm, profile_id: uid }),
                                }))
                              }}
                            >
                              <option value="" disabled>Lier à un compte application...</option>
                              {orgMembers.map(om => (
                                <option key={om.user_id} value={om.user_id}>
                                  {om.full_name ?? om.email}
                                </option>
                              ))}
                            </select>
                          )}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => handleRemoveMembre(equipe.id, m.id)}
                        disabled={removingMembres.has(m.id)}
                        className="self-end p-1.5 rounded-lg text-secondary hover:text-red-500 hover:bg-red-500/10 transition-colors flex-shrink-0 disabled:opacity-40 sm:self-auto"
                      >
                        {removingMembres.has(m.id) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  )
                })}
                <div className="space-y-2 pt-1">
                  {/* Multi-sélection comptes application */}
                  {orgMembers.length > 0 && (() => {
                    const pending = pendingMembreIds[equipe.id] ?? new Set<string>()
                    const available = orgMembers.filter(m => !equipe.membres.some(em => em.profile_id === m.user_id))
                    if (!available.length) return null
                    return (
                      <div className="space-y-1.5">
                        <p className="text-xs font-semibold text-secondary">Comptes application de l&apos;organisation</p>
                        <div className="flex flex-wrap gap-1.5">
                          {available.map(m => {
                            const selected = pending.has(m.user_id)
                            const isMe = currentUserId === m.user_id
                            return (
                              <button
                                key={m.user_id}
                                type="button"
                                onClick={() => setPendingMembreIds(prev => {
                                  const cur = new Set(prev[equipe.id] ?? [])
                                  selected ? cur.delete(m.user_id) : cur.add(m.user_id)
                                  return { ...prev, [equipe.id]: cur }
                                })}
                                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-all ${selected ? 'bg-accent text-white border-accent' : 'border-[var(--elevation-border)] text-secondary hover:border-accent/40 hover:text-primary'}`}
                              >
                                {selected && <Check className="w-3 h-3" />}
                                {isMe ? 'Moi' : (m.full_name ?? m.email)}
                                {m.job_title && <span className="opacity-70">· {m.job_title}</span>}
                              </button>
                            )
                          })}
                        </div>
                        {pending.size > 0 && (
                          <button
                            onClick={() => handleAddMultipleMembres(equipe.id)}
                            disabled={addingMembres.has(equipe.id)}
                            className="inline-flex w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-accent/90 disabled:opacity-50 sm:w-auto"
                          >
                            {addingMembres.has(equipe.id) ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />}
                            <span>Ajouter</span>
                            <span className="rounded-full bg-white/20 px-1.5 py-0.5 leading-none">{pending.size}</span>
                          </button>
                        )}
                      </div>
                    )
                  })()}
                  {/* Saisie libre (intervenant externe) */}
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-secondary">Intervenant externe sans compte application</p>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        className="input flex-1 text-sm min-w-0"
                        placeholder="Nom"
                        value={mForm.name}
                        onChange={e => setMemberForms(prev => ({ ...prev, [equipe.id]: { ...mForm, name: e.target.value } }))}
                        onKeyDown={e => e.key === 'Enter' && handleAddMembre(equipe.id)}
                      />
                      <div className="flex gap-2">
                        <RoleLabelSelect
                          className="input flex-1 sm:w-32 text-sm"
                          value={mForm.role}
                          onChange={value => setMemberForms(prev => ({ ...prev, [equipe.id]: { ...mForm, role: value } }))}
                          roles={orgRoles}
                        />
                        {canEditRates && (
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            className="input w-20 text-sm"
                            placeholder="€/h"
                            value={mForm.taux ?? ''}
                            onChange={e => setMemberForms(prev => ({ ...prev, [equipe.id]: { ...mForm, taux: e.target.value } }))}
                            onKeyDown={e => e.key === 'Enter' && handleAddMembre(equipe.id)}
                          />
                        )}
                        <button
                          onClick={() => handleAddMembre(equipe.id)}
                          disabled={!mForm.name.trim() || addingMembres.has(equipe.id)}
                          className="btn-primary px-3 flex items-center gap-1 disabled:opacity-50"
                        >
                          {addingMembres.has(equipe.id) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Rapports PDF membres individuels ────────────────────────────────────────

