// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { SearchField } from './SearchField'

afterEach(cleanup)

function ControlledSearch({ onChange }: { onChange: (value: string) => void }) {
  const [value, setValue] = useState('')
  return (
    <SearchField
      value={value}
      onChange={(next) => {
        onChange(next)
        setValue(next)
      }}
      label="Rechercher"
      placeholder="Nom ou numéro"
    />
  )
}

describe('SearchField', () => {
  it('efface au clavier et conserve le focus dans le champ de recherche', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ControlledSearch onChange={onChange} />)

    const input = screen.getByRole('searchbox', { name: 'Rechercher' }) as HTMLInputElement
    expect(input.value).toBe('')
    expect(screen.queryByRole('button', { name: 'Effacer la recherche' })).toBeNull()

    await user.type(input, 'plomberie')
    expect(input.value).toBe('plomberie')
    await user.tab()
    await user.keyboard('{Enter}')

    expect(onChange).toHaveBeenLastCalledWith('')
    expect(input.value).toBe('')
    expect(screen.queryByRole('button', { name: 'Effacer la recherche' })).toBeNull()
    expect(document.activeElement).toBe(input)
  })

  it('bloque la recherche et son effacement pendant le chargement', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <SearchField
        value="Dupont"
        onChange={onChange}
        label="Rechercher un client"
        loading
        error="La recherche n’a pas abouti."
      />,
    )

    const input = screen.getByRole('searchbox', { name: 'Rechercher un client' }) as HTMLInputElement
    const clear = screen.getByRole('button', { name: 'Effacer la recherche' }) as HTMLButtonElement
    expect(input.disabled).toBe(true)
    expect(clear.disabled).toBe(true)
    await user.type(input, ' Martin')
    await user.click(clear)
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.getByRole('alert')).toBeTruthy()
  })
})
