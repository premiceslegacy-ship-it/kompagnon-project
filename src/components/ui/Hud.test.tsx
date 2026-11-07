// @vitest-environment jsdom
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Hud } from './Hud'
import { Sheet } from './Sheet'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Hud', () => {
  it('populates existing live channels on opening and empties them on closing', () => {
    const onOpenChange = () => {}
    const { rerender } = render(<Hud open={false} message="Client archivé" onOpenChange={onOpenChange} />)
    const status = screen.getByRole('status')
    const alert = screen.getByRole('alert')
    expect(status.textContent).toBe('')
    expect(alert.textContent).toBe('')

    rerender(<Hud open message="Client archivé" onOpenChange={onOpenChange} />)
    expect(screen.getByRole('status')).toBe(status)
    expect(status.textContent).toBe('Client archivé')
    expect(alert.textContent).toBe('')

    rerender(<Hud open variant="error" message="Envoi échoué" onOpenChange={onOpenChange} onRetry={() => {}} />)
    expect(screen.getByRole('alert')).toBe(alert)
    expect(status.textContent).toBe('')
    expect(alert.textContent).toBe('Envoi échoué')

    rerender(<Hud open={false} variant="error" message="Envoi échoué" onOpenChange={onOpenChange} onRetry={() => {}} />)
    expect(screen.getByRole('status')).toBe(status)
    expect(screen.getByRole('alert')).toBe(alert)
    expect(status.textContent).toBe('')
    expect(alert.textContent).toBe('')
  })

  it('keeps action focus across feedback changes and restores the original trigger on closing', () => {
    const view = (variant: 'success' | 'error', open: boolean) => <>
      <button>Origine</button>
      {variant === 'success'
        ? <Hud open={open} message="Client archivé" onOpenChange={() => {}} onUndo={() => {}} />
        : <Hud open={open} variant="error" message="Envoi échoué" onOpenChange={() => {}} onRetry={() => {}} />}
    </>
    const { rerender } = render(view('success', false))
    const origin = screen.getByRole('button', { name: 'Origine' })
    act(() => origin.focus())
    rerender(view('success', true))
    act(() => screen.getByRole('button', { name: 'Annuler' }).focus())
    rerender(view('error', true))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Réessayer' }))
    expect(screen.getByRole('alert').textContent).toBe('Envoi échoué')
    rerender(view('error', false))
    expect(document.activeElement).toBe(origin)
  })

  it.each(['success', 'error'] as const)('returns focus after the focused %s action closes the HUD', (variant) => {
    function Example() {
      const [open, setOpen] = useState(false)
      return <>
        <button onClick={() => setOpen(true)}>Déclencher</button>
        {variant === 'success'
          ? <Hud open={open} message="Client archivé" onOpenChange={setOpen} onUndo={() => {}} />
          : <Hud open={open} variant="error" message="Envoi échoué" onOpenChange={setOpen} onRetry={() => setOpen(false)} />}
      </>
    }
    render(<Example />)
    const origin = screen.getByRole('button', { name: 'Déclencher' })
    act(() => origin.focus())
    fireEvent.click(origin)
    const action = screen.getByRole('button', { name: variant === 'success' ? 'Annuler' : 'Réessayer' })
    act(() => action.focus())
    fireEvent.click(action)

    expect(screen.getByRole(variant === 'success' ? 'status' : 'alert').textContent).toBe('')
    expect(document.activeElement).toBe(origin)
  })

  it('does not steal focus back when the user has left the HUD before expiry', () => {
    vi.useFakeTimers()
    function Example() {
      const [open, setOpen] = useState(false)
      return <>
        <button onClick={() => setOpen(true)}>Déclencher</button>
        <input aria-label="Suite" />
        <Hud open={open} message="Client archivé" onOpenChange={setOpen} onUndo={() => {}} />
      </>
    }
    render(<Example />)
    const origin = screen.getByRole('button', { name: 'Déclencher' })
    act(() => origin.focus())
    fireEvent.click(origin)
    act(() => screen.getByRole('button', { name: 'Annuler' }).focus())
    const next = screen.getByRole('textbox', { name: 'Suite' })
    act(() => next.focus())
    act(() => vi.advanceTimersByTime(4_000))

    expect(screen.getByRole('status').textContent).toBe('')
    expect(document.activeElement).toBe(next)
  })

  it('closes a success after four seconds', () => {
    vi.useFakeTimers()
    const onOpenChange = vi.fn()
    render(<Hud open message="Enregistré" onOpenChange={onOpenChange} />)

    act(() => vi.advanceTimersByTime(3_999))
    expect(onOpenChange).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onOpenChange).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('runs Annuler and prevents the pending timeout from closing twice', () => {
    vi.useFakeTimers()
    const onOpenChange = vi.fn()
    const onUndo = vi.fn()
    render(<Hud open message="Client archivé" onOpenChange={onOpenChange} onUndo={onUndo} />)

    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
    act(() => vi.advanceTimersByTime(4_000))
    expect(onOpenChange).toHaveBeenCalledTimes(1)
  })

  it('pauses the remaining time while hovered and resumes it on leave', () => {
    vi.useFakeTimers()
    const onOpenChange = vi.fn()
    render(<Hud open message="Enregistré" onOpenChange={onOpenChange} onUndo={() => {}} />)
    const hoverTarget = screen.getByRole('button', { name: 'Annuler' })

    act(() => vi.advanceTimersByTime(1_500))
    fireEvent.mouseEnter(hoverTarget)
    act(() => vi.advanceTimersByTime(5_000))
    expect(onOpenChange).not.toHaveBeenCalled()

    fireEvent.mouseLeave(hoverTarget)
    act(() => vi.advanceTimersByTime(2_499))
    expect(onOpenChange).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onOpenChange).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('pauses while focused and resumes when focus leaves the HUD', () => {
    vi.useFakeTimers()
    const onOpenChange = vi.fn()
    render(
      <>
        <Hud open message="Client archivé" onOpenChange={onOpenChange} onUndo={() => {}} />
        <button type="button">Suite</button>
      </>
    )

    act(() => screen.getByRole('button', { name: 'Annuler' }).focus())
    expect(screen.getByRole('button', { name: 'Annuler' }).ownerDocument.activeElement).toBe(
      screen.getByRole('button', { name: 'Annuler' })
    )
    act(() => vi.advanceTimersByTime(5_000))
    expect(onOpenChange).not.toHaveBeenCalled()

    act(() => screen.getByRole('button', { name: 'Suite' }).focus())
    act(() => vi.advanceTimersByTime(3_999))
    expect(onOpenChange).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onOpenChange).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('cleans up its timeout on unmount', () => {
    vi.useFakeTimers()
    const onOpenChange = vi.fn()
    const { unmount } = render(<Hud open message="Enregistré" onOpenChange={onOpenChange} />)

    unmount()
    act(() => vi.advanceTimersByTime(4_000))
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('keeps errors visible until the caller closes them and invokes retry', () => {
    vi.useFakeTimers()
    const onOpenChange = vi.fn()
    const onRetry = vi.fn()
    render(
      <Hud
        open
        message="L’envoi a échoué"
        onOpenChange={onOpenChange}
        variant="error"
        onRetry={onRetry}
      />
    )

    act(() => vi.advanceTimersByTime(60_000))
    expect(screen.getByRole('alert').textContent).toBe('L’envoi a échoué')
    expect(onOpenChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert').textContent).toBe('L’envoi a échoué')
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it.each(['sheet'] as const)('preserves the visible-time budget through %s, including delayed leave events', async (layer) => {
    vi.useFakeTimers()
    const onOpenChange = vi.fn()
    function Example() {
      const [sheetOpen, setSheetOpen] = useState(false)
      return <>
        <button onClick={() => setSheetOpen(true)}>Détails</button>
        <Hud open message="Client archivé" onOpenChange={onOpenChange} onUndo={() => {}} />
        {layer === 'sheet' && <Sheet open={sheetOpen} onOpenChange={setSheetOpen} title="Client">Détails du client</Sheet>}
      </>
    }
    render(<Example />)
    const status = screen.getByRole('status')
    const hoverTarget = screen.getByRole('button', { name: 'Annuler' })
    act(() => vi.advanceTimersByTime(1_000))
    fireEvent.mouseEnter(hoverTarget)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Détails' })) })
    expect(status.textContent).toBe('')
    fireEvent.mouseLeave(hoverTarget)
    fireEvent.blur(hoverTarget)
    act(() => vi.advanceTimersByTime(5_000))
    expect(onOpenChange).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Annuler' })) })
    expect(screen.getByRole('status')).toBe(status)
    act(() => vi.advanceTimersByTime(2_999))
    expect(onOpenChange).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onOpenChange).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it.each(['sheet'] as const)('offers a full undo interval when first opened behind an existing %s modal', async (layer) => {
    vi.useFakeTimers()
    const onOpenChange = vi.fn()
    const onUndo = vi.fn()
    function Example() {
      const [sheetOpen, setSheetOpen] = useState(true)
      const [hudOpen, setHudOpen] = useState(false)
      return <>
        <Hud open={hudOpen} message="Client archivé" onOpenChange={onOpenChange} onUndo={onUndo} />
        {layer === 'sheet' && (
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen} title="Client">
              <button onClick={() => setHudOpen(true)}>Archiver</button>
          </Sheet>
        )}
      </>
    }
    render(<Example />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Archiver' })) })
    act(() => vi.advanceTimersByTime(5_000))
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByRole('status', { hidden: true }).textContent).toBe('')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Annuler' })) })
    act(() => vi.advanceTimersByTime(3_999))
    expect(onOpenChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(onUndo).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(1))
    expect(onOpenChange).toHaveBeenCalledTimes(1)
  })
})
