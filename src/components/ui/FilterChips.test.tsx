// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { FilterChips } from './FilterChips'

afterEach(cleanup)

const options = [
  { value: 'pending', label: 'En attente' },
  { value: 'remind', label: 'À relancer' },
] as const

function ControlledFilters({ onChange }: { onChange: (value: string[]) => void }) {
  const [value, setValue] = useState<string[]>([])
  return (
    <FilterChips
      options={options}
      value={value}
      onChange={(next) => {
        onChange(next)
        setValue(next)
      }}
      label="Filtrer les devis"
    />
  )
}

describe('FilterChips', () => {
  it('active puis désactive un filtre et expose son état pressé', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ControlledFilters onChange={onChange} />)

    const pending = screen.getByRole('button', { name: 'En attente' })
    expect(pending.getAttribute('aria-pressed')).toBe('false')
    await user.click(pending)
    expect(onChange).toHaveBeenLastCalledWith(['pending'])
    expect(screen.getByRole('button', { name: 'En attente' }).getAttribute('aria-pressed')).toBe('true')

    await user.click(screen.getByRole('button', { name: 'À relancer' }))
    expect(onChange).toHaveBeenLastCalledWith(['pending', 'remind'])
    await user.click(screen.getByRole('button', { name: 'En attente' }))
    expect(onChange).toHaveBeenLastCalledWith(['remind'])
  })

  it('bloque les filtres désactivés ou en chargement et annonce une erreur', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(
      <FilterChips
        options={options}
        value={[]}
        onChange={onChange}
        label="Filtrer les devis"
        disabled
        error="Les filtres n’ont pas pu être chargés."
      />,
    )

    const pending = screen.getByRole('button', { name: 'En attente' }) as HTMLButtonElement
    expect(pending.disabled).toBe(true)
    await user.click(pending)
    expect(onChange).not.toHaveBeenCalled()

    rerender(
      <FilterChips
        options={options}
        value={[]}
        onChange={onChange}
        label="Filtrer les devis"
        loading
        error="Les filtres n’ont pas pu être chargés."
      />,
    )
    expect(screen.getByRole('group', { name: 'Filtrer les devis' }).getAttribute('aria-busy')).toBe('true')
    expect((screen.getByRole('button', { name: 'En attente' }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(screen.getByRole('button', { name: 'En attente' }))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.getByRole('alert')).toBeTruthy()
  })
})
