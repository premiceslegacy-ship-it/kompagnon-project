// @vitest-environment jsdom

import type { MouseEvent } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LiquidButton } from './liquid-glass-button'

afterEach(cleanup)

describe('LiquidButton', () => {
  it('keeps asChild semantics and caller actions on the child element', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn((event: MouseEvent) => event.preventDefault())
    render(
      <LiquidButton asChild variant="accent" size="sm" onClick={onClick}>
        <a href="/devis">Créer un devis</a>
      </LiquidButton>
    )

    const link = screen.getByRole('link', { name: 'Créer un devis' })
    expect(link.getAttribute('href')).toBe('/devis')

    await user.click(link)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('uses the native disabled state to prevent an action', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <LiquidButton disabled onClick={onClick}>
        Continuer
      </LiquidButton>
    )

    const button = screen.getByRole('button', { name: 'Continuer' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)

    await user.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })
})
