// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NumericInput } from './NumericInput'

afterEach(cleanup)

describe('NumericInput', () => {
  it('emits numeric changes while accepting a decimal comma', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<NumericInput aria-label="Quantity" value={null} onChange={onChange} />)

    const input = screen.getByRole('textbox', { name: 'Quantity' }) as HTMLInputElement
    await user.type(input, '1,5')

    expect(onChange).toHaveBeenLastCalledWith(1.5)
    expect(input.value).toBe('1,5')
  })

  it('selects the displayed value on focus for quick replacement', async () => {
    const user = userEvent.setup()
    render(<NumericInput aria-label="Quantity" value={123.4} onChange={vi.fn()} />)

    const input = screen.getByRole('textbox', { name: 'Quantity' }) as HTMLInputElement
    await user.tab()

    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe(input.value.length)
  })

  it('clamps and rounds the value on blur', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <NumericInput
        aria-label="Quantity"
        value={null}
        onChange={onChange}
        min={0}
        max={10}
        decimals={1}
      />,
    )

    const input = screen.getByRole('textbox', { name: 'Quantity' }) as HTMLInputElement
    await user.type(input, '12,345')
    await user.tab()

    expect(onChange).toHaveBeenLastCalledWith(10)
    expect(input.value).toBe('10')
  })

  it('rounds decimal values to the configured precision on blur', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<NumericInput aria-label="Quantity" value={null} onChange={onChange} decimals={1} />)

    const input = screen.getByRole('textbox', { name: 'Quantity' }) as HTMLInputElement
    await user.type(input, '2,36')
    await user.tab()

    expect(onChange).toHaveBeenLastCalledWith(2.4)
    expect(input.value).toBe('2,4')
  })

  it('does not emit a lone minus sign', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<NumericInput aria-label="Quantity" value={null} onChange={onChange} />)

    await user.type(screen.getByRole('textbox', { name: 'Quantity' }), '-')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('restores the prior value after an empty blur when empty values are disallowed', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <NumericInput
        aria-label="Quantity"
        value={7}
        onChange={onChange}
        allowEmpty={false}
      />,
    )

    const input = screen.getByRole('textbox', { name: 'Quantity' }) as HTMLInputElement
    await user.clear(input)
    await user.tab()

    expect(input.value).toBe('7')
  })

  it('emits null when empty values are allowed', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<NumericInput aria-label="Quantity" value={5} onChange={onChange} allowEmpty />)

    const input = screen.getByRole('textbox', { name: 'Quantity' }) as HTMLInputElement
    await user.clear(input)

    expect(onChange).toHaveBeenLastCalledWith(null)
  })
})
