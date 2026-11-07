// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Switch } from './Switch'

afterEach(cleanup)

function ControlledSwitch({ onChange }: { onChange: (value: boolean) => void }) {
  const [checked, setChecked] = useState(false)
  return (
    <Switch
      checked={checked}
      onChange={(next) => {
        onChange(next)
        setChecked(next)
      }}
      label="Relances automatiques"
    />
  )
}

describe('Switch', () => {
  it('conserve le rôle switch et change sa valeur contrôlée au clavier', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ControlledSwitch onChange={onChange} />)

    const toggle = screen.getByRole('switch', { name: 'Relances automatiques' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    await user.tab()
    expect(document.activeElement).toBe(toggle)
    await user.keyboard(' ')

    expect(onChange).toHaveBeenCalledWith(true)
    expect(toggle.getAttribute('aria-checked')).toBe('true')
  })

  it('empêche le changement si désactivé ou en chargement et annonce une erreur', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(
      <Switch checked={false} onChange={onChange} label="Relances automatiques" disabled />,
    )
    const toggle = screen.getByRole('switch', { name: 'Relances automatiques' }) as HTMLButtonElement
    expect(toggle.disabled).toBe(true)
    await user.click(toggle)
    expect(onChange).not.toHaveBeenCalled()

    rerender(
      <Switch
        checked={false}
        onChange={onChange}
        label="Relances automatiques"
        loading
        error="La préférence n’a pas pu être enregistrée."
      />,
    )
    expect(toggle.disabled).toBe(true)
    expect(toggle.getAttribute('aria-busy')).toBe('true')
    await user.click(toggle)
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.getByRole('alert')).toBeTruthy()
  })
})
