// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Menu, type MenuItem } from './Menu'
import { Sheet } from './Sheet'

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia')
const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth')

function setDesktopViewport(isDesktop: boolean) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: isDesktop ? 1280 : 390 })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: query === '(min-width: 900px)' && isDesktop,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => true,
    }) as MediaQueryList,
  })
}

afterEach(() => {
  cleanup()
  if (originalInnerWidth) Object.defineProperty(window, 'innerWidth', originalInnerWidth)
  if (originalMatchMedia) Object.defineProperty(window, 'matchMedia', originalMatchMedia)
  else Reflect.deleteProperty(window, 'matchMedia')
})

function menuItems(onSelect: (label: string) => void): MenuItem[] {
  return [
    { label: 'Modifier', onSelect: () => onSelect('Modifier') },
    { label: 'Supprimer', onSelect: () => onSelect('Supprimer'), disabled: true, destructive: true },
    { label: 'Actif', onSelect: () => onSelect('Actif'), checked: true },
  ]
}

describe('Menu', () => {
  it('hydrates on desktop with the announced popup matching the actual menu', async () => {
    setDesktopViewport(true)
    const view = <Menu trigger={<button type="button">Plus d’options</button>} items={menuItems(vi.fn())} />
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')!
    let markup: string
    try {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: undefined })
      markup = renderToString(view)
    } finally {
      Object.defineProperty(globalThis, 'window', windowDescriptor)
    }
    const container = document.createElement('div')
    container.innerHTML = markup
    document.body.append(container)
    let root: Root | undefined

    try {
      await act(async () => { root = hydrateRoot(container, view) })
      const trigger = screen.getByRole('button', { name: 'Plus d’options' })
      await waitFor(() => expect(trigger.getAttribute('aria-haspopup')).toBe('menu'))
      await userEvent.setup().click(trigger)
      expect(screen.getByRole('menu')).not.toBeNull()
      expect(screen.queryByRole('dialog')).toBeNull()
    } finally {
      await act(async () => root?.unmount())
      container.remove()
    }
  })

  it('uses a real Radix dropdown on desktop with keyboard navigation and disabled items', async () => {
    setDesktopViewport(true)
    const user = userEvent.setup()
    const selectedFocus: Element[] = []
    const onSelect = vi.fn(() => selectedFocus.push(document.activeElement as Element))
    render(<Menu trigger={<button type="button">Plus d’options</button>} items={menuItems(onSelect)} title="Client" />)

    const menuTrigger = screen.getByRole('button', { name: 'Plus d’options' })
    await user.click(menuTrigger)
    expect(screen.getByRole('menu')).not.toBeNull()
    expect(screen.getByRole('menuitemcheckbox', { name: 'Actif', checked: true })).not.toBeNull()
    const disabledItem = screen.getByRole('menuitem', { name: 'Supprimer' })
    expect(disabledItem.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(disabledItem)
    expect(onSelect).not.toHaveBeenCalled()

    await user.keyboard('{ArrowDown}')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Modifier' })))
    await user.keyboard('{ArrowDown}')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('menuitemcheckbox', { name: 'Actif' })))
    await user.keyboard('{Enter}')

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('Actif')
    expect(selectedFocus).toEqual([menuTrigger])

    await user.click(menuTrigger)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(onSelect).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(document.activeElement).toBe(menuTrigger))
  })

  it('chooses the mobile Sheet when opened and retains that mode after a viewport change', async () => {
    setDesktopViewport(false)
    const user = userEvent.setup()
    const selectedFocus: Element[] = []
    const onSelect = vi.fn(() => selectedFocus.push(document.activeElement as Element))
    render(<Menu trigger={<button type="button">Plus d’options</button>} items={menuItems(onSelect)} title="Client" />)

    const trigger = screen.getByRole('button', { name: 'Plus d’options' })
    await user.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Client' })).not.toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
    const disabledAction = screen.getByRole('button', { name: 'Supprimer' }) as HTMLButtonElement
    expect(disabledAction.disabled).toBe(true)
    await user.click(disabledAction)
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()

    setDesktopViewport(true)
    await user.click(screen.getByRole('button', { name: 'Modifier' }))

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('Modifier')
    expect(selectedFocus).toEqual([trigger])
    expect(screen.queryByRole('dialog', { name: 'Client' })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('opens a mobile actions Sheet as the second overlay level', async () => {
    setDesktopViewport(false)
    const user = userEvent.setup()
    const selectedFocus: Element[] = []
    const onSelect = vi.fn(() => selectedFocus.push(document.activeElement as Element))
    render(
      <Sheet open onOpenChange={() => undefined} title="Fiche client">
        <Menu trigger={<button type="button">Plus d’options</button>} items={[{ label: 'Archiver', onSelect }]} title="Actions du client" />
      </Sheet>
    )

    await user.click(screen.getByRole('button', { name: 'Plus d’options' }))
    expect(screen.getByRole('dialog', { name: 'Actions du client' })).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Archiver' }))

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(selectedFocus).toEqual([screen.getByRole('button', { name: 'Plus d’options' })])
    expect(screen.queryByRole('dialog', { name: 'Actions du client' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Fiche client' })).not.toBeNull()
  })

  it('restores focus without selecting when Escape closes a mobile actions Sheet', async () => {
    setDesktopViewport(false)
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <Sheet open onOpenChange={() => undefined} title="Fiche client">
        <Menu trigger={<button type="button">Plus d’options</button>} items={[{ label: 'Archiver', onSelect }]} title="Actions du client" />
      </Sheet>
    )

    const trigger = screen.getByRole('button', { name: 'Plus d’options' })
    await user.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Actions du client' })).not.toBeNull()
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: 'Actions du client' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Fiche client' })).not.toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('uses an anchored dropdown at Sheet depth two without opening another Sheet', async () => {
    setDesktopViewport(false)
    const user = userEvent.setup()
    const selectedFocus: Element[] = []
    const onSelect = vi.fn(() => selectedFocus.push(document.activeElement as Element))
    render(
      <Sheet open onOpenChange={() => undefined} title="Fiche client">
        <Sheet open onOpenChange={() => undefined} title="Modifier le client">
          <Menu trigger={<button type="button">Plus d’options</button>} items={[{ label: 'Archiver', onSelect }]} title="Actions du client" />
        </Sheet>
      </Sheet>
    )

    const trigger = screen.getByRole('button', { name: 'Plus d’options' })
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    await user.click(trigger)
    expect(screen.getByRole('menu')).not.toBeNull()
    expect(screen.getAllByRole('dialog', { hidden: true })).toHaveLength(2)
    await user.keyboard('{ArrowDown}{Enter}')

    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1))
    expect(selectedFocus).toEqual([trigger])
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getAllByRole('dialog', { hidden: true })).toHaveLength(2)
  })
})
