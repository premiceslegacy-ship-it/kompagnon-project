// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Modal } from './Modal'

afterEach(() => cleanup())

describe('Modal legacy API', () => {
  it('retains its labeled content, footer, close button, Escape and outside close behavior', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="Modifier le devis" subtitle="Les modifications ne sont pas encore enregistrées" footer={<button type="button">Enregistrer</button>}>
        <label htmlFor="description">Description</label>
        <input id="description" />
      </Modal>
    )

    const dialog = screen.getByRole('dialog', { name: 'Modifier le devis', description: 'Les modifications ne sont pas encore enregistrées' })
    expect(dialog).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Enregistrer' })).not.toBeNull()
    expect(document.body.style.overflow).toBe('hidden')

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(dialog.parentElement as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(2)
    await user.click(screen.getByRole('button', { name: 'Fermer' }))
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('keeps non-dismissible modal open without a close control', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Modal open dismissible={false} onClose={onClose} title="Enregistrement requis">
        Votre connexion est en cours.
      </Modal>
    )

    expect(screen.getByRole('dialog', { name: 'Enregistrement requis' })).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Fermer' })).toBeNull()
    await user.keyboard('{Escape}')
    fireEvent.click(screen.getByRole('dialog').parentElement as HTMLElement)

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Enregistrement requis' })).not.toBeNull()
  })
})
