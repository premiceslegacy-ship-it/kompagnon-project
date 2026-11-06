'use client'
// @atelier-migrated
// Sécurité : sessions actives et déconnexion des autres appareils.

import { useEffect, useState } from 'react'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { createClient } from '@/lib/supabase/client'
import type { SettingsState } from './useSettings'
import screen from '@/components/layout/Screen.module.css'
import styles from '../finances/quote-editor/QuoteEditor.module.css'

export default function SecuriteView({ q }: { q: SettingsState }) {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { if (!q.sessionsLoaded) q.loadSecurityData() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function signOutOthers() {
    setBusy(true)
    setError(null)
    setDone(false)
    const { error: err } = await createClient().auth.signOut({ scope: 'others' })
    setBusy(false)
    if (err) setError('Les autres appareils n’ont pas pu être déconnectés.')
    else setDone(true)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <ListGroup title="Sessions actives" description="Déconnectez les autres appareils pour forcer une nouvelle connexion partout sauf ici.">
        {q.sessions.map(s => (
          <ListRow
            key={s.id}
            title={s.user_agent ?? 'Appareil inconnu'}
            description={[s.ip ? `IP ${s.ip}` : null, s.created_at ? new Date(s.created_at).toLocaleString('fr-FR') : null].filter(Boolean).join(' · ')}
          />
        ))}
        <ListRow title={busy ? 'Déconnexion…' : 'Déconnecter les autres appareils'} className={styles.accentRow} disabled={busy} onClick={() => void signOutOthers()} />
      </ListGroup>
      {done && <p className={screen.ok} role="status">Les autres appareils sont déconnectés.</p>}
      {error && <p className={screen.error} role="alert">{error}</p>}
    </div>
  )
}
