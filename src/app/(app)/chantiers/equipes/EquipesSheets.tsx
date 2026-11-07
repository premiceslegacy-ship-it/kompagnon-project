'use client'
// @atelier-migrated
// Feuilles de la page Équipes : intervenant, équipe, ajout d'un intervenant existant, taux d'un compte.

import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Sheet } from '@/components/ui/Sheet'
import { Switch } from '@/components/ui/Switch'
import type { OrgRole } from '@/lib/data/queries/roles'
import { EQUIPE_COLORS, fullName, type Dispo } from './equipesModel'
import type { EquipesState } from './useEquipes'
import screen from '@/components/layout/Screen.module.css'
import styles from '../../finances/quote-editor/QuoteEditor.module.css'
import fiche from '../[chantierId]/ChantierFiche.module.css'

function RoleField({ value, onChange, roles }: { value: string; onChange: (v: string) => void; roles: OrgRole[] }) {
  if (roles.length === 0) return <Field type="text" label="Rôle" placeholder="Chef d’équipe…" value={value} onChange={e => onChange(e.target.value)} />
  const custom = value && !roles.some(r => r.name === value)
  return (
    <Field type="select" label="Rôle" value={value} onChange={e => onChange(e.target.value)}>
      <option value="">Sans rôle</option>
      {custom && <option value={value}>{value}</option>}
      {roles.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
    </Field>
  )
}

/** Intervenant : création (solo ou dans une équipe) ou modification. */
export function MembreSheet({ q, orgRoles }: { q: EquipesState; orgRoles: OrgRole[] }) {
  const modal = q.membreModal
  if (!modal) return null
  const edit = modal.mode === 'edit'
  const solo = modal.mode === 'new-solo'
  const membre = modal.membre
  const inEquipe = edit && membre && 'equipe_id' in membre && membre.equipe_id
  const invited = membre ? q.inviteSent.has(membre.id) : false
  return (
    <Sheet
      open
      onOpenChange={o => { if (!o) q.setMembreModal(null) }}
      title={edit ? 'Modifier l’intervenant' : solo ? 'Nouvel intervenant' : 'Nouveau membre de l’équipe'}
      confirmLabel={edit ? 'Enregistrer' : 'Ajouter'}
      confirmLoading={q.saving}
      confirmDisabled={!q.fName.trim()}
      onConfirm={q.handleSaveMembre}
    >
      <div className={styles.stack}>
        <div className={styles.fields}>
          <Field type="text" label="Prénom" value={q.fPrenom} onChange={e => q.setFPrenom(e.target.value)} />
          <Field type="text" label="Nom" placeholder="Nom de famille" value={q.fName} onChange={e => q.setFName(e.target.value)} />
          <Field type="text" label="Email" inputMode="email" placeholder="email@exemple.com" value={q.fEmail} onChange={e => q.setFEmail(e.target.value)} />
          <RoleField value={q.fRole} onChange={q.setFRole} roles={orgRoles} />
          {q.canEditRates && <Field type="text" label="Taux horaire (€/h)" inputMode="decimal" value={q.fTaux} onChange={e => q.setFTaux(e.target.value)} />}
        </div>
        {solo && q.fEmail.trim() && (
          <ListGroup description="L’intervenant reçoit un lien pour pointer ses heures sans compte.">
            <ListRow title="Envoyer l’accès à l’espace membre" trailing={<Switch label="Envoyer l’accès à l’espace membre" checked={q.fSendInvite} onChange={q.setFSendInvite} />} />
          </ListGroup>
        )}
        {edit && membre && (
          <ListGroup>
            {!inEquipe && membre.email && <ListRow title={invited ? 'Invitation envoyée' : 'Envoyer l’accès à l’espace membre'} disabled={invited} onClick={() => q.handleInvite(membre.id)} />}
            {inEquipe && <ListRow title="Retirer de l’équipe" description="Il reste dans la liste des intervenants." onClick={() => { q.setMembreModal(null); q.handleRetirerDeEquipe(membre.id) }} />}
            <li className={styles.destructiveRow}>
              <button type="button" onClick={() => { q.setMembreModal(null); q.setConfirmDelete({ type: 'membre', id: membre.id, label: fullName(membre), soloMembre: !inEquipe }) }}>Supprimer définitivement</button>
            </li>
          </ListGroup>
        )}
        {q.error && <p className={screen.error} role="alert">{q.error}</p>}
      </div>
    </Sheet>
  )
}

/** Équipe : nom, couleur, description. */
export function EquipeSheet({ q }: { q: EquipesState }) {
  const modal = q.equipeModal
  if (!modal) return null
  return (
    <Sheet
      open
      onOpenChange={o => { if (!o) q.setEquipeModal(null) }}
      title={modal.mode === 'edit' ? 'Modifier l’équipe' : 'Nouvelle équipe'}
      confirmLabel={modal.mode === 'edit' ? 'Enregistrer' : 'Créer l’équipe'}
      confirmLoading={q.saving}
      confirmDisabled={!q.fEquipeName.trim()}
      onConfirm={q.handleSaveEquipe}
    >
      <div className={styles.stack}>
        <div className={styles.fields}>
          <Field type="text" label="Nom" placeholder="Équipe Nettoyage…" value={q.fEquipeName} onChange={e => q.setFEquipeName(e.target.value)} />
          <Field type="text" label="Description" placeholder="Spécialité, zone géographique…" value={q.fEquipeDesc} onChange={e => q.setFEquipeDesc(e.target.value)} />
        </div>
        <fieldset className={styles.fields} style={{ border: 0, margin: 0, padding: '12px 16px' }}>
          <legend className={fiche.kpiLabel}>Couleur</legend>
          <div className={fiche.picks} role="radiogroup" aria-label="Couleur de l’équipe">
            {EQUIPE_COLORS.map(c => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={q.fEquipeColor === c}
                aria-label={`Couleur ${c}`}
                onClick={() => q.setFEquipeColor(c)}
                style={{ width: 32, height: 32, borderRadius: '50%', border: q.fEquipeColor === c ? '3px solid var(--at-encre)' : '3px solid transparent', background: c, cursor: 'pointer' }}
              />
            ))}
          </div>
        </fieldset>
        {q.error && <p className={screen.error} role="alert">{q.error}</p>}
      </div>
    </Sheet>
  )
}

