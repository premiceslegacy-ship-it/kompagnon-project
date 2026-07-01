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
import { updateMemberLaborRate } from '@/lib/data/mutations/team'
import type { OrgRole } from '@/lib/data/queries/roles'

type Mode = 'existing' | 'phantom' | 'new'

export default function IndividualMembersSection({
  chantierId,
  initialMembers,
  orgMembers,
  orgPhantomMembers = [],
  orgRoles = [],
  canEditRates,
  currentUserId,
}: {
  chantierId: string
  initialMembers: IndividualMember[]
  orgMembers: TeamMember[]
  orgPhantomMembers?: IndividualMember[]
  orgRoles?: OrgRole[]
  canEditRates: boolean
  currentUserId?: string | null
}) {
  const [members, setMembers] = useState<IndividualMember[]>(initialMembers)
  const [showCreate, setShowCreate] = useState(false)
  const [mode, setMode] = useState<Mode>('new')
  const [linkedMembershipIds, setLinkedMembershipIds] = useState<Set<string>>(new Set())
  const [selectedPhantomIds, setSelectedPhantomIds] = useState<Set<string>>(new Set())
  const [prenom, setPrenom] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [roleLabel, setRoleLabel] = useState('')
  const [tauxHoraire, setTauxHoraire] = useState('')
  const [sendInvite, setSendInvite] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)
  const [detachingIds, setDetachingIds] = useState<Set<string>>(new Set())
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())

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
    setMode('new'); setLinkedMembershipIds(new Set()); setSelectedPhantomIds(new Set()); setPrenom(''); setName('')
    setEmail(''); setRoleLabel(''); setTauxHoraire(''); setSendInvite(true)
    setError(null)
  }

  const toggleLinkedMembership = (membershipId: string) => {
    setLinkedMembershipIds(prev => {
      const next = new Set(prev)
      next.has(membershipId) ? next.delete(membershipId) : next.add(membershipId)
      return next
    })
  }

  const togglePhantomMember = (memberId: string) => {
    setSelectedPhantomIds(prev => {
      const next = new Set(prev)
      next.has(memberId) ? next.delete(memberId) : next.add(memberId)
      return next
    })
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
    const taux = canEditRates && editTaux ? parseFloat(editTaux.replace(',', '.')) : null
    if (canEditRates && editTaux && (taux === null || isNaN(taux) || taux < 0)) {
      setEditError('Taux horaire invalide.'); return
    }
    setEditSaving(true)
    setEditError(null)

    const member = members.find(m => m.id === memberId)

    // Pour les membres avec compte app, le taux est sur memberships — appel séparé
    if (canEditRates && member?.profile_id) {
      const linkedOrgMember = orgMembers.find(om => om.user_id === member.profile_id)
      if (linkedOrgMember) {
        const { error: rateErr } = await updateMemberLaborRate(linkedOrgMember.membership_id, taux)
        if (rateErr) { setEditSaving(false); setEditError(rateErr); return }
      }
    }

    const { error: err } = await updateIndividualMember(memberId, {
      prenom: editPrenom.trim() || null,
      name: editName.trim(),
      email: editEmail.trim() || null,
      roleLabel: editRole.trim() || null,
      // Pour les membres sans compte, le taux est sur chantier_equipe_membres
      ...(!member?.profile_id && canEditRates && { tauxHoraire: taux }),
    })
    setEditSaving(false)
    if (err) { setEditError(err); return }
    setMembers(prev => prev.map(m =>
      m.id === memberId
        ? { ...m, prenom: editPrenom.trim() || null, name: editName.trim(), email: editEmail.trim() || null, role_label: editRole.trim() || null, ...(canEditRates && { taux_horaire: taux }) }
        : m
    ))
    setEditingId(null)
  }

  const handleCreate = async () => {
    setError(null)
    if (mode === 'phantom') {
      const ids = [...selectedPhantomIds]
      if (ids.length === 0) { setError('Sélectionnez au moins un membre.'); return }
      if (ids.some(id => members.some(m => m.id === id))) { setError('Un membre sélectionné est déjà sur ce chantier.'); return }
      setSaving(true)
      const results = await Promise.all(ids.map(id => attachMemberToChantier(id, chantierId)))
      setSaving(false)
      const err = results.find(result => result.error)?.error
      if (err) { setError(err); return }
      const selected = ids
        .map(id => orgPhantomMembers.find(p => p.id === id))
        .filter(Boolean) as IndividualMember[]
      if (selected.length > 0) setMembers(prev => [...selected, ...prev])
      setShowCreate(false)
      reset()
      return
    }
    if (mode === 'existing') {
      const selectedOrgMembers = [...linkedMembershipIds]
        .map(id => orgMembers.find(o => o.membership_id === id))
        .filter(Boolean) as TeamMember[]
      if (selectedOrgMembers.length === 0) { setError('Sélectionnez au moins un membre.'); return }
      setSaving(true)
      const created = await Promise.all(selectedOrgMembers.map(async m => {
        const fullName = (m.full_name ?? '').trim() || m.email
        const parts = fullName.split(' ')
        const firstName = parts.length > 1 ? parts[0] : null
        const lastName = parts.length > 1 ? parts.slice(1).join(' ') : fullName
        const result = await createIndividualMember({
          prenom: firstName,
          name: lastName,
          email: m.email,
          roleLabel: m.role_name ?? null,
          linkToProfileId: m.user_id,
          attachToChantierId: chantierId,
          sendInvite: false,
        })
        return { result, m, firstName, lastName }
      }))
      setSaving(false)
      const failed = created.find(item => item.result.error || !item.result.id)
      if (failed) { setError(failed.result.error ?? 'Erreur inconnue.'); return }
      const optimistic: IndividualMember[] = created.map(({ result, m, firstName, lastName }) => ({
        id: result.id!,
        organization_id: '',
        equipe_id: null,
        prenom: firstName,
        name: lastName,
        email: m.email,
        role_label: m.role_name ?? null,
        taux_horaire: canEditRates ? m.labor_cost_per_hour ?? null : null,
        profile_id: m.user_id,
        created_at: new Date().toISOString(),
      }))
      setMembers(prev => [...optimistic, ...prev])
    } else {
      if (!name.trim()) { setError('Le nom est requis.'); return }
      const taux = canEditRates && tauxHoraire ? parseFloat(tauxHoraire.replace(',', '.')) : null
      if (canEditRates && tauxHoraire && (taux === null || isNaN(taux) || taux < 0)) {
        setError('Taux horaire invalide.'); return
      }
      setSaving(true)
      const { error: err, id } = await createIndividualMember({
        prenom: prenom.trim() || null,
        name: name.trim(),
        email: email.trim() || null,
        roleLabel: roleLabel.trim() || null,
        ...(canEditRates && { tauxHoraire: taux }),
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
        taux_horaire: canEditRates ? taux : null,
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
    setDetachingIds(prev => new Set(prev).add(memberId))
    startTransition(async () => {
      const prev = members
      setMembers(p => p.filter(m => m.id !== memberId))
      const { error: err } = await detachMemberFromChantier(memberId, chantierId)
      setDetachingIds(current => { const next = new Set(current); next.delete(memberId); return next })
      if (err) { alert(err); setMembers(prev) }
    })
  }

  const handleDelete = async (memberId: string) => {
    if (!confirm("Supprimer définitivement ce membre de l'organisation ?")) return
    setDeletingIds(prev => new Set(prev).add(memberId))
    startTransition(async () => {
      const prev = members
      setMembers(p => p.filter(m => m.id !== memberId))
      const { error: err } = await deleteIndividualMember(memberId)
      setDeletingIds(current => { const next = new Set(current); next.delete(memberId); return next })
      if (err) { alert(err); setMembers(prev) }
    })
  }

  const orgMembersAvailable = orgMembers.filter(om =>
    !members.some(m => m.profile_id === om.user_id)
  )

  const RoleSelect = ({
    value,
    onChange,
    className = 'input w-full text-sm',
  }: {
    value: string
    onChange: (value: string) => void
    className?: string
  }) => {
    if (orgRoles.length === 0) {
      return (
        <input
          className={className}
          placeholder="Rôle"
          value={value}
          onChange={e => onChange(e.target.value)}
        />
      )
    }
    const hasCustomValue = value && !orgRoles.some(role => role.name === value)
    return (
      <select className={className} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">Sans rôle</option>
        {hasCustomValue && <option value={value}>{value}</option>}
        {orgRoles.map(role => (
          <option key={role.id} value={role.name}>{role.name}</option>
        ))}
      </select>
    )
  }

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
              Nouvel externe
            </button>
            <button
              onClick={() => setMode('phantom')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                mode === 'phantom' ? 'bg-accent text-white' : 'text-secondary hover:text-primary'
              }`}
              disabled={phantomMembersAvailable.length === 0}
              title={phantomMembersAvailable.length === 0 ? 'Aucun membre fantôme disponible' : ''}
            >
              Intervenants externes {phantomMembersAvailable.length > 0 && `(${phantomMembersAvailable.length})`}
            </button>
            <button
              onClick={() => setMode('existing')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                mode === 'existing' ? 'bg-accent text-white' : 'text-secondary hover:text-primary'
              }`}
              disabled={orgMembersAvailable.length === 0}
              title={orgMembersAvailable.length === 0 ? "Aucun compte org disponible" : ''}
            >
              Comptes app
            </button>
          </div>

          {mode === 'phantom' ? (
            <div>
              <label className="text-xs font-semibold text-secondary block mb-1.5">
                Intervenants externes déjà créés dans l&apos;organisation
              </label>
              <div className="flex flex-wrap gap-1.5">
                {phantomMembersAvailable.map(pm => {
                  const fullName = [pm.prenom, pm.name].filter(Boolean).join(' ')
                  const selected = selectedPhantomIds.has(pm.id)
                  return (
                    <button
                      key={pm.id}
                      type="button"
                      onClick={() => togglePhantomMember(pm.id)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                        selected ? 'border-accent bg-accent text-white' : 'border-[var(--elevation-border)] text-secondary hover:border-accent/40 hover:text-primary'
                      }`}
                    >
                      {selected && <Check className="h-3 w-3" />}
                      {fullName}{pm.role_label ? ` · ${pm.role_label}` : ''}{canEditRates && pm.taux_horaire != null ? ` · ${pm.taux_horaire}€/h` : ''}
                    </button>
                  )
                })}
              </div>
              <p className="text-xs text-secondary mt-1.5">
                Ces membres seront rattachés à ce chantier sans être recréés.
              </p>
            </div>
          ) : mode === 'existing' ? (
            <div>
              <label className="text-xs font-semibold text-secondary block mb-1.5">
                Comptes application de l&apos;organisation
              </label>
              <div className="flex flex-wrap gap-1.5">
                {orgMembersAvailable.map(om => {
                  const selected = linkedMembershipIds.has(om.membership_id)
                  const isMe = currentUserId === om.user_id
                  return (
                    <button
                      key={om.membership_id}
                      type="button"
                      onClick={() => toggleLinkedMembership(om.membership_id)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                        selected ? 'border-accent bg-accent text-white' : 'border-[var(--elevation-border)] text-secondary hover:border-accent/40 hover:text-primary'
                      }`}
                    >
                      {selected && <Check className="h-3 w-3" />}
                      {isMe ? 'Moi' : (om.full_name ?? om.email)}{om.role_name ? ` · ${om.role_name}` : ''}
                    </button>
                  )
                })}
              </div>
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
                placeholder="Email (facultatif - permet d'envoyer le rapport et le lien d'accès)"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
              <div className="grid grid-cols-2 gap-2">
                <RoleSelect value={roleLabel} onChange={setRoleLabel} />
                {canEditRates && (
                  <input
                    className="input w-full text-sm"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Taux horaire (€/h)"
                    value={tauxHoraire}
                    onChange={e => setTauxHoraire(e.target.value)}
                  />
                )}
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
            const isMe = Boolean(currentUserId && m.profile_id === currentUserId)
            const detaching = detachingIds.has(m.id)
            const deleting = deletingIds.has(m.id)

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
                    <RoleSelect value={editRole} onChange={setEditRole} />
                    {canEditRates && (
                      <div>
                        <input
                          className="input w-full text-sm"
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="Taux horaire (€/h)"
                          value={editTaux}
                          onChange={e => setEditTaux(e.target.value)}
                        />
                        {m.profile_id && (
                          <p className="text-[10px] text-secondary mt-1">Modifie le taux du compte lié</p>
                        )}
                      </div>
                    )}
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
                    {isMe && (
                      <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-accent/15 text-accent">Moi</span>
                    )}
                    {m.profile_id ? (
                      <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-500">Compte application</span>
                    ) : (
                      <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500">Externe</span>
                    )}
                  </p>
                  <p className="text-xs text-secondary truncate">
                    {m.role_label ?? '—'}
                    {m.email && <> · <Mail className="inline w-3 h-3" /> {m.email}</>}
                    {canEditRates && m.taux_horaire != null && <> · {m.taux_horaire}€/h</>}
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
                  disabled={detaching || deleting}
                  className="p-1.5 rounded text-secondary hover:text-amber-500 hover:bg-amber-500/10 transition-colors flex-shrink-0 disabled:opacity-50"
                  title="Retirer du chantier"
                >
                  {detaching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={() => handleDelete(m.id)}
                  disabled={detaching || deleting}
                  className="p-1.5 rounded text-secondary hover:text-red-500 hover:bg-red-500/10 transition-colors flex-shrink-0 disabled:opacity-50"
                  title="Supprimer définitivement"
                >
                  {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
