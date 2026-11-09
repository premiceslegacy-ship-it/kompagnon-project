'use client'

import { useState, type FormEvent } from 'react'
import { isRedirectSignal } from '@/lib/auth-ui'
import type { AuthState } from '../actions'

const initialState: AuthState = { error: null }

/**
 * Envoi d'un formulaire d'entrée par une action serveur, avec attente et message
 * d'erreur de repli si l'appel échoue (réseau coupé, serveur indisponible).
 */
export function useAuthSubmit(
  action: (state: AuthState, formData: FormData) => Promise<AuthState | void>,
  fallbackError: string,
) {
  const [state, setState] = useState<AuthState>(initialState)
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setState(initialState)
    let redirecting = false
    try {
      const result = await action(initialState, new FormData(event.currentTarget))
      if (result) setState(result)
    } catch (error) {
      // Connexion réussie : le serveur redirige. On garde l'attente jusqu'au
      // changement de page au lieu d'afficher une fausse erreur.
      if (isRedirectSignal(error)) redirecting = true
      else setState({ error: fallbackError })
    } finally {
      if (!redirecting) setPending(false)
    }
  }

  return { state, pending, submit }
}
