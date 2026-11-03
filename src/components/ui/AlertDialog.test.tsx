// @vitest-environment jsdom
import * as React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AlertDialog } from './AlertDialog'
import { Sheet } from './Sheet'

afterEach(() => cleanup())

function AlertInsideSheet({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const [alertOpen, setAlertOpen] = React.useState(false)

  return (
    <>
      <button type="button" onClick={() => setSheetOpen(true)}>Ouvrir la feuille</button>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen} title="Modifier le client">
        <button type="button" onClick={() => setAlertOpen(true)}>Archiver le client</button>
        <AlertDialog
          open={alertOpen}
          onOpenChange={setAlertOpen}
          title="Archiver ce client ?"
          description="Les devis déjà créés restent disponibles."
          cancelLabel="Annuler"
          confirmLabel="Archiver"
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      </Sheet>
    </>
  )
}

function ControlledAlert({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => Promise<void>
  onCancel: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const [confirmLoading, setConfirmLoading] = React.useState(false)
  const [failed, setFailed] = React.useState(false)

  const confirm = async () => {
    setConfirmLoading(true)
    setFailed(false)
    try {
      await onConfirm()
      setOpen(false)
    } catch {
      setFailed(true)
    } finally {
      setConfirmLoading(false)
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Ouvrir la confirmation</button>
      <AlertDialog
        open={open}
        onOpenChange={setOpen}
        title="Supprimer le document ?"
        description={failed ? 'La suppression a échoué. Réessayez.' : 'Cette action est définitive.'}
        confirmLabel="Supprimer"
        confirmLoading={confirmLoading}
        onCancel={onCancel}
        onConfirm={confirm}
      />
    </>
  )
}

function deferred<T>() {
  return Promise.withResolvers<T>()
}

describe('AlertDialog', () => {
  it('cancels only the alert on Escape and leaves its parent Sheet open', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    render(<AlertInsideSheet onCancel={onCancel} onConfirm={onConfirm} />)

    const sheetTrigger = screen.getByRole('button', { name: 'Ouvrir la feuille' })
    await user.click(sheetTrigger)
    const alertTrigger = screen.getByRole('button', { name: 'Archiver le client' })
    await user.click(alertTrigger)

    const cancelButtons = screen.getAllByRole('button', { name: 'Annuler' })
    const cancel = cancelButtons[cancelButtons.length - 1]
    expect(screen.getByRole('alertdialog', { name: 'Archiver ce client ?' })).not.toBeNull()
    expect(document.activeElement).toBe(cancel)

    fireEvent.pointerDown(document.body)
    expect(screen.getByRole('alertdialog', { name: 'Archiver ce client ?' })).not.toBeNull()
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('alertdialog', { name: 'Archiver ce client ?' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Modifier le client' })).not.toBeNull()
    expect(document.activeElement).toBe(alertTrigger)
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('calls the explicit cancel callback and restores focus to its trigger', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<AlertInsideSheet onCancel={onCancel} onConfirm={() => undefined} />)

    const sheetTrigger = screen.getByRole('button', { name: 'Ouvrir la feuille' })
    await user.click(sheetTrigger)
    const alertTrigger = screen.getByRole('button', { name: 'Archiver le client' })
    await user.click(alertTrigger)

    const cancelButtons = screen.getAllByRole('button', { name: 'Annuler' })
    await user.click(cancelButtons[cancelButtons.length - 1])

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alertdialog', { name: 'Archiver ce client ?' })).toBeNull()
    expect(document.activeElement).toBe(alertTrigger)
    expect(screen.getByRole('dialog', { name: 'Modifier le client' })).not.toBeNull()
  })

  it('keeps a disabled confirmation inert', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <AlertDialog
        open
        onOpenChange={() => undefined}
        title="Supprimer le document ?"
        confirmLabel="Supprimer"
        confirmDisabled
        onConfirm={onConfirm}
      />
    )

    const disabledConfirm = screen.getByRole('button', { name: 'Supprimer' }) as HTMLButtonElement
    await user.click(disabledConfirm)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('keeps a failed parent-controlled confirmation open, then closes after a delayed success', async () => {
    const user = userEvent.setup()
    const attempts = [deferred<void>(), deferred<void>()]
    const onConfirm = vi.fn<() => Promise<void>>()
      .mockImplementationOnce(() => attempts[0].promise)
      .mockImplementationOnce(() => attempts[1].promise)
    const onCancel = vi.fn()
    render(<ControlledAlert onConfirm={onConfirm} onCancel={onCancel} />)

    const trigger = screen.getByRole('button', { name: 'Ouvrir la confirmation' })
    await user.click(trigger)
    let confirm = screen.getByRole('button', { name: 'Supprimer' })
    await user.click(confirm)

    expect(confirm.getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(confirm)
    const cancel = screen.getByRole('button', { name: 'Annuler' }) as HTMLButtonElement
    expect(cancel.disabled).toBe(true)
    await user.keyboard('{Escape}')
    await user.click(cancel)
    expect(screen.getByRole('alertdialog', { name: 'Supprimer le document ?' })).not.toBeNull()
    expect(screen.getByRole('alertdialog').contains(document.activeElement)).toBe(true)
    expect(onCancel).not.toHaveBeenCalled()
    expect(onConfirm).toHaveBeenCalledTimes(1)

    await act(async () => {
      attempts[0].reject(new Error('rejet de confirmation'))
      await Promise.resolve()
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Annuler' }).hasAttribute('disabled')).toBe(false))

    confirm = screen.getByRole('button', { name: 'Supprimer' })
    await user.click(confirm)
    expect(confirm.getAttribute('aria-disabled')).toBe('true')
    await act(async () => {
      attempts[1].resolve(undefined)
      await Promise.resolve()
    })

    await waitFor(() => expect(screen.queryByRole('alertdialog', { name: 'Supprimer le document ?' })).toBeNull())
    expect(onConfirm).toHaveBeenCalledTimes(2)
    expect(document.activeElement).toBe(trigger)
  })

  it('contains focus when opened already busy and prevents cancellation', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    function BusyConfirmation() {
      const [open, setOpen] = React.useState(false)
      return <>
        <button onClick={() => setOpen(true)}>Ouvrir la confirmation occupée</button>
        <AlertDialog open={open} onOpenChange={setOpen} title="Suppression en cours" confirmLabel="Supprimer" confirmLoading onCancel={onCancel} onConfirm={() => undefined} />
      </>
    }
    render(<BusyConfirmation />)
    await user.click(screen.getByRole('button', { name: 'Ouvrir la confirmation occupée' }))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog.contains(document.activeElement)).toBe(true)
    await user.keyboard('{Tab}{Escape}')
    expect(screen.getByRole('alertdialog')).toBe(dialog)
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(onCancel).not.toHaveBeenCalled()
  })
})
