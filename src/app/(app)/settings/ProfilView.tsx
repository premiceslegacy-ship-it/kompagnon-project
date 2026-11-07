'use client'
// @atelier-migrated
// Mon profil : nom, email, mot de passe.

import { useEffect, useState } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { Dock } from '@/components/ui/Dock'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { fullName, profileDirty, type ProfileFields } from './settingsModel'
import type { SettingsState } from './useSettings'
import screen from '@/components/layout/Screen.module.css'
import styles from '../finances/quote-editor/QuoteEditor.module.css'
import local from './Settings.module.css'

export default function ProfilView({ q }: { q: SettingsState }) {
  const [saved, setSaved] = useState<ProfileFields>(() => q.profileFields)
  const f = q.profileFields
  const dirty = profileDirty(saved, f)
  const status = q.profileSaveStatus
  const p = q.passwordFields
  const set = (k: keyof ProfileFields, v: string) => q.setProfileFields(prev => ({ ...prev, [k]: v }))

  // Une fois enregistré, la version affichée devient la référence : le bouton « Enregistrer » disparaît.
  useEffect(() => { if (status === 'saved') setSaved(q.profileFields) }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={local.detail}>
      <div className={local.avatarRow}><Avatar name={fullName(f) || f.email || '?'} size={72} /></div>
      <div className={styles.fields}>
        <Field type="text" label="Prénom" value={f.first_name} onChange={e => set('first_name', e.target.value)} />
        <Field type="text" label="Nom" value={f.last_name} onChange={e => set('last_name', e.target.value)} />
        <Field type="text" inputType="email" label="Email" value={f.email} onChange={e => set('email', e.target.value)} />
      </div>
      {status === 'error' && <p className={screen.error} role="alert">Le profil n’a pas pu être enregistré.</p>}

      <div>
        <p className={styles.hint} style={{ margin: '0 16px 8px' }}>Mot de passe</p>
        <div className={styles.fields}>
          <Field type="text" inputType="password" label="Actuel" placeholder="••••••••" autoComplete="current-password" value={p.current} onChange={e => q.setPasswordFields(prev => ({ ...prev, current: e.target.value }))} />
          <Field type="text" inputType="password" label="Nouveau" placeholder="8 caractères minimum" autoComplete="new-password" value={p.password} onChange={e => q.setPasswordFields(prev => ({ ...prev, password: e.target.value }))} />
          <Field type="text" inputType="password" label="Confirmation" placeholder="••••••••" autoComplete="new-password" value={p.confirm} onChange={e => q.setPasswordFields(prev => ({ ...prev, confirm: e.target.value }))} />
        </div>
        <ListGroup className={undefined}>
          <ListRow
            title={q.passwordSaveStatus === 'saving' ? 'Enregistrement…' : 'Changer le mot de passe'}
            className={styles.accentRow}
            disabled={q.isPending || q.passwordSaveStatus === 'saving'}
            onClick={q.handleSavePassword}
          />
        </ListGroup>
        {q.passwordError && <p className={screen.error} role="alert">{q.passwordError}</p>}
        {q.passwordSaveStatus === 'saved' && <p className={screen.ok} role="status">Mot de passe mis à jour.</p>}
      </div>

      {(dirty || status === 'saving') && (
        <Dock totalLabel="Profil" total="Modifié" actionLabel="Enregistrer" onAction={q.handleSaveProfile} loading={status === 'saving'} />
      )}
    </div>
  )
}
