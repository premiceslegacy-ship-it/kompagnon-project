// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UnitSelect } from './UnitSelect'

afterEach(cleanup)

describe('UnitSelect', () => {
  it('keeps the native selector keyboard-focusable and emits built-in units', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<UnitSelect value="m²" onChange={onChange} allowedUnits={['m²', 'ml']} />)

    const select = screen.getByRole('combobox') as HTMLSelectElement
    await user.tab()
    expect(document.activeElement).toBe(select)
    await user.selectOptions(select, 'ml')

    expect(onChange).toHaveBeenLastCalledWith('ml')
  })

  it('focuses free-form entry and emits custom values until Escape restores the default unit', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<UnitSelect value="u" onChange={onChange} />)

    const select = screen.getByRole('combobox') as HTMLSelectElement
    const lastOption = select.options[select.options.length - 1]!
    await user.selectOptions(select, lastOption)

    const freeInput = screen.getByRole('textbox') as HTMLInputElement
    expect(document.activeElement).toBe(freeInput)
    await user.type(freeInput, 'm3/h')
    expect(onChange).toHaveBeenLastCalledWith('m3/h')

    await user.keyboard('{Escape}')
    expect(onChange).toHaveBeenLastCalledWith('u')
  })

  it('does not allow changes when disabled', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<UnitSelect value="m²" onChange={onChange} disabled />)

    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.disabled).toBe(true)
    await user.selectOptions(select, 'ml')
    expect(onChange).not.toHaveBeenCalled()
  })
})
