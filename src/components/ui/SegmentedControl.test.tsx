// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { SegmentedControl } from './SegmentedControl'

afterEach(cleanup)

const options = [
  { value: 'day', label: 'Jour' },
  { value: 'month', label: 'Mois' },
  { value: 'year', label: 'Année' },
] as const

function ControlledControl({ onChange }: { onChange: (value: string) => void }) {
  const [value, setValue] = useState('day')
  return (
    <SegmentedControl
      options={options}
      value={value}
      onChange={(next) => {
        onChange(next)
        setValue(next)
      }}
      label="Période"
    />
  )
}

describe('SegmentedControl', () => {
  it('expose de vrais radios et garde la valeur contrôlée après un choix', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ControlledControl onChange={onChange} />)

    const radios = screen.getAllByRole('radio') as HTMLInputElement[]
    expect(radios.map((radio) => radio.checked)).toEqual([true, false, false])

    await user.click(screen.getByRole('radio', { name: 'Mois' }))

    expect(onChange).toHaveBeenCalledWith('month')
    expect((screen.getByRole('radio', { name: 'Mois' }) as HTMLInputElement).checked).toBe(true)
  })

  it('permet les flèches, Home et End dans le groupe radio', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ControlledControl onChange={onChange} />)

    const day = screen.getByRole('radio', { name: 'Jour' })
    await user.click(day)
    await user.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith('month')
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Mois' }))

    await user.keyboard('{End}')
    expect(onChange).toHaveBeenLastCalledWith('year')
    expect((screen.getByRole('radio', { name: 'Année' }) as HTMLInputElement).checked).toBe(true)

    await user.keyboard('{Home}')
    expect(onChange).toHaveBeenLastCalledWith('day')
    expect((screen.getByRole('radio', { name: 'Jour' }) as HTMLInputElement).checked).toBe(true)
  })

  it('bloque les radios désactivés ou en chargement et annonce une erreur', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(
      <SegmentedControl
        options={options}
        value="day"
        onChange={onChange}
        label="Période"
        disabled
        error="La période n’a pas pu être chargée."
      />,
    )

    const firstRadio = screen.getByRole('radio', { name: 'Jour' }) as HTMLInputElement
    await user.click(firstRadio)
    expect(onChange).not.toHaveBeenCalled()

    rerender(
      <SegmentedControl
        options={options}
        value="day"
        onChange={onChange}
        label="Période"
        loading
        error="La période n’a pas pu être chargée."
      />,
    )
    expect(screen.getByRole('radiogroup', { name: 'Période' }).getAttribute('aria-busy')).toBe('true')
    await user.click(screen.getByRole('radio', { name: 'Jour' }))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.getByRole('alert')).toBeTruthy()
  })
})
