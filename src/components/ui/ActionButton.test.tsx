// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ActionButton } from './ActionButton'

afterEach(cleanup)

describe('ActionButton', () => {
  it('detects a Promise, announces pending state, and blocks a second action', async () => {
    const user = userEvent.setup()
    const action = Promise.withResolvers<void>()
    const onClick = vi.fn(() => action.promise)
    render(
      <ActionButton onClick={onClick} loadingText="Enregistrement en cours">
        Enregistrer
      </ActionButton>
    )

    const button = screen.getByRole('button', { name: 'Enregistrer' }) as HTMLButtonElement
    await user.click(button)

    expect(button.disabled).toBe(true)
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(screen.getByRole('button', { name: 'Enregistrement en cours' })).toBe(button)

    await user.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)

    action.resolve()
    await waitFor(() => {
      expect(button.disabled).toBe(false)
      expect(button.getAttribute('aria-busy')).toBeNull()
    })
  })

  it('leaves pending control to the caller when loading is explicitly provided', async () => {
    const user = userEvent.setup()
    const action = Promise.withResolvers<void>()
    const onClick = vi.fn(() => action.promise)
    render(
      <ActionButton loading={false} onClick={onClick}>
        Enregistrer
      </ActionButton>
    )

    const button = screen.getByRole('button', { name: 'Enregistrer' }) as HTMLButtonElement
    await user.click(button)

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(button.disabled).toBe(false)
    expect(button.getAttribute('aria-busy')).toBeNull()

    action.resolve()
  })
})
