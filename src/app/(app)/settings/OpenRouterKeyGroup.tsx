'use client'
// @atelier-migrated
// Clé OpenRouter du client : jamais réaffichée une fois enregistrée (seule sa présence est connue ici).

import { useEffect, useState, useTransition } from 'react'
import { AlertDialog } from '@/components/ui/AlertDialog'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { StatusPill } from '@/components/ui/StatusPill'
import { getAICredentialsState, removeOpenRouterKey, saveOpenRouterKey, type AICredentialsState } from '@/lib/data/mutations/ai-credentials'
import screen from '@/components/layout/Screen.module.css'
import styles from '../finances/quote-editor/QuoteEditor.module.css'

export default function OpenRouterKeyGroup() {
  const [state, setState] = useState<AICredentialsState | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [pending, startTransition] = useTransition()

  useEffect(() => { void getAICredentialsState().then(setState) }, [])
  if (!state || state.aiBillingMode !== 'client_owned') return null

  function save() {
    setError(null); setSaved(false)
    const formData = new FormData()
    formData.set('openrouterKey', keyInput)
    startTransition(async () => {
      const result = await saveOpenRouterKey(formData)
      if (result.error) { setError(result.error); return }
      setKeyInput(''); setSaved(true)
      setState(prev => (prev ? { ...prev, hasOwnKey: true } : prev))
    })
  }

  function remove() {
    setError(null); setSaved(false)
    startTransition(async () => {
      const result = await removeOpenRouterKey()
      setConfirmRemove(false)
      if (result.error) { setError(result.error); return }
      setState(prev => (prev ? { ...prev, hasOwnKey: false } : prev))
    })
  }

  return (
    <div>
      <ListGroup title="Clé OpenRouter" description="Votre offre utilise votre propre clé OpenRouter pour l’IA, pas la clé partagée Atelier. Elle n’est jamais réaffichée une fois enregistrée.">
        {state.hasOwnKey ? (
          <>
            <ListRow title="Clé enregistrée et active" trailing={<StatusPill status="success">Active</StatusPill>} />
            <ListRow title="Retirer la clé" className={styles.destructiveRow} disabled={pending} onClick={() => setConfirmRemove(true)} />
          </>
        ) : (
          <ListRow title="Aucune clé enregistrée" description="Collez votre clé ci-dessous pour activer l’IA." />
        )}
      </ListGroup>
      {!state.hasOwnKey && (
        <>
          <div className={styles.fields} style={{ marginTop: 16 }}>
            <Field type="text" inputType="password" label="Clé (sk-or-…)" autoComplete="off" placeholder="sk-or-v1-…" value={keyInput} onChange={e => setKeyInput(e.target.value)} />
          </div>
          <ListGroup>
            <ListRow title={pending ? 'Enregistrement…' : 'Enregistrer la clé'} className={styles.accentRow} disabled={pending || !keyInput} onClick={save} />
          </ListGroup>
        </>
      )}
      {saved && <p className={screen.ok} role="status">Clé enregistrée.</p>}
      {error && <p className={screen.error} role="alert">{error}</p>}
      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove} title="Retirer la clé OpenRouter ?" description="L’IA sera indisponible tant qu’une nouvelle clé n’est pas enregistrée." confirmLabel="Retirer" confirmLoading={pending} onConfirm={remove} />
    </div>
  )
}
