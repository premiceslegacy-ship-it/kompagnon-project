'use client'
// @atelier-migrated

import { useState } from 'react'
import type { Equipe } from '@/lib/data/queries/chantiers'
import type { TeamMember } from '@/lib/data/queries/team'
import type { OrgRole } from '@/lib/data/queries/roles'
import { getQuoteItemsForSuggestions } from '@/lib/data/mutations/quotes'
import { createEquipe, deleteEquipe, addEquipeMembre, removeEquipeMembre, updateEquipeMembreTaux, updateEquipeMembreProfile, assignEquipeToChantier, removeEquipeFromChantier } from '@/lib/data/mutations/chantiers'
import { AlertDialog } from '@/components/ui/AlertDialog'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { CheckRow, ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Sheet } from '@/components/ui/Sheet'
import { StatusPill } from '@/components/ui/StatusPill'
import { EQUIPE_COLORS } from '../equipes/equipesModel'
import styles from '../../finances/quote-editor/QuoteEditor.module.css'

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

/** Équipes terrain d'un chantier : création, assignation et composition. */
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
  const [suggestionToCreate, setSuggestionToCreate] = useState<string | null>(null)
  const [openEquipeId, setOpenEquipeId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newEquipeName, setNewEquipeName] = useState('')
  const [newEquipeColor, setNewEquipeColor] = useState('#6366f1')
  const [createLoading, setCreateLoading] = useState(false)
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
    setDeletingEquipes(prev => new Set([...prev, equipeId]))
    const { error } = await deleteEquipe(equipeId)
    setDeletingEquipes(prev => { const s = new Set(prev); s.delete(equipeId); return s })
    if (error) { setError(error); return }
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

  const openEquipe = openEquipeId ? allEquipes.find(e => e.id === openEquipeId) ?? null : null
  const suggestionBeingCreated = suggestionToCreate ? teamSuggestions.find(s => s._id === suggestionToCreate) ?? null : null
  const mForm = openEquipe ? memberForms[openEquipe.id] ?? { name: '', role: '', taux: '', profileId: null } : { name: '', role: '', taux: '', profileId: null }

  const roleField = (value: string, onChange: (value: string) => void) => orgRoles.length === 0 ? (
    <Field type="text" label="Rôle" value={value} onChange={e => onChange(e.target.value)} />
  ) : (
    <Field type="select" label="Rôle" value={value} onChange={e => onChange(e.target.value)}>
      <option value="">Sans rôle</option>
      {value && !orgRoles.some(role => role.name === value) && <option value={value}>{value}</option>}
      {orgRoles.map(role => <option key={role.id} value={role.name}>{role.name}</option>)}
    </Field>
  )

  const colorPicker = (value: string, onChange: (color: string) => void) => (
    <div className={styles.inline} role="radiogroup" aria-label="Couleur de l’équipe">
      {EQUIPE_COLORS.map(c => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={`Couleur ${c}`}
          onClick={() => onChange(c)}
          style={{ width: 32, height: 32, borderRadius: '50%', border: value === c ? '3px solid var(--at-encre)' : '3px solid transparent', background: c, cursor: 'pointer' }}
        />
      ))}
    </div>
  )

  return (
    <div className={styles.detail}>
      <ListGroup
        title="Équipes terrain"
        description="Créez des équipes libres et assignez-les à ce chantier."
        action={<Button variant="secondary" size="sm" onClick={() => setShowCreate(true)}>Créer une équipe</Button>}
      >
        {allEquipes.length === 0 && <ListRow title="Aucune équipe créée" description="Créez des équipes pour organiser votre personnel sur le chantier." />}
        {allEquipes.map(equipe => (
          <ListRow
            key={equipe.id}
            title={equipe.name}
            description={`${equipe.membres.length} membre${equipe.membres.length !== 1 ? 's' : ''}`}
            leading={<span aria-hidden="true" style={{ display: 'block', width: 12, height: 12, borderRadius: '50%', background: equipe.color }} />}
            onClick={() => setOpenEquipeId(equipe.id)}
            trailing={assignedIds.has(equipe.id) ? <StatusPill status="success">Assignée</StatusPill> : undefined}
          />
        ))}
      </ListGroup>

      {linkedQuoteId && !showTeamSuggestions && (
        <div className={styles.inline}>
          <Button variant="text" size="md" onClick={handleSuggestTeams} loading={suggestTeamsLoading}>Suggérer des équipes depuis le devis</Button>
        </div>
      )}

      {showTeamSuggestions && teamSuggestions.length > 0 && (
        <ListGroup
          title="Équipes suggérées d’après la main-d’œuvre du devis"
          action={<Button variant="text" size="sm" onClick={() => { setTeamSuggestions([]); setShowTeamSuggestions(false) }}>Fermer</Button>}
        >
          {teamSuggestions.map(sugg => {
            const dot = <span aria-hidden="true" style={{ display: 'block', width: 12, height: 12, borderRadius: '50%', background: sugg.color }} />
            const description = `${sugg.quantity} ${sugg.unit} estimés · ${sugg.rate} €/${sugg.unit}`
            return sugg.created ? (
              <ListRow key={sugg._id} title={sugg.name} description={description} leading={dot} trailing={<StatusPill status="success">Créée</StatusPill>} />
            ) : (
              <ListRow key={sugg._id} title={sugg.name} description={description} leading={dot} onClick={() => setSuggestionToCreate(sugg._id)} trailing={<span aria-hidden="true">›</span>} />
            )
          })}
        </ListGroup>
      )}

      {error && !openEquipe && <p className={`${styles.hint} ${styles.warn}`} role="alert" style={{ marginTop: 0 }}>{error}</p>}

      {showCreate && (
        <Sheet
          open
          onOpenChange={open => { if (!open && !createLoading) setShowCreate(false) }}
          title="Nouvelle équipe"
          onConfirm={handleCreateEquipe}
          confirmLabel="Créer l’équipe"
          confirmLoading={createLoading}
          confirmDisabled={!newEquipeName.trim()}
        >
          <div className={styles.detail}>
            <div className={styles.fields}>
              <Field type="text" label="Nom" placeholder="Équipe Nettoyage Nord" value={newEquipeName} onChange={e => setNewEquipeName(e.target.value)} autoFocus />
            </div>
            {colorPicker(newEquipeColor, setNewEquipeColor)}
          </div>
        </Sheet>
      )}

      {suggestionBeingCreated && (
        <Sheet
          open
          onOpenChange={open => { if (!open) setSuggestionToCreate(null) }}
          title="Créer cette équipe"
          description={`${suggestionBeingCreated.quantity} ${suggestionBeingCreated.unit} estimés`}
          onConfirm={async () => { await handleCreateFromSuggestion(suggestionBeingCreated._id); setSuggestionToCreate(null) }}
          confirmLabel="Créer et assigner"
          confirmDisabled={!suggestionBeingCreated.name.trim()}
        >
          <div className={styles.detail}>
            <div className={styles.fields}>
              <Field
                type="text"
                label="Nom"
                value={suggestionBeingCreated.name}
                onChange={e => setTeamSuggestions(prev => prev.map(s => (s._id === suggestionBeingCreated._id ? { ...s, name: e.target.value } : s)))}
              />
            </div>
            {colorPicker(suggestionBeingCreated.color, color => setTeamSuggestions(prev => prev.map(s => (s._id === suggestionBeingCreated._id ? { ...s, color } : s))))}
          </div>
        </Sheet>
      )}

      {openEquipe && (
        <Sheet
          open
          onOpenChange={open => { if (!open) { setOpenEquipeId(null); setError(null) } }}
          title={openEquipe.name}
          description={`${openEquipe.membres.length} membre${openEquipe.membres.length !== 1 ? 's' : ''}`}
          cancelLabel="Fermer"
        >
          <div className={styles.detail}>
            {error && <p className={`${styles.hint} ${styles.warn}`} role="alert" style={{ marginTop: 0 }}>{error}</p>}
            <ListGroup>
              <CheckRow
                title="Assignée à ce chantier"
                checked={assignedIds.has(openEquipe.id)}
                onCheckedChange={() => handleToggleAssign(openEquipe.id)}
              />
            </ListGroup>

            <ListGroup title="Membres">
              {openEquipe.membres.length === 0 && <ListRow title="Aucun membre" description="Ajoutez-en ci-dessous." />}
              {openEquipe.membres.map(m => {
                const isMe = Boolean(currentUserId && m.profile_id === currentUserId)
                return (
                  <ListRow
                    key={m.id}
                    title={m.name}
                    description={[m.role_label, canEditRates && m.taux_horaire != null ? `${m.taux_horaire} €/h` : null].filter(Boolean).join(' · ') || undefined}
                    trailing={
                      <span className={styles.inline}>
                        <StatusPill status={m.profile_id ? 'success' : 'neutral'}>{isMe ? 'Moi' : m.profile_id ? 'Lié' : 'Externe'}</StatusPill>
                        <Button variant="text" size="sm" loading={removingMembres.has(m.id)} onClick={() => handleRemoveMembre(openEquipe.id, m.id)}>Retirer</Button>
                      </span>
                    }
                  />
                )
              })}
            </ListGroup>

            {canEditRates && openEquipe.membres.length > 0 && (
              <div className={styles.fields}>
                {openEquipe.membres.map(m => (
                  <Field
                    key={m.id}
                    type="text"
                    inputMode="decimal"
                    label={`${m.name} · €/h`}
                    value={editingMembreTaux[m.id] ?? (m.taux_horaire != null ? String(m.taux_horaire) : '')}
                    onChange={e => setEditingMembreTaux(prev => ({ ...prev, [m.id]: e.target.value }))}
                    onBlur={() => { if (editingMembreTaux[m.id] !== undefined) void handleSaveMembreTaux(openEquipe.id, m.id) }}
                  />
                ))}
              </div>
            )}

            {orgMembers.length > 0 && openEquipe.membres.some(m => !m.profile_id) && (
              <div className={styles.fields}>
                {openEquipe.membres.filter(m => !m.profile_id).map(m => (
                  <Field
                    key={m.id}
                    type="select"
                    label={`Lier ${m.name} à un compte`}
                    value=""
                    onChange={async e => {
                      const uid = e.target.value
                      if (!uid) return
                      await updateEquipeMembreProfile(m.id, uid)
                      setAllEquipes(prev => prev.map(eq => (eq.id !== openEquipe.id ? eq : {
                        ...eq,
                        membres: eq.membres.map(mm => (mm.id !== m.id ? mm : { ...mm, profile_id: uid })),
                      })))
                    }}
                  >
                    <option value="">Aucun</option>
                    {orgMembers.map(om => <option key={om.user_id} value={om.user_id}>{om.full_name ?? om.email}</option>)}
                  </Field>
                ))}
              </div>
            )}

            {(() => {
              const pending = pendingMembreIds[openEquipe.id] ?? new Set<string>()
              const available = orgMembers.filter(m => !openEquipe.membres.some(em => em.profile_id === m.user_id))
              if (!available.length) return null
              return (
                <>
                  <ListGroup title="Comptes de l’application">
                    {available.map(m => (
                      <CheckRow
                        key={m.user_id}
                        title={currentUserId === m.user_id ? 'Moi' : (m.full_name ?? m.email)}
                        description={m.job_title ?? undefined}
                        checked={pending.has(m.user_id)}
                        onCheckedChange={checked => setPendingMembreIds(prev => {
                          const cur = new Set(prev[openEquipe.id] ?? [])
                          if (checked) cur.add(m.user_id)
                          else cur.delete(m.user_id)
                          return { ...prev, [openEquipe.id]: cur }
                        })}
                      />
                    ))}
                  </ListGroup>
                  {pending.size > 0 && (
                    <div className={styles.inline}>
                      <Button variant="secondary" size="md" loading={addingMembres.has(openEquipe.id)} onClick={() => handleAddMultipleMembres(openEquipe.id)}>
                        {`Ajouter ${pending.size} compte${pending.size > 1 ? 's' : ''}`}
                      </Button>
                    </div>
                  )}
                </>
              )
            })()}

            <p className={styles.hint} style={{ marginTop: 0 }}>Intervenant externe sans compte de l’application</p>
            <div className={styles.fields}>
              <Field type="text" label="Nom" value={mForm.name} onChange={e => setMemberForms(prev => ({ ...prev, [openEquipe.id]: { ...mForm, name: e.target.value } }))} />
              {roleField(mForm.role, value => setMemberForms(prev => ({ ...prev, [openEquipe.id]: { ...mForm, role: value } })))}
              {canEditRates && (
                <Field type="text" inputMode="decimal" label="Taux horaire (€/h)" value={mForm.taux ?? ''} onChange={e => setMemberForms(prev => ({ ...prev, [openEquipe.id]: { ...mForm, taux: e.target.value } }))} />
              )}
            </div>
            <div className={styles.inline}>
              <Button variant="secondary" size="md" onClick={() => handleAddMembre(openEquipe.id)} disabled={!mForm.name.trim()} loading={addingMembres.has(openEquipe.id)}>
                Ajouter l’intervenant
              </Button>
              <Button variant="destructive" size="md" onClick={() => setConfirmDeleteId(openEquipe.id)} loading={deletingEquipes.has(openEquipe.id)}>
                Supprimer l’équipe
              </Button>
            </div>
          </div>
        </Sheet>
      )}

      <AlertDialog
        open={confirmDeleteId !== null}
        onOpenChange={open => { if (!open) setConfirmDeleteId(null) }}
        title="Supprimer cette équipe ?"
        description="Les membres sont conservés comme intervenants individuels."
        confirmLabel="Supprimer"
        onConfirm={async () => {
          const id = confirmDeleteId
          setConfirmDeleteId(null)
          if (id) { await handleDeleteEquipe(id); setOpenEquipeId(null) }
        }}
      />
    </div>
  )
}
