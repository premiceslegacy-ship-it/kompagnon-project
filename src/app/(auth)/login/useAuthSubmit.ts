'use client'

import { useState, type FormEvent } from 'react'
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
    try {
      const result = await action(initialState, new FormData(event.currentTarget))
      if (result) setState(result)
    } catch {
      setState({ error: fallbackError })
    } finally {
      setPending(false)
    }
  }

  return { state, pending, submit }
}
