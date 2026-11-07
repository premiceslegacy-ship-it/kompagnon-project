// @vitest-environment jsdom
import * as React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Sheet } from './Sheet'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function NestedSheets({ onCancel }: { onCancel?: () => void }) {
  const [open, setOpen] = React.useState(false)
  const [nestedOpen, setNestedOpen] = React.useState(false)

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Ouvrir le panneau</button>
      <Sheet open={open} onOpenChange={setOpen} onCancel={onCancel} title="Feuille principale">
        <button type="button" onClick={() => setNestedOpen(true)}>Ouvrir le niveau suivant</button>
        <Sheet open={nestedOpen} onOpenChange={setNestedOpen} title="Feuille secondaire">
          <p>Contenu du second niveau</p>
        </Sheet>
      </Sheet>
    </>
  )
}

describe('Sheet', () => {
  it('restores focus through two layers after closing only the active sheet with Escape', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<NestedSheets onCancel={onCancel} />)

    const opener = screen.getByRole('button', { name: 'Ouvrir le panneau' })
    await user.click(opener)
    const mainSheet = screen.getByRole('dialog', { name: 'Feuille principale' })
    const cancelMain = screen.getByRole('button', { name: 'Annuler' })
    const openNested = screen.getByRole('button', { name: 'Ouvrir le niveau suivant' })

    expect(mainSheet).not.toBeNull()
    expect(document.activeElement).toBe(cancelMain)

    await user.click(openNested)
    const nestedSheet = screen.getByRole('dialog', { name: 'Feuille secondaire' })
    const cancelButtons = screen.getAllByRole('button', { name: 'Annuler' })
    const cancelNested = cancelButtons[cancelButtons.length - 1]
    expect(nestedSheet).not.toBeNull()
    expect(document.activeElement).toBe(cancelNested)

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Feuille secondaire' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Feuille principale' })).not.toBeNull()
    expect(document.activeElement).toBe(openNested)

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Feuille principale' })).toBeNull()
    expect(document.activeElement).toBe(opener)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('traps keyboard focus within the open sheet', async () => {
    const user = userEvent.setup()
    render(
      <Sheet open onOpenChange={() => undefined} title="Modifier le client">
        <button type="button">Enregistrer le client</button>
      </Sheet>
    )

    const cancel = screen.getByRole('button', { name: 'Annuler' })
    const confirm = screen.getByRole('button', { name: 'Enregistrer le client' })
    expect(document.activeElement).toBe(cancel)

    await user.keyboard('{Tab}')
    expect(document.activeElement).toBe(confirm)
    await user.keyboard('{Tab}')
    expect(document.activeElement).toBe(cancel)
  })

  it('allows a later dismissal request when the controlled owner keeps the sheet open', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const onOpenChange = vi.fn()
    render(<Sheet open onOpenChange={onOpenChange} onCancel={onCancel} title="Modifier le client">Contenu</Sheet>)

    await user.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(screen.getByRole('dialog', { name: 'Modifier le client' })).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Annuler' }))

    expect(onCancel).toHaveBeenCalledTimes(2)
    expect(onOpenChange).toHaveBeenCalledTimes(2)
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
  })

  it('resets a dismissed drag when the controlled owner refuses to close', () => {
    const frames: FrameRequestCallback[] = []
    const onOpenChange = vi.fn()
    vi.stubGlobal('innerWidth', 390)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    render(<Sheet open onOpenChange={onOpenChange} title="Modifier le client">Contenu</Sheet>)

    const dialog = screen.getByRole('dialog', { name: 'Modifier le client' })
    const header = dialog.querySelector('header')
    expect(header).not.toBeNull()

    fireEvent.pointerDown(header!, { pointerId: 1, isPrimary: true, button: 0, clientX: 10, clientY: 0 })
    fireEvent.pointerMove(header!, { pointerId: 1, clientX: 10, clientY: 180 })
    fireEvent.pointerUp(header!, { pointerId: 1, clientX: 10, clientY: 180 })

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.getByRole('dialog', { name: 'Modifier le client' })).toBe(dialog)
    expect(dialog.style.getPropertyValue('--sheet-drag-y')).toBe('180px')
    expect(frames).toHaveLength(1)

    act(() => frames[0](0))
    expect(dialog.style.getPropertyValue('--sheet-drag-y')).toBe('0px')
  })

  it('does not dismiss from Escape or the overlay when dismissible is false', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const onOpenChange = vi.fn()
    render(<Sheet open dismissible={false} onOpenChange={onOpenChange} onCancel={onCancel} title="Envoi en cours">Contenu</Sheet>)

    await user.keyboard('{Escape}')
    fireEvent.pointerDown(document.body)

    expect(screen.getByRole('dialog', { name: 'Envoi en cours' })).not.toBeNull()
    expect(onCancel).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('keeps disabled and loading confirmations inert', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const sheet = render(
      <Sheet open onOpenChange={() => undefined} onConfirm={onConfirm} confirmDisabled title="Ajouter une prestation">
        Contenu
      </Sheet>
    )

    const disabledConfirm = screen.getByRole('button', { name: 'OK' }) as HTMLButtonElement
    expect(disabledConfirm.disabled).toBe(true)
    await user.click(disabledConfirm)

    sheet.rerender(
      <Sheet open onOpenChange={() => undefined} onConfirm={onConfirm} confirmLoading title="Ajouter une prestation">
        Contenu
      </Sheet>
    )
    const loadingConfirm = screen.getByRole('button', { name: 'OK' }) as HTMLButtonElement
    expect(loadingConfirm.getAttribute('aria-disabled')).toBe('true')
    await user.click(loadingConfirm)
    expect(onConfirm).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(loadingConfirm)
  })

  it('rejects a third open Sheet level with an explicit error', () => {
    expect(() => render(
      <Sheet open onOpenChange={() => undefined} title="Premier niveau">
        <Sheet open onOpenChange={() => undefined} title="Second niveau">
          <Sheet open onOpenChange={() => undefined} title="Troisième niveau">Contenu</Sheet>
        </Sheet>
      </Sheet>
    )).toThrow('Sheet accepte au maximum deux niveaux ouverts.')
  })
})
