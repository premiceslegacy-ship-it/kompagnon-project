// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const actions = vi.hoisted(() => ({
  createEquipe: vi.fn(),
  deleteEquipe: vi.fn(),
  addEquipeMembre: vi.fn(),
  removeEquipeMembre: vi.fn(),
  updateEquipeMembreTaux: vi.fn(),
  updateEquipeMembreProfile: vi.fn(),
  assignEquipeToChantier: vi.fn(),
  removeEquipeFromChantier: vi.fn(),
  getQuoteItemsForSuggestions: vi.fn(),
}))

vi.mock('@/lib/data/mutations/chantiers', () => ({
  createEquipe: actions.createEquipe,
  deleteEquipe: actions.deleteEquipe,
  addEquipeMembre: actions.addEquipeMembre,
  removeEquipeMembre: actions.removeEquipeMembre,
  updateEquipeMembreTaux: actions.updateEquipeMembreTaux,
  updateEquipeMembreProfile: actions.updateEquipeMembreProfile,
  assignEquipeToChantier: actions.assignEquipeToChantier,
  removeEquipeFromChantier: actions.removeEquipeFromChantier,
}))
vi.mock('@/lib/data/mutations/quotes', () => ({ getQuoteItemsForSuggestions: actions.getQuoteItemsForSuggestions }))

import { EquipesTab } from '@/app/(app)/chantiers/[chantierId]/ChantierEquipes'
import type { Equipe } from '@/lib/data/queries/chantiers'

const equipe: Equipe = {
  id: 'equipe-1',
  organization_id: 'org-1',
  name: 'Équipe test',
  color: '#123456',
  description: null,
  created_at: '2026-11-10T00:00:00.000Z',
  membres: [],
}

function renderTab(assigned: boolean) {
  return render(
    <EquipesTab
      chantierId="chantier-1"
      allEquipes={[equipe]}
      chantierEquipes={assigned ? [equipe] : []}
      orgMembers={[]}
      orgRoles={[]}
      canEditRates={false}
    />,
  )
}

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockReset()
  actions.assignEquipeToChantier.mockResolvedValue({ error: null })
  actions.removeEquipeFromChantier.mockResolvedValue({ error: null })
  actions.createEquipe.mockResolvedValue({ equipeId: 'equipe-created', error: null })
  actions.deleteEquipe.mockResolvedValue({ error: null })
  actions.addEquipeMembre.mockResolvedValue({ membreId: 'membre-1', error: null })
  actions.removeEquipeMembre.mockResolvedValue({ error: null })
  actions.updateEquipeMembreTaux.mockResolvedValue({ error: null })
  actions.updateEquipeMembreProfile.mockResolvedValue({ error: null })
  actions.getQuoteItemsForSuggestions.mockResolvedValue({ internal: [] })
})

afterEach(cleanup)

describe('assignation d’une équipe au chantier', () => {
  it('annule l’état optimiste et montre le refus du serveur', async () => {
    const assignmentGate = Promise.withResolvers<{ error: string | null }>()
    actions.assignEquipeToChantier.mockReturnValue(assignmentGate.promise)
    renderTab(false)

    fireEvent.click(screen.getByRole('button', { name: /^Équipe test/ }))
    const checkbox = screen.getByRole('checkbox', { name: 'Assignée à ce chantier' }) as HTMLInputElement
    fireEvent.click(checkbox)

    expect(checkbox.checked).toBe(true)
    expect(checkbox.disabled).toBe(true)

    await act(async () => assignmentGate.resolve({ error: 'Permission refusée.' }))
    await waitFor(() => expect(checkbox.checked).toBe(false))
    expect(screen.getByRole('alert').textContent).toContain('Permission refusée.')
  })

  it('restaure l’assignation affichée si le retrait échoue', async () => {
    const removalGate = Promise.withResolvers<{ error: string | null }>()
    actions.removeEquipeFromChantier.mockReturnValue(removalGate.promise)
    renderTab(true)

    fireEvent.click(screen.getByRole('button', { name: /^Équipe test/ }))
    const checkbox = screen.getByRole('checkbox', { name: 'Assignée à ce chantier' }) as HTMLInputElement
    expect(checkbox.checked).toBe(true)
    fireEvent.click(checkbox)
    expect(checkbox.checked).toBe(false)
    expect(checkbox.disabled).toBe(true)

    await act(async () => removalGate.resolve({ error: 'Erreur de base de données.' }))
    await waitFor(() => expect(checkbox.checked).toBe(true))
    expect(screen.getByRole('alert').textContent).toContain('Erreur de base de données.')
  })
})
