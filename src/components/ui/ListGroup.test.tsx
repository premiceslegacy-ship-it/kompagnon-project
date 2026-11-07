// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CheckRow, ListGroup, ListRow } from './ListGroup'

afterEach(() => cleanup())

describe('ListGroup and rows', () => {
  it('renders a titled group with semantic list and row elements', () => {
    render(
      <ListGroup title="Group" description="Help">
        <ListRow title="Entry" description="Hint" />
      </ListGroup>,
    )

    expect(screen.getByRole('region')).toBeTruthy()
    expect(screen.getByRole('list')).toBeTruthy()
    expect(screen.getByRole('listitem')).toBeTruthy()
  })

  it('exposes navigation as a native link and keeps a side action separate', async () => {
    const user = userEvent.setup()
    const action = vi.fn()
    render(
      <ListGroup title="Group">
        <ListRow title="Route" href="/destination" trailing={<button type="button" onClick={action}>Action</button>} />
      </ListGroup>,
    )

    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe('/destination')
    await user.click(screen.getByRole('button', { name: 'Action' }))
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('keeps an interactive side control independent from the row button', async () => {
    const user = userEvent.setup()
    const primary = vi.fn()
    const secondary = vi.fn()
    render(
      <ListGroup>
        <ListRow
          title="Primary"
          onClick={primary}
          trailing={<button type="button" onClick={secondary}>Secondary</button>}
        />
      </ListGroup>,
    )

    await user.click(screen.getByRole('button', { name: 'Secondary' }))
    expect(secondary).toHaveBeenCalledTimes(1)
    expect(primary).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Primary' }))
    expect(primary).toHaveBeenCalledTimes(1)
  })

  it('runs a native row action and prevents it when disabled', async () => {
    const user = userEvent.setup()
    const primary = vi.fn()
    const unavailable = vi.fn()
    render(
      <ListGroup>
        <ListRow title="Primary" onClick={primary} />
        <ListRow title="Unavailable" onClick={unavailable} disabled />
      </ListGroup>,
    )

    await user.click(screen.getByRole('button', { name: 'Primary' }))
    const disabledButton = screen.getByRole('button', { name: 'Unavailable' }) as HTMLButtonElement
    expect(primary).toHaveBeenCalledTimes(1)
    expect(disabledButton.disabled).toBe(true)
    await user.click(disabledButton)
    expect(unavailable).not.toHaveBeenCalled()
  })
})

describe('CheckRow', () => {
  it('reports the next checked value through its native checkbox', async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    const { rerender } = render(
      <ListGroup>
        <CheckRow title="Task" description="Help" checked={false} onCheckedChange={onCheckedChange} />
      </ListGroup>,
    )

    const checkbox = screen.getByRole('checkbox') as HTMLInputElement
    await user.click(checkbox)
    expect(onCheckedChange).toHaveBeenCalledWith(true)
    rerender(
      <ListGroup>
        <CheckRow title="Task" description="Help" checked onCheckedChange={onCheckedChange} />
      </ListGroup>,
    )
    expect(checkbox.checked).toBe(true)
  })

  it('does not change when disabled', async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(
      <ListGroup>
        <CheckRow title="Disabled" checked={false} onCheckedChange={onCheckedChange} disabled />
      </ListGroup>,
    )

    const checkbox = screen.getByRole('checkbox') as HTMLInputElement
    expect(checkbox.disabled).toBe(true)
    await user.click(checkbox)
    expect(onCheckedChange).not.toHaveBeenCalled()
  })
})
