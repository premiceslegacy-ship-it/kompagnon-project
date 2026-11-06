'use client'
// @atelier-migrated
// Équipe : code entreprise, membres, invitation.

import { useState } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { StatusPill } from '@/components/ui/StatusPill'
import type { TeamMember } from '@/lib/data/queries/team'
import CopyRow from './CopyRow'
import { InviteSheet, MemberSheet } from './EquipeSheets'
import { memberDescription, memberName, roleDisplayName } from './equipeModel'
import type { SettingsState } from './useSettings'
import styles from '../finances/quote-editor/QuoteEditor.module.css'
import local from './Settings.module.css'

export default function EquipeView({ q }: { q: SettingsState }) {
  // Chaque ouverture de la fiche d'un membre repart de zéro (changement de `key`).
  const [target, setTarget] = useState<{ member: TeamMember | null; key: number; open: boolean }>({ member: null, key: 0, open: false })
  const [inviteOpen, setInviteOpen] = useState(false)

  return (
    <div className={local.detail}>
      <div className={local.sections}>
        {q.joinCode && (
          <ListGroup title="Code entreprise" description="Pour rejoindre l’entreprise à l’inscription.">
            <ListRow title={q.joinCode} />
            <CopyRow text={q.joinCode} label="Copier le code" doneLabel="Code copié" />
          </ListGroup>
        )}

        <ListGroup title="Membres">
          {q.members.map(member => {
            const name = memberName(member)
            return (
              <ListRow
                key={member.membership_id}
                leading={<Avatar name={name} size={40} />}
                title={name}
                description={memberDescription(member) || undefined}
                trailing={<StatusPill status={member.role_slug === 'owner' ? 'success' : 'neutral'}>{roleDisplayName(member)}</StatusPill>}
                onClick={() => setTarget(t => ({ member, key: t.key + 1, open: true }))}
              />
            )
          })}
          {q.members.length === 0 && <ListRow title="Aucun membre pour l’instant" />}
          {q.canInvite && <ListRow title="Inviter un collaborateur" className={styles.accentRow} onClick={() => setInviteOpen(true)} />}
        </ListGroup>
      </div>

      <MemberSheet key={target.key} q={q} member={target.member} open={target.open} onClose={() => setTarget(t => ({ ...t, open: false }))} />
      <InviteSheet q={q} open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  )
}
