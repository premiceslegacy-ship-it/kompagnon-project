// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FormEvent } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from './Button'

afterEach(cleanup)

describe('Button', () => {
  it('uses a non-submitting native button by default', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <Button onClick={onClick}>Enregistrer</Button>
      </form>
    )

    const button = screen.getByRole('button', { name: 'Enregistrer' }) as HTMLButtonElement
    await user.click(button)

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('keeps focus and blocks activation while loading, then activates again', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault())
    const { rerender } = render(
      <form onSubmit={onSubmit}>
        <Button type="submit" onClick={onClick}>Enregistrer</Button>
      </form>
    )

    const button = screen.getByRole('button', { name: 'Enregistrer' }) as HTMLButtonElement
    button.focus()
    rerender(
      <form onSubmit={onSubmit}>
        <Button type="submit" loading onClick={onClick}>Enregistrer</Button>
      </form>
    )

    expect(document.activeElement).toBe(button)
    fireEvent.click(button)
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    button.click()
    expect(onClick).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()

    rerender(
      <form onSubmit={onSubmit}>
        <Button type="submit" onClick={onClick}>Enregistrer</Button>
      </form>
    )

    expect(document.activeElement).toBe(button)
    await user.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })


  it('can receive keyboard focus', async () => {
    const user = userEvent.setup()
    render(<Button>Continuer</Button>)
    const button = screen.getByRole('button', { name: 'Continuer' })

    await user.tab()
    expect(document.activeElement).toBe(button)
  })
})
