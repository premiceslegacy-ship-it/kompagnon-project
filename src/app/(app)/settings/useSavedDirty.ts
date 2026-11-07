'use client'
// @atelier-migrated
// Réglages : vrai quand une valeur a changé depuis le dernier enregistrement (la barre « Enregistrer » apparaît alors).

import { useEffect, useState } from 'react'

export function useSavedDirty(value: unknown, status: 'idle' | 'saving' | 'saved' | 'error'): boolean {
  const [saved, setSaved] = useState(() => JSON.stringify(value))
  const current = JSON.stringify(value)
  // Une fois enregistré, la version affichée devient la référence.
  useEffect(() => { if (status === 'saved') setSaved(current) }, [status]) // eslint-disable-line react-hooks/exhaustive-deps
  return current !== saved
}
