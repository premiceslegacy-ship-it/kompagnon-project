'use client'
// @atelier-migrated
// Équipe : fiche d'un membre (rôle, retrait de l'accès) et invitation par email.

import { useState } from 'react'
import { Check } from 'lucide-react'
import { AlertDialog } from '@/components/ui/AlertDialog'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Sheet } from '@/components/ui/Sheet'
import { sendTeamInvite } from '@/lib/data/mutations/team'
import type { TeamMember } from '@/lib/data/queries/team'
import { canChangeRole, canRemove, isValidInviteEmail, memberName, roleDisplayName } from './equipeModel'
import type { SettingsState } from './useSettings'
import screen from '@/components/layout/Screen.module.css'
import styles from '../finances/quote-editor/QuoteEditor.module.css'
import local from './Settings.module.css'

type MemberProps = { q: SettingsState; member: TeamMember | null; open: boolean; onClose: () => void }

/** Le parent change la `key` à chaque ouverture : le rôle choisi repart de celui du membre. */
export function MemberSheet({ q, member, open, onClose }: MemberProps) {
  const [roleId, setRoleId] = useState(member?.role_id ?? '')
  const [confirm, setConfirm] = useState(false)
  if (!member) return null
  const access = { canEditRoles: q.canEditRoles, canRemoveMembers: q.canRemoveMembers }
  const name = memberName(member)

  return (
    <>
      <Sheet open={open} onOpenChange={o => { if (!o) onClose() }} title={name} cancelLabel="Fermer">
        <div className={local.sheetBody}>
          <div className={local.avatarRow}><Avatar name={name} size={72} /></div>
          <ListGroup>
            <ListRow title="Email" description={member.email} />
            {member.job_title && <ListRow title="Poste" description={member.job_title} />}
            {!canChangeRole(member, access) && <ListRow title="Rôle" description={roleDisplayName(member)} />}
          </ListGroup>
          {canChangeRole(member, access) && (
            <div className={styles.fields}>
              <Field type="select" label="Rôle" value={roleId} disabled={q.isPending}
                onChange={e => { setRoleId(e.target.value); q.handleRoleChange(member.membership_id, e.target.value) }}>
                {q.roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Field>
            </div>
          )}
          {canRemove(member, access) && (
            <ListGroup>
              <li className={styles.destructiveRow}><button type="button" onClick={() => setConfirm(true)}>Retirer l’accès</button></li>
            </ListGroup>
          )}
        </div>
      </Sheet>
      <AlertDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Retirer ${name} ?`}
        description="Cette personne perd l’accès à l’entreprise immédiatement."
        confirmLabel="Retirer l’accès"
        confirmLoading={q.isPending}
        onConfirm={() => { q.handleRemove(member.membership_id); setConfirm(false); onClose() }}
      />
    </>
  )
}

export function InviteSheet({ q, open, onClose }: { q: SettingsState; open: boolean; onClose: () => void }) {
  const sent = q.inviteStatus === 'sent'
  const sending = q.inviteStatus === 'sending'

  function close() {
    onClose()
    q.setInviteStatus('idle'); q.setInviteError(null); q.setInviteEmail('')
  }

  async function submit() {
    if (!isValidInviteEmail(q.inviteEmail)) { q.setInviteError('Saisissez une adresse email valide.'); q.setInviteStatus('error'); return }
    q.setInviteStatus('sending')
    q.setInviteError(null)
    const result = await sendTeamInvite(q.inviteEmail, q.inviteRoleId)
    if (result.error) { q.setInviteError(result.error); q.setInviteStatus('error') }
    else q.setInviteStatus('sent')
  }

  return (
    <Sheet
      open={open}
      onOpenChange={o => { if (!o) close() }}
      title="Inviter un collaborateur"
      onConfirm={sent ? undefined : () => void submit()}
      confirmLabel="Envoyer"
      confirmLoading={sending}
      cancelLabel={sent ? 'Terminé' : 'Annuler'}
    >
      {sent ? (
        <div className={local.sheetBody} role="status">
          <div className={local.avatarRow}><span className={local.logoEmpty}><Check size={22} aria-hidden="true" /></span></div>
          <p className={styles.hint} style={{ textAlign: 'center' }}>
            Invitation envoyée à {q.inviteEmail}. Le lien est valable 7 jours.
          </p>
          <Button type="button" variant="secondary" size="lg" onClick={close}>Terminé</Button>
        </div>
      ) : (
        <div className={local.sheetBody}>
          <div>
            <div className={styles.fields}>
              <Field type="text" inputType="email" label="Email" placeholder="email@entreprise.fr" autoComplete="off" value={q.inviteEmail} onChange={e => q.setInviteEmail(e.target.value)} />
              <Field type="select" label="Rôle" value={q.inviteRoleId} onChange={e => q.setInviteRoleId(e.target.value)}>
                {q.roles.filter(r => r.slug !== 'owner').map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Field>
            </div>
            <p className={styles.hint}>La personne reçoit un email avec un lien d’accès, valable 7 jours.</p>
          </div>
          {q.inviteStatus === 'error' && q.inviteError && <p className={screen.error} role="alert">{q.inviteError}</p>}
        </div>
      )}
    </Sheet>
  )
}
