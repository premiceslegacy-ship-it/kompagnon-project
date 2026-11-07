// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BUSINESS_PROFILE_CONFIGS } from '@/lib/catalog-context'
import type { PublicMaterial, PublicPrestationType } from './components/types'

const submitQuoteRequest = vi.fn()
vi.mock('@/lib/data/mutations/quote-requests', () => ({
  submitQuoteRequest: (...args: unknown[]) => submitQuoteRequest(...args),
}))

const { usePublicQuoteRequest } = await import('./usePublicQuoteRequest')

const catalogContext = Object.values(BUSINESS_PROFILE_CONFIGS)[0]

function material(overrides: Partial<PublicMaterial> = {}): PublicMaterial {
  return {
    id: 'mat-1',
    name: 'Carrelage grès cérame 60x60',
    description: null,
    unit: 'm2',
    category: 'Sols',
    item_kind: 'article',
    dimension_pricing_mode: 'none',
    dimension_pricing_enabled: false,
    base_length_m: null,
    base_width_m: null,
    base_height_m: null,
    dimension_schema: null,
    price_variants: [],
    ...overrides,
  }
}

const prestation: PublicPrestationType = {
  id: 'pt-1',
  name: 'Salle de bain complète',
  description: 'Dépose, plomberie, carrelage et finitions',
  unit: 'forfait',
  category: 'Rénovation',
  lines: [],
}

function setup(materials: PublicMaterial[] = [material()]) {
  return renderHook(() => usePublicQuoteRequest({
    orgSlug: 'atelier-qualification',
    materials,
    laborRates: [],
    prestationTypes: [prestation],
    catalogContext,
  }))
}

beforeEach(() => {
  submitQuoteRequest.mockReset()
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
  window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('usePublicQuoteRequest', () => {
  it('refuse l’étape 1 sans nom, avec un email invalide ou temporaire, et sans entreprise pour un professionnel', () => {
    const { result } = setup()
    act(() => result.current.goNext())
    expect(result.current.step).toBe(1)
    expect(result.current.step1Error).toBe('Indiquez votre nom.')

    act(() => { result.current.setName('Jean Dupont'); result.current.setEmail('jean@exemple') })
    act(() => result.current.goNext())
    expect(result.current.step1Error).toMatch(/adresse email valide/)

    act(() => result.current.setEmail('jean@yopmail.com'))
    act(() => result.current.goNext())
    expect(result.current.step1Error).toMatch(/temporaires/)

    act(() => { result.current.setEmail('jean@exemple.fr'); result.current.setClientType('pro') })
    act(() => result.current.goNext())
    expect(result.current.step1Error).toBe('Indiquez le nom de l’entreprise.')

    act(() => result.current.setCompanyName('Dupont Rénovation'))
    act(() => result.current.goNext())
    expect(result.current.step).toBe(2)
    expect(result.current.step1Error).toBeNull()
  })

  it('exige un élément ou une description à l’étape 2, puis des dimensions positives', () => {
    const dimensioned = material({ id: 'mat-2', name: 'Plinthe', dimension_pricing_mode: 'linear', dimension_pricing_enabled: true })
    const { result } = setup([dimensioned])
    act(() => { result.current.setName('Jean Dupont'); result.current.setEmail('jean@exemple.fr') })
    act(() => result.current.goNext())
    act(() => result.current.goNext())
    expect(result.current.step).toBe(2)
    expect(result.current.step2Error).toBe('Sélectionnez un élément ou décrivez votre besoin.')

    act(() => result.current.toggleMaterial(dimensioned))
    act(() => result.current.setMaterialLength('mat-2', null))
    act(() => result.current.goNext())
    expect(result.current.step2Error).toMatch(/dimensions supérieures à zéro/)

    act(() => result.current.setMaterialLength('mat-2', 2.5))
    act(() => result.current.goNext())
    expect(result.current.step).toBe(3)
  })

  it('compte la sélection, filtre le catalogue et construit le récapitulatif', () => {
    const { result } = setup()
    act(() => { result.current.setName('Jean Dupont'); result.current.setEmail('jean@exemple.fr') })
    act(() => { result.current.toggleMaterial(material()); result.current.togglePrestation(prestation) })
    act(() => result.current.setMaterialExactQty('mat-1', 12))
    expect(result.current.selectionCount).toBe(2)

    act(() => result.current.setStep2Search('salle'))
    expect(result.current.articleMaterialGroups).toHaveLength(0)
    expect(result.current.filteredPrestationGroups[0].items.map(item => item.id)).toEqual(['pt-1'])

    const catalog = result.current.recapItems.find(item => item.label === 'Catalogue')
    expect(catalog?.value).toBe('Carrelage grès cérame 60x60 × 12')
  })

  it('envoie la demande avec les éléments du catalogue et passe à la confirmation', async () => {
    submitQuoteRequest.mockResolvedValue({ error: null, success: true })
    const { result } = setup()
    act(() => { result.current.setName('Jean Dupont'); result.current.setEmail('jean@exemple.fr'); result.current.toggleMaterial(material()) })
    await act(async () => { result.current.handleSubmit() })
    expect(submitQuoteRequest).toHaveBeenCalledTimes(1)
    const formData = submitQuoteRequest.mock.calls[0][1] as FormData
    expect(formData.get('org_slug')).toBe('atelier-qualification')
    expect(formData.get('type')).toBe('catalog')
    expect(JSON.parse(String(formData.get('catalog_items')))[0]).toMatchObject({ id: 'mat-1', quantity: 1 })
    expect(result.current.success).toBe(true)
  })

  it('affiche l’erreur renvoyée par le serveur sans quitter le récapitulatif', async () => {
    submitQuoteRequest.mockResolvedValue({ error: 'Trop de demandes, réessayez plus tard.', success: false })
    const { result } = setup()
    act(() => { result.current.setName('Jean Dupont'); result.current.setEmail('jean@exemple.fr'); result.current.setFreeDescription('Refaire la salle de bain') })
    await act(async () => { result.current.handleSubmit() })
    expect(result.current.success).toBe(false)
    expect(result.current.submitError).toBe('Trop de demandes, réessayez plus tard.')
    expect(JSON.parse(JSON.stringify(submitQuoteRequest.mock.calls[0][1].get('type')))).toBe('custom')
  })
})
