'use client'

import React, { useState, useTransition } from 'react'
import { Plus, X, Loader2, Mail, UserPlus, Send, Trash2, Pencil, Check } from 'lucide-react'
import type { IndividualMember } from '@/lib/data/queries/members'
import type { TeamMember } from '@/lib/data/queries/team'
import {
  createIndividualMember,
  updateIndividualMember,
  deleteIndividualMember,
  detachMemberFromChantier,
  attachMemberToChantier,
  sendMemberSpaceInvite,
} from '@/lib/data/mutations/members'

type Mode = 'existing' | 'phantom' | 'new'

export default function IndividualMembersSection({
  chantierId,
  initialMembers,
  orgMembers,
  orgPhantomMembers = [],
}: {
  chantierId: string
  initialMembers: IndividualMember[]
  orgMembers: TeamMember[]
  orgPhantomMembers?: IndividualMember[]
}) {
  const [members, setMembers] = useState<IndividualMember[]>(initialMembers)
  const [showCreate, setShowCreate] = useState(false)
  const [mode, setMode] = useState<Mode>('new')
  const [linkedMembershipId, setLinkedMembershipId] = useState<string>('')
  const [selectedPhantomId, setSelectedPhantomId] = useState<string>('')
  const [prenom, setPrenom] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [roleLabel, setRoleLabel] = useState('')
  const [tauxHoraire, setTauxHoraire] = useState('')
  const [sendInvite, setSendInvite] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)

  // État d'édition inline
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editPrenom, setEditPrenom] = useState('')
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editRole, setEditRole] = useState('')
  const [editTaux, setEditTaux] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const reset = () => {
    setMode('new'); setLinkedMembershipId(''); setSelectedPhantomId(''); setPrenom(''); setName('')
    setEmail(''); setRoleLabel(''); setTauxHoraire(''); setSendInvite(true)
    setError(null)
  }

  const startEdit = (m: IndividualMember) => {
    setEditingId(m.id)
    setEditPrenom(m.prenom ?? '')
    setEditName(m.name ?? '')
    setEditEmail(m.email ?? '')
    setEditRole(m.role_label ?? '')
    setEditTaux(m.taux_horaire != null ? String(m.taux_horaire) : '')
    setEditError(null)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditError(null)
  }

  const handleSaveEdit = async (memberId: string) => {
    if (!editName.trim()) { setEditError('Le nom est requis.'); return }
    const taux = editTaux ? parseFloat(editTaux.replace(',', '.')) : null
    if (editTaux && (taux === null || isNaN(taux) || taux < 0)) {
      setEditError('Taux horaire invalide.'); return
    }
    setEditSaving(true)
    setEditError(null)
    const { error: err } = await updateIndividualMember(memberId, {
      prenom: editPrenom.trim() || null,
      name: editName.trim(),
      email: editEmail.trim() || null,
      roleLabel: editRole.trim() || null,
      tauxHoraire: taux,
    })
    setEditSaving(false)
    if (err) { setEditError(err); return }
    setMembers(prev => prev.map(m =>
      m.id === memberId
        ? { ...m, prenom: editPrenom.trim() || null, name: editName.trim(), email: editEmail.trim() || null, role_label: editRole.trim() || null, taux_horaire: taux }
        : m
    ))
    setEditingId(null)
  }

  const handleCreate = async () => {
    setError(null)
    if (mode === 'phantom') {
      if (!selectedPhantomId) { setError('Sélectionnez un membre.'); return }
      if (members.some(m => m.id === selectedPhantomId)) { setError('Ce membre est déjà sur ce chantier.'); return }
      setSaving(true)
      const { error: err } = await attachMemberToChantier(selectedPhantomId, chantierId)
      setSaving(false)
      if (err) { setError(err); return }
      const phantom = orgPhantomMembers.find(p => p.id === selectedPhantomId)
      if (phantom) setMembers(prev => [phantom, ...prev])
      setShowCreate(false)
      reset()
      return
    }
    if (mode === 'existing') {
      const m = orgMembers.find(o => o.membership_id === linkedMembershipId)
      if (!m) { setError('Sélectionnez un membre.'); return }
      setSaving(true)
      const fullName = (m.full_name ?? '').trim() || m.email
      const parts = fullName.split(' ')
      const firstName = parts.length > 1 ? parts[0] : null
      const lastName = parts.length > 1 ? parts.slice(1).join(' ') : fullName
      const { error: err, id } = await createIndividualMember({
        prenom: firstName,
        name: lastName,
        email: m.email,
        roleLabel: m.role_name ?? null,
        linkToProfileId: m.user_id,
        attachToChantierId: chantierId,
        sendInvite: false,
      })
      setSaving(false)
      if (err || !id) { setError(err ?? 'Erreur inconnue.'); return }
      const optimistic: IndividualMember = {
        id, organization_id: '', equipe_id: null, prenom: firstName, name: lastName,
        email: m.email, role_label: m.role_name ?? null, taux_horaire: m.labor_cost_per_hour ?? null,
        profile_id: m.user_id, created_at: new Date().toISOString(),
      }
      setMembers(prev => [optimistic, ...prev])
    } else {
      if (!name.trim()) { setError('Le nom est requis.'); return }
      const taux = tauxHoraire ? parseFloat(tauxHoraire.replace(',', '.')) : null
      if (tauxHoraire && (taux === null || isNaN(taux) || taux < 0)) {
        setError('Taux horaire invalide.'); return
      }
      setSaving(true)
      const { error: err, id } = await createIndividualMember({
        prenom: prenom.trim() || null,
        name: name.trim(),
        email: email.trim() || null,
        roleLabel: roleLabel.trim() || null,
        tauxHoraire: taux,
        attachToChantierId: chantierId,
        sendInvite: sendInvite && !!email.trim(),
      })
      setSaving(false)
      if (err || !id) { setError(err ?? 'Erreur inconnue.'); return }
      const optimistic: IndividualMember = {
        id, organization_id: '', equipe_id: null,
        prenom: prenom.trim() || null,
        name: name.trim(),
        email: email.trim() || null,
        role_label: roleLabel.trim() || null,
        taux_horaire: taux,
        profile_id: null,
        created_at: new Date().toISOString(),
      }
      setMembers(prev => [optimistic, ...prev])
    }
    setShowCreate(false)
    reset()
  }

  const handleSendInvite = async (memberId: string) => {
    const { error: err } = await sendMemberSpaceInvite(memberId)
    if (err) alert(err)
    else alert('Lien envoyé.')
  }

  const handleDetach = async (memberId: string) => {
    if (!confirm("Retirer ce membre du chantier ? (Il restera dans l'organisation)")) return
    startTransition(async () => {
      const prev = members
      setMembers(p => p.filter(m => m.id !== memberId))
      const { error: err } = await detachMemberFromChantier(memberId, chantierId)
      if (err) { alert(err); setMembers(prev) }
    })
  }

  const handleDelete = async (memberId: string) => {
    if (!confirm("Supprimer définitivement ce membre de l'organisation ?")) return
    startTransition(async () => {
      const prev = members
      setMembers(p => p.filter(m => m.id !== memberId))
      const { error: err } = await deleteIndividualMember(memberId)
      if (err) { alert(err); setMembers(prev) }
    })
  }

  const orgMembersAvailable = orgMembers.filter(om =>
    !members.some(m => m.profile_id === om.user_id)
  )

  const phantomMembersAvailable = orgPhantomMembers.filter(pm =>
    !members.some(m => m.id === pm.id)
  )

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-primary flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-accent" /> Membres individuels
          </h3>
          <p className="text-xs text-secondary mt-0.5">
            Personnes assignées sans équipe. Idéal pour intervenants ponctuels ou petites entreprises.
          </p>
        </div>
        <button onClick={() => { setShowCreate(true); reset() }} className="btn-primary text-sm flex items-center gap-2">
          <Plus className="w-4 h-4" /> Ajouter un membre
        </button>
      </div>

      {showCreate && (
        <div className="card p-4 border border-accent/30 bg-accent/5 space-y-4">
          {/* Tabs */}
          <div className="flex gap-1 p-1 rounded-xl bg-[var(--elevation-1)] w-fit flex-wrap">
            <button
              onClick={() => setMode('new')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                mode === 'new' ? 'bg-accent text-white' : 'text-secondary hover:text-primary'
              }`}
            >
              Nouveau (terrain)
            </button>
            <button
              onClick={() => setMode('phantom')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                mode === 'phantom' ? 'bg-accent text-white' : 'text-secondary hover:text-primary'
              }`}
              disabled={phantomMembersAvailable.length === 0}
              title={phantomMembersAvailable.length === 0 ? 'Aucun membre fantôme disponible' : ''}
            >
              Membres de l&apos;org {phantomMembersAvailable.length > 0 && `(${phantomMembersAvailable.length})`}
            </button>
            <button
              onClick={() => setMode('existing')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                mode === 'existing' ? 'bg-accent text-white' : 'text-secondary hover:text-primary'
              }`}
              disabled={orgMembersAvailable.length === 0}
              title={orgMembersAvailable.length === 0 ? "Aucun compte org disponible" : ''}
            >
              Compte org
            </button>
          </div>

          {mode === 'phantom' ? (
            <div>
              <label className="text-xs font-semibold text-secondary block mb-1.5">
                Sélectionner un membre existant de l&apos;organisation
              </label>
              <select
                className="input w-full text-sm"
                value={selectedPhantomId}
                onChange={e => setSelectedPhantomId(e.target.value)}
              >
                <option value="">— Choisir —</option>
                {phantomMembersAvailable.map(pm => {
                  const fullName = [pm.prenom, pm.name].filter(Boolean).join(' ')
                  return (
                    <option key={pm.id} value={pm.id}>
                      {fullName}{pm.role_label ? ` · ${pm.role_label}` : ''}{pm.taux_horaire != null ? ` · ${pm.taux_horaire}€/h` : ''}
                    </option>
                  )
                })}
              </select>
              <p className="text-xs text-secondary mt-1.5">
                Ce membre sera rattaché à ce chantier sans être recréé.
              </p>
            </div>
          ) : mode === 'existing' ? (
            <div>
              <label className="text-xs font-semibold text-secondary block mb-1.5">
                Sélectionner un membre de l&apos;organisation
              </label>
              <select
                className="input w-full text-sm"
                value={linkedMembershipId}
                onChange={e => setLinkedMembershipId(e.target.value)}
              >
                <option value="">— Choisir —</option>
                {orgMembersAvailable.map(om => (
                  <option key={om.membership_id} value={om.membership_id}>
                    {om.full_name ?? om.email}{om.role_name ? ` · ${om.role_name}` : ''}
                  </option>
                ))}
              </select>
              <p className="text-xs text-secondary mt-1.5">
                Le taux horaire défini sur le compte sera utilisé. Pas besoin d&apos;envoi de lien (compte existant).
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <input
                  className="input w-full text-sm"
                  placeholder="Prénom"
                  value={prenom}
                  onChange={e => setPrenom(e.target.value)}
                />
                <input
                  className="input w-full text-sm"
                  placeholder="Nom *"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                />
              </div>
              <input
                className="input w-full text-sm"
                type="email"
                placeholder="Email (facultatif — permet d'envoyer le rapport et le lien d'accès)"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  className="input w-full text-sm"
                  placeholder="Rôle (ex : Sous-traitant, Apprenti)"
                  value={roleLabel}
                  onChange={e => setRoleLabel(e.target.value)}
                />
                <input
                  className="input w-full text-sm"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Taux horaire (€/h)"
                  value={tauxHoraire}
                  onChange={e => setTauxHoraire(e.target.value)}
                />
              </div>
              {email.trim() && (
                <label className="flex items-center gap-2 cursor-pointer text-sm text-secondary">
                  <input type="checkbox" checked={sendInvite} onChange={e => setSendInvite(e.target.checked)} className="accent-[var(--accent)]" />
                  Envoyer le lien d&apos;accès à son espace personnel par email
                </label>
              )}
            </div>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex gap-2 justify-end">
            <button onClick={() => { setShowCreate(false); reset() }} className="btn-secondary text-sm">Annuler</button>
            <button onClick={handleCreate} disabled={saving} className="btn-primary text-sm flex items-center gap-1.5">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {saving ? 'Création…' : 'Ajouter au chantier'}
            </button>
          </div>
        </div>
      )}

      {members.length === 0 && !showCreate && (
        <div className="card p-6 text-center text-secondary text-sm">
          <UserPlus className="w-8 h-8 mx-auto opacity-30 mb-2" />
          Aucun membre individuel sur ce chantier.
        </div>
      )}

      {members.length > 0 && (
        <div className="space-y-2">
          {members.map(m => {
            const fullName = [m.prenom, m.name].filter(Boolean).join(' ') || m.name
            const isEditing = editingId === m.id

            if (isEditing) {
              return (
                <div key={m.id} className="card p-4 border border-accent/30 bg-accent/5 space-y-3">
                  <p className="text-xs font-semibold text-secondary uppercase tracking-wide">Modifier le membre</p>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      className="input w-full text-sm"
                      placeholder="Prénom"
                      value={editPrenom}
                      onChange={e => setEditPrenom(e.target.value)}
                      autoFocus
                    />
                    <input
                      className="input w-full text-sm"
                      placeholder="Nom *"
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                    />
                  </div>
                  <input
                    className="input w-full text-sm"
                    type="email"
                    placeholder="Email"
                    value={editEmail}
                    onChange={e => setEditEmail(e.target.value)}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      className="input w-full text-sm"
                      placeholder="Rôle"
                      value={editRole}
                      onChange={e => setEditRole(e.target.value)}
                    />
                    <input
                      className="input w-full text-sm"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Taux horaire (€/h)"
                      value={editTaux}
                      onChange={e => setEditTaux(e.target.value)}
                    />
                  </div>
                  {editError && <p className="text-xs text-red-500">{editError}</p>}
                  <div className="flex gap-2 justify-end">
                    <button onClick={cancelEdit} className="btn-secondary text-sm">Annuler</button>
                    <button onClick={() => handleSaveEdit(m.id)} disabled={editSaving} className="btn-primary text-sm flex items-center gap-1.5">
                      {editSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      {editSaving ? 'Enregistrement…' : 'Enregistrer'}
                    </button>
                  </div>
                </div>
              )
            }

            return (
              <div key={m.id} className="card p-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-accent/15 text-accent flex items-center justify-center font-bold flex-shrink-0">
                  {fullName[0]?.toUpperCase() ?? '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-primary truncate flex items-center gap-2">
                    {fullName}
                    {m.profile_id ? (
                      <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-500">Compte org</span>
                    ) : (
                      <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500">Externe</span>
                    )}
                  </p>
                  <p className="text-xs text-secondary truncate">
                    {m.role_label ?? '—'}
                    {m.email && <> · <Mail className="inline w-3 h-3" /> {m.email}</>}
                    {m.taux_horaire != null && <> · {m.taux_horaire}€/h</>}
                  </p>
                </div>
                {m.email && !m.profile_id && (
                  <button
                    onClick={() => handleSendInvite(m.id)}
                    className="text-xs text-accent hover:text-accent/80 flex items-center gap-1 px-2 py-1 rounded hover:bg-accent/10 transition-colors flex-shrink-0"
                    title="Renvoyer le lien d'accès à son espace"
                  >
                    <Send className="w-3 h-3" /> Lien d&apos;accès
                  </button>
                )}
                <button
                  onClick={() => startEdit(m)}
                  className="p-1.5 rounded text-secondary hover:text-primary hover:bg-[var(--elevation-1)] transition-colors flex-shrink-0"
                  title="Modifier ce membre"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleDetach(m.id)}
                  className="p-1.5 rounded text-secondary hover:text-amber-500 hover:bg-amber-500/10 transition-colors flex-shrink-0"
                  title="Retirer du chantier"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleDelete(m.id)}
                  className="p-1.5 rounded text-secondary hover:text-red-500 hover:bg-red-500/10 transition-colors flex-shrink-0"
                  title="Supprimer définitivement"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
