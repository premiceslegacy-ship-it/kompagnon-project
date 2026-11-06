'use client'
// @atelier-migrated
// Réglages : ferme une feuille dès que l'enregistrement qu'elle a lancé aboutit.

import { useEffect } from 'react'

export function useCloseOnSaved(status: 'idle' | 'saving' | 'saved' | 'error', open: boolean, close: () => void) {
  useEffect(() => { if (status === 'saved' && open) close() }, [status]) // eslint-disable-line react-hooks/exhaustive-deps
}
