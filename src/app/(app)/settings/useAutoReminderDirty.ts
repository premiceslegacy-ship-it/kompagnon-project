'use client'
// @atelier-migrated
// Réglages : indique si les réglages de relance et de validité ont changé depuis le dernier enregistrement.

import { useEffect, useState } from 'react'
import type { SettingsState } from './useSettings'

export function useAutoReminderDirty(q: SettingsState): boolean {
  const [saved, setSaved] = useState(() => JSON.stringify(q.autoReminder))
  const status = q.autoReminderSaveStatus
  // Une fois enregistré, la version affichée devient la référence : la barre « Enregistrer » disparaît.
  useEffect(() => { if (status === 'saved') setSaved(JSON.stringify(q.autoReminder)) }, [status]) // eslint-disable-line react-hooks/exhaustive-deps
  return JSON.stringify(q.autoReminder) !== saved
}