/** Ajouter à une équipe un intervenant solo ou venu d'une autre équipe. */
export function ExistingSheet({ q, equipeId, available }: { q: EquipesState; equipeId: string; available: Dispo[] }) {
  return (
    <Sheet
      open
      onOpenChange={o => { if (!o) { q.setShowAddExistant(null); q.setSelectedExistant('') } }}
      title="Ajouter un intervenant existant"
      confirmLabel="Ajouter"
      confirmLoading={q.saving}
      confirmDisabled={!q.selectedExistant}
      onConfirm={() => q.handleAddExistant(equipeId)}
    >
      <div className={styles.stack}>
        <Field type="select" label="Intervenant" value={q.selectedExistant} onChange={e => q.setSelectedExistant(e.target.value)}>
          <option value="">Choisir un intervenant…</option>
          {available.map(m => <option key={m.id} value={m.id}>{fullName(m)}{m.equipe_name ? ` (${m.equipe_name})` : ' (solo)'}</option>)}
        </Field>
        {q.error && <p className={screen.error} role="alert">{q.error}</p>}
      </div>
    </Sheet>
  )
}

/** Taux horaire d'un compte de l'application. */
export function AppRateSheet({ q }: { q: EquipesState }) {
  const m = q.appMembersState.find(x => x.membership_id === q.editingAppMemberId)
  if (!m) return null
  return (
    <Sheet
      open
      onOpenChange={o => { if (!o) q.cancelEditAppMember() }}
      title={m.full_name ?? m.email}
      description="Le taux s’applique à tous les chantiers de ce compte."
      confirmLabel="Enregistrer"
      confirmLoading={q.editAppSaving}
      onConfirm={() => q.saveEditAppMember(m.membership_id)}
    >
      <div className={styles.stack}>
        <div className={styles.fields}>
          <Field type="text" label="Taux horaire (€/h)" inputMode="decimal" value={q.editAppTaux} onChange={e => q.setEditAppTaux(e.target.value)} />
        </div>
        {q.editAppError && <p className={screen.error} role="alert">{q.editAppError}</p>}
      </div>
    </Sheet>
  )
}
