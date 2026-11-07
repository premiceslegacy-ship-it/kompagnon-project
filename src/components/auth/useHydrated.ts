'use client'
// @atelier-migrated

import { useSyncExternalStore } from 'react'

const subscribe = () => () => {}

/**
 * Faux tant que la page n'est pas hydratée (rendu serveur, ou JavaScript coupé).
 * Un bouton grisé par la saisie reste ainsi utilisable sans JavaScript : le
 * formulaire part tel quel et le serveur revalide.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false)
}
