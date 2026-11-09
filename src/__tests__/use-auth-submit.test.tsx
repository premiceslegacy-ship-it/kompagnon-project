// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAuthSubmit } from '@/app/(auth)/login/useAuthSubmit'

afterEach(cleanup)

const FALLBACK = 'Connexion impossible pour le moment. Veuillez réessayer.'

function submitWith(action: Parameters<typeof useAuthSubmit>[0]) {
  const hook = renderHook(() => useAuthSubmit(action, FALLBACK))
  const form = document.createElement('form')
  const event = { preventDefault: vi.fn(), currentTarget: form } as unknown as React.FormEvent<HTMLFormElement>
  return { hook, run: () => act(async () => { await hook.result.current.submit(event) }) }
}

describe('useAuthSubmit', () => {
  it('affiche l\u2019erreur renvoyée par le serveur et libère le bouton', async () => {
    const { hook, run } = submitWith(async () => ({ error: 'Email ou mot de passe incorrect.' }))
    await run()
    expect(hook.result.current.state.error).toBe('Email ou mot de passe incorrect.')
    expect(hook.result.current.pending).toBe(false)
  })

  it('affiche le message de repli quand l\u2019appel échoue vraiment', async () => {
    const { hook, run } = submitWith(async () => { throw new Error('Failed to fetch') })
    await run()
    expect(hook.result.current.state.error).toBe(FALLBACK)
    expect(hook.result.current.pending).toBe(false)
  })

  it('n\u2019affiche aucune erreur quand le serveur redirige après une connexion réussie', async () => {
    const redirect = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;push;/dashboard;307;' })
    const { hook, run } = submitWith(async () => { throw redirect })
    await run()
    expect(hook.result.current.state.error).toBeNull()
    // L\u2019attente reste affichée jusqu\u2019au changement de page.
    expect(hook.result.current.pending).toBe(true)
  })
})
