'use client'
// @atelier-migrated

import { useState, useTransition } from 'react'
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
import { AlertDialog } from '@/components/ui/AlertDialog'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { CheckRow, ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Hud } from '@/components/ui/Hud'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Sheet } from '@/components/ui/Sheet'
import { StatusPill } from '@/components/ui/StatusPill'
import styles from '../../finances/quote-editor/QuoteEditor.module.css'

type Mode = 'existing' | 'phantom' | 'new'

/** Membres rattachés au chantier sans équipe : comptes de l'application ou intervenants externes. */
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
  const [hudMessage, setHudMessage] = useState<string | null>(null)
  const [lastDetached, setLastDetached] = useState<IndividualMember | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

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
    if (err) setEditError(err)
    else setHudMessage('Lien d’accès envoyé.')
  }

  const handleDetach = async (memberId: string) => {
    setDetachingIds(prev => new Set(prev).add(memberId))
    startTransition(async () => {
      const prev = members
      setMembers(p => p.filter(m => m.id !== memberId))
      const { error: err } = await detachMemberFromChantier(memberId, chantierId)
      setDetachingIds(current => { const next = new Set(current); next.delete(memberId); return next })
      if (err) { setEditError(err); setMembers(prev) }
      else { setLastDetached(prev.find(m => m.id === memberId) ?? null); setHudMessage('Membre retiré du chantier.') }
    })
  }

  const handleDelete = async (memberId: string) => {
    setDeletingIds(prev => new Set(prev).add(memberId))
    startTransition(async () => {
      const prev = members
      setMembers(p => p.filter(m => m.id !== memberId))
      const { error: err } = await deleteIndividualMember(memberId)
      setDeletingIds(current => { const next = new Set(current); next.delete(memberId); return next })
      if (err) { setEditError(err); setMembers(prev) }
    })
  }

  const orgMembersAvailable = orgMembers.filter(om =>
    !members.some(m => m.profile_id === om.user_id)
  )
  const phantomMembersAvailable = orgPhantomMembers.filter(pm =>
    !members.some(m => m.id === pm.id)
  )

  const roleField = (value: string, onChange: (value: string) => void) => orgRoles.length === 0 ? (
    <Field type="text" label="Rôle" value={value} onChange={e => onChange(e.target.value)} />
  ) : (
    <Field type="select" label="Rôle" value={value} onChange={e => onChange(e.target.value)}>
      <option value="">Sans rôle</option>
      {value && !orgRoles.some(role => role.name === value) && <option value={value}>{value}</option>}
      {orgRoles.map(role => <option key={role.id} value={role.name}>{role.name}</option>)}
    </Field>
  )

  const editing = editingId ? members.find(m => m.id === editingId) ?? null : null
  const memberName = (m: IndividualMember) => [m.prenom, m.name].filter(Boolean).join(' ') || m.name
  const memberSummary = (m: IndividualMember) =>
    [m.role_label, m.email, canEditRates && m.taux_horaire != null ? `${m.taux_horaire} €/h` : null].filter(Boolean).join(' · ') || undefined

  const modeOptions = [
    { value: 'new', label: 'Nouvel externe' },
    ...(phantomMembersAvailable.length > 0 ? [{ value: 'phantom', label: `Externes (${phantomMembersAvailable.length})` }] : []),
    ...(orgMembersAvailable.length > 0 ? [{ value: 'existing', label: 'Comptes' }] : []),
  ]

  return (
    <section className={styles.detail}>
      <ListGroup
        title="Membres individuels"
        description="Personnes ajoutées sans équipe : intervenants ponctuels ou petites entreprises."
        action={<Button variant="secondary" size="sm" onClick={() => { setShowCreate(true); reset() }}>Ajouter</Button>}
      >
        {members.length === 0 && <ListRow title="Aucun membre individuel sur ce chantier" />}
        {members.map(m => {
          const isMe = Boolean(currentUserId && m.profile_id === currentUserId)
          return (
            <ListRow
              key={m.id}
              title={memberName(m)}
              description={memberSummary(m)}
              onClick={() => startEdit(m)}
              trailing={
                <StatusPill status={m.profile_id ? 'success' : 'neutral'}>
                  {isMe ? 'Moi' : m.profile_id ? 'Compte' : 'Externe'}
                </StatusPill>
              }
            />
          )
        })}
      </ListGroup>

      {showCreate && (
        <Sheet
          open
          onOpenChange={open => { if (!open && !saving) { setShowCreate(false); reset() } }}
          title="Ajouter un membre"
          onConfirm={handleCreate}
          confirmLabel="Ajouter au chantier"
          confirmLoading={saving}
        >
          <div className={styles.detail}>
            {modeOptions.length > 1 && (
              <SegmentedControl fullWidth label="Type de membre" value={mode} options={modeOptions} onChange={v => setMode(v as Mode)} />
            )}
            {error && <p className={`${styles.hint} ${styles.warn}`} role="alert" style={{ marginTop: 0 }}>{error}</p>}

            {mode === 'phantom' && (
              <ListGroup title="Intervenants externes de l’organisation" description="Ils seront rattachés à ce chantier sans être recréés.">
                {phantomMembersAvailable.map(pm => (
                  <CheckRow
                    key={pm.id}
                    title={[pm.prenom, pm.name].filter(Boolean).join(' ')}
                    description={[pm.role_label, canEditRates && pm.taux_horaire != null ? `${pm.taux_horaire} €/h` : null].filter(Boolean).join(' · ') || undefined}
                    checked={selectedPhantomIds.has(pm.id)}
                    onCheckedChange={() => togglePhantomMember(pm.id)}
                  />
                ))}
              </ListGroup>
            )}

            {mode === 'existing' && (
              <ListGroup title="Comptes de l’application" description="Le taux horaire du compte est repris. Pas de lien d’accès à envoyer : le compte existe déjà.">
                {orgMembersAvailable.map(om => (
                  <CheckRow
                    key={om.membership_id}
                    title={currentUserId === om.user_id ? 'Moi' : (om.full_name ?? om.email)}
                    description={om.role_name ?? undefined}
                    checked={linkedMembershipIds.has(om.membership_id)}
                    onCheckedChange={() => toggleLinkedMembership(om.membership_id)}
                  />
                ))}
              </ListGroup>
            )}

            {mode === 'new' && (
              <>
                <div className={styles.fields}>
                  <Field type="text" label="Prénom" value={prenom} onChange={e => setPrenom(e.target.value)} />
                  <Field type="text" label="Nom" value={name} onChange={e => setName(e.target.value)} required />
                  <Field type="email" label="Email" hint="Facultatif : permet d’envoyer le rapport et le lien d’accès." value={email} onChange={e => setEmail(e.target.value)} />
                  {roleField(roleLabel, setRoleLabel)}
                  {canEditRates && <Field type="text" inputMode="decimal" label="Taux horaire (€/h)" value={tauxHoraire} onChange={e => setTauxHoraire(e.target.value)} />}
                </div>
                {email.trim() && (
                  <ListGroup>
                    <CheckRow title="Envoyer le lien d’accès à son espace personnel" description="Par email, à l’adresse saisie." checked={sendInvite} onCheckedChange={setSendInvite} />
                  </ListGroup>
                )}
              </>
            )}
          </div>
        </Sheet>
      )}

      {editing && (
        <Sheet
          open
          onOpenChange={open => { if (!open && !editSaving) cancelEdit() }}
          title={memberName(editing)}
          description={memberSummary(editing)}
          onConfirm={() => handleSaveEdit(editing.id)}
          confirmLabel="Enregistrer"
          confirmLoading={editSaving}
        >
          <div className={styles.detail}>
            {editError && <p className={`${styles.hint} ${styles.warn}`} role="alert" style={{ marginTop: 0 }}>{editError}</p>}
            <div className={styles.fields}>
              <Field type="text" label="Prénom" value={editPrenom} onChange={e => setEditPrenom(e.target.value)} />
              <Field type="text" label="Nom" value={editName} onChange={e => setEditName(e.target.value)} />
              <Field type="email" label="Email" value={editEmail} onChange={e => setEditEmail(e.target.value)} />
              {roleField(editRole, setEditRole)}
              {canEditRates && (
                <Field
                  type="text"
                  inputMode="decimal"
                  label="Taux horaire (€/h)"
                  hint={editing.profile_id ? 'Modifie le taux du compte lié.' : undefined}
                  value={editTaux}
                  onChange={e => setEditTaux(e.target.value)}
                />
              )}
            </div>
            <div className={styles.inline}>
              {editing.email && !editing.profile_id && (
                <Button variant="secondary" size="md" onClick={() => handleSendInvite(editing.id)}>Renvoyer le lien d’accès</Button>
              )}
              <Button
                variant="secondary"
                size="md"
                loading={detachingIds.has(editing.id)}
                onClick={() => { cancelEdit(); handleDetach(editing.id) }}
              >
                Retirer du chantier
              </Button>
              <Button variant="destructive" size="md" onClick={() => setConfirmDeleteId(editing.id)}>Supprimer le membre</Button>
            </div>
          </div>
        </Sheet>
      )}

      <AlertDialog
        open={confirmDeleteId !== null}
        onOpenChange={open => { if (!open) setConfirmDeleteId(null) }}
        title="Supprimer ce membre ?"
        description="Il sera supprimé définitivement de l’organisation. Cette action est irréversible."
        confirmLabel="Supprimer"
        onConfirm={() => {
          const id = confirmDeleteId
          setConfirmDeleteId(null)
          if (id) { cancelEdit(); handleDelete(id) }
        }}
      />

      <Hud
        open={hudMessage !== null}
        onOpenChange={open => { if (!open) { setHudMessage(null); setLastDetached(null) } }}
        message={hudMessage ?? ''}
        onUndo={lastDetached ? () => {
          const back = lastDetached
          setLastDetached(null)
          setHudMessage(null)
          void attachMemberToChantier(back.id, chantierId).then(() => setMembers(prev => [back, ...prev]))
        } : undefined}
      />
    </section>
  )
}
