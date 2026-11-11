// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useQuoteEditor, type QuoteEditorProps } from '@/app/(app)/finances/quote-editor/useQuoteEditor'
import {
  quoteEditorRecoveryKey,
  readQuoteEditorRecoveryDraft,
  writeQuoteEditorRecoveryDraft,
} from '@/app/(app)/finances/quote-editor/quoteEditorRecovery'
import type { LocalItem, LocalSection } from '@/app/(app)/finances/quote-editor/quoteEditorModel'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  updateQuote: vi.fn(),
  createQuote: vi.fn(),
  upsertQuoteSection: vi.fn(),
  deleteQuoteSection: vi.fn(),
  upsertQuoteItem: vi.fn(),
  deleteQuoteItem: vi.fn(),
  pruneQuoteItems: vi.fn(),
  sendQuote: vi.fn(),
  saveMetalPriceSnapshots: vi.fn(),
  createClientInline: vi.fn(),
  fetchClientContractsForAttachment: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/lib/data/mutations/quotes', () => ({
  createQuote: mocks.createQuote,
  updateQuote: mocks.updateQuote,
  upsertQuoteSection: mocks.upsertQuoteSection,
  deleteQuoteSection: mocks.deleteQuoteSection,
  upsertQuoteItem: mocks.upsertQuoteItem,
  deleteQuoteItem: mocks.deleteQuoteItem,
  pruneQuoteItems: mocks.pruneQuoteItems,
  sendQuote: mocks.sendQuote,
}))

vi.mock('@/lib/data/mutations/metal-price-snapshots', () => ({ saveMetalPriceSnapshots: mocks.saveMetalPriceSnapshots }))
vi.mock('@/lib/data/mutations/clients', () => ({ createClientInline: mocks.createClientInline }))
vi.mock('@/lib/data/mutations/contracts', () => ({ fetchClientContractsForAttachment: mocks.fetchClientContractsForAttachment }))

const localItem: LocalItem = {
  _tempId: 'line-temp', id: 'line-1', description: 'Ligne récupérée', quantity: 2, unit: 'm', unit_price: 35,
  unit_cost_ht: null, vat_rate: 20, type: 'custom', material_id: null, labor_rate_id: null,
  position: 1, length_m: null, width_m: null, height_m: null, dimension_pricing_mode: null,
  dim_quantity: 1, is_estimated: false, is_internal: false, transport_km: null,
  transport_conso: null, transport_prix_l: null, metal_grid_id: null, price_pending: false, labor_category: null,
}
const localSection: LocalSection = { _tempId: 'section-temp', id: 'section-1', title: 'Lot récupéré', position: 1, items: [localItem] }
const recoveryScope = { userId: 'user-1', organizationId: 'org-1', quoteId: 'quote-1' }
const client = {
  id: 'client-1', organization_id: 'org-1', type: 'company' as const, company_name: 'Client test', contact_name: null,
  first_name: null, last_name: null, email: 'client@example.test', phone: null, siret: null, address_line1: null,
  postal_code: null, city: null, status: 'active' as const, source: null, total_revenue: 0,
  payment_terms_days: 30, internal_notes: null, created_at: '2026-01-01T00:00:00.000Z',
}
const initialQuote = {
  id: 'quote-1', status: 'draft', title: 'Titre enregistré', client, client_id: 'client-1', validity_days: 30, notes_client: 'Bonjour',
  client_request_visible_on_pdf: true, aid_label: null, aid_amount: null, parent_quote_id: null,
  show_section_subtotals: false, variant_group_id: null, variant_label: null,
  sections: [], unsectionedItems: [],
}
const recoveryHeader = {
  title: 'Titre hors ligne',
  clientId: 'client-1',
  validityDays: 30,
  notesClient: 'Bonjour',
  clientRequestVisibleOnPdf: true,
  aidLabel: '',
  aidAmount: null,
  showAid: false,
  aidMode: '€' as const,
  parentQuoteId: null,
  showSectionSubtotals: false,
  variantLabel: '',
}

function recoveryInput(overrides: Partial<Parameters<typeof writeQuoteEditorRecoveryDraft>[2]> = {}) {
  return { header: { ...recoveryHeader }, sections: [localSection], deletedSectionIds: [], deletedItemIds: [], ...overrides }
}


function hookProps(overrides: Partial<QuoteEditorProps> = {}): QuoteEditorProps {
  return {
    clients: [client], initialQuote: initialQuote as never, materials: [], laborRates: [], prestationTypes: [],
    catalogContext: { businessProfile: 'btp' } as never,
    modules: { quote_ai: false } as never,
    vatConfig: { defaultQuoteValidityDays: 30, defaultShowSectionSubtotals: false, defaultVatRate: 20, isVatSubject: true } as never,
    recoveryIdentity: { userId: recoveryScope.userId, organizationId: recoveryScope.organizationId },
    ...overrides,
  }
}

beforeEach(() => {
  window.sessionStorage.clear()
  vi.clearAllMocks()
  mocks.updateQuote.mockResolvedValue({ error: null })
  mocks.upsertQuoteSection.mockResolvedValue({ sectionId: 'section-1', error: null })
  mocks.upsertQuoteItem.mockResolvedValue({ itemId: 'line-1', error: null })
  mocks.pruneQuoteItems.mockResolvedValue({ error: null })
  mocks.deleteQuoteSection.mockResolvedValue({ error: null })
  mocks.deleteQuoteItem.mockResolvedValue({ error: null })
  mocks.sendQuote.mockResolvedValue({ error: null })
})

describe('quote editor recovery', () => {
  it('isolates valid drafts by user and organization and rejects corrupted storage', () => {
    const key = quoteEditorRecoveryKey(recoveryScope)
    expect(key).not.toBeNull()
    expect(writeQuoteEditorRecoveryDraft(window.sessionStorage, recoveryScope, recoveryInput())).toBe(true)

    expect(readQuoteEditorRecoveryDraft(window.sessionStorage, recoveryScope)?.header.title).toBe('Titre hors ligne')
    expect(readQuoteEditorRecoveryDraft(window.sessionStorage, { ...recoveryScope, userId: 'user-2' })).toBeNull()
    expect(readQuoteEditorRecoveryDraft(window.sessionStorage, { ...recoveryScope, organizationId: 'org-2' })).toBeNull()
    expect(window.sessionStorage.getItem(key!)).not.toBeNull()

    window.sessionStorage.setItem(key!, '{invalid')
    expect(readQuoteEditorRecoveryDraft(window.sessionStorage, recoveryScope)).toBeNull()
    expect(window.sessionStorage.getItem(key!)).toBeNull()
  })

  it('finishes queued header saves after creating a new quote, without losing the visible draft', async () => {
    const gate = Promise.withResolvers<{ error: string | null }>()
    mocks.createQuote.mockResolvedValue({ quoteId: 'new-quote', error: null })
    mocks.updateQuote.mockReturnValue(gate.promise)
    const { result } = renderHook(() => useQuoteEditor(hookProps({ initialQuote: null })))
    act(() => {
      result.current.setTitle('Nouveau devis conservé')
      result.current.scheduleHeaderSave({ title: 'Nouveau devis conservé', validity_days: 45 })
    })
    let creation: Promise<string | null> | undefined
    await act(async () => {
      creation = result.current.ensureQuote()
      await Promise.resolve()
    })
    expect(result.current.saveStatus).toBe('saving')
    await act(async () => {
      gate.resolve({ error: null })
      await creation
    })
    expect(result.current.saveStatus).toBe('saved')
    expect(result.current.title).toBe('Nouveau devis conservé')
    expect(readQuoteEditorRecoveryDraft(window.sessionStorage, {
      ...recoveryScope, quoteId: 'new-quote',
    })).toBeNull()
  })

  it('keeps recovered title and lines through offline/session-expired saves and only retries on explicit save', async () => {
    writeQuoteEditorRecoveryDraft(window.sessionStorage, recoveryScope, recoveryInput())
    mocks.updateQuote
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ error: 'Session expirée.' })
      .mockResolvedValue({ error: null })

    const { result } = renderHook(() => useQuoteEditor(hookProps()))
    expect(result.current.title).toBe('Titre hors ligne')
    expect(result.current.sections[0]?.items[0]?.description).toBe('Ligne récupérée')
    expect(result.current.saveStatus).toBe('error')

    await act(async () => { await result.current.prepareQuoteSend(true, true) })
    expect(mocks.updateQuote).not.toHaveBeenCalled()
    expect(mocks.sendQuote).not.toHaveBeenCalled()
    expect(result.current.sendModalOpen).toBe(false)

    await act(async () => { expect(await result.current.retryPendingSave()).toBe(false) })
    expect(result.current.title).toBe('Titre hors ligne')
    expect(result.current.sections[0]?.items[0]?.description).toBe('Ligne récupérée')
    expect(result.current.saveStatus).toBe('error')
    expect(readQuoteEditorRecoveryDraft(window.sessionStorage, recoveryScope)?.header.title).toBe('Titre hors ligne')

    await act(async () => { expect(await result.current.retryPendingSave()).toBe(false) })
    expect(result.current.saveStatus).toBe('error')
    expect(mocks.sendQuote).not.toHaveBeenCalled()

    await act(async () => { expect(await result.current.retryPendingSave()).toBe(true) })
    expect(result.current.saveStatus).toBe('saved')
    expect(result.current.title).toBe('Titre hors ligne')
    expect(result.current.sections[0]?.items[0]?.description).toBe('Ligne récupérée')
    expect(readQuoteEditorRecoveryDraft(window.sessionStorage, recoveryScope)).toBeNull()
    expect(mocks.updateQuote).toHaveBeenCalledTimes(3)
    expect(mocks.upsertQuoteSection).toHaveBeenCalled()
    expect(mocks.upsertQuoteItem).toHaveBeenCalled()
    expect(mocks.sendQuote).not.toHaveBeenCalled()
  })
  it('recovers editable header values and replays deleted item and section IDs', async () => {
    const quoteWithPersistedRows = {
      ...initialQuote,
      sections: [
        { id: 'section-1', title: 'Lot sauvegardé', position: 1, items: [localItem] },
        { id: 'section-removed', title: 'Lot supprimé', position: 2, items: [] },
      ],
    }
    const header = {
      ...recoveryHeader,
      title: 'Titre repris',
      validityDays: 45,
      notesClient: 'Conditions et notes reprises',
      clientRequestVisibleOnPdf: false,
      aidLabel: 'Aide rénovation',
      aidAmount: 72,
      showAid: true,
      aidMode: '%' as const,
      parentQuoteId: 'quote-parent',
      showSectionSubtotals: true,
      variantLabel: 'Option B',
    }
    writeQuoteEditorRecoveryDraft(window.sessionStorage, recoveryScope, recoveryInput({
      header,
      sections: [{ ...localSection, items: [] }],
      deletedSectionIds: ['section-removed'],
      deletedItemIds: ['line-1'],
    }))

    const { result } = renderHook(() => useQuoteEditor(hookProps({ initialQuote: quoteWithPersistedRows as never })))
    expect(result.current.title).toBe('Titre repris')
    expect(result.current.clientId).toBe('client-1')
    expect(result.current.validityDays).toBe(45)
    expect(result.current.notesClient).toBe('Conditions et notes reprises')
    expect(result.current.clientRequestVisibleOnPdf).toBe(false)
    expect(result.current.aidLabel).toBe('Aide rénovation')
    expect(result.current.aidAmount).toBe(72)
    expect(result.current.showAid).toBe(true)
    expect(result.current.aidMode).toBe('%')
    expect(result.current.parentQuoteId).toBe('quote-parent')
    expect(result.current.showSectionSubtotals).toBe(true)
    expect(result.current.variantLabel).toBe('Option B')
    expect(result.current.sections[0]?.items).toHaveLength(0)

    await act(async () => { expect(await result.current.retryPendingSave()).toBe(true) })
    expect(mocks.updateQuote).toHaveBeenCalledWith('quote-1', expect.objectContaining({
      title: 'Titre repris',
      client_id: 'client-1',
      validity_days: 45,
      notes_client: 'Conditions et notes reprises',
      client_request_visible_on_pdf: false,
      aid_label: 'Aide rénovation',
      aid_amount: 72,
      parent_quote_id: 'quote-parent',
      show_section_subtotals: true,
      variant_label: 'Option B',
    }))
    expect(mocks.deleteQuoteItem).toHaveBeenCalledWith('line-1', 'quote-1')
    expect(mocks.deleteQuoteSection).toHaveBeenCalledWith('section-removed')
    expect(mocks.sendQuote).not.toHaveBeenCalled()
  })

  it('warns and protects navigation when local recovery storage is unavailable', () => {
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage full', 'QuotaExceededError')
    })
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    try {
      const { result } = renderHook(() => useQuoteEditor(hookProps()))

      act(() => {
        result.current.setTitle('Titre encore en mémoire')
        result.current.scheduleHeaderSave({ title: 'Titre encore en mémoire' })
      })

      expect(result.current.recoveryWarning).not.toBeNull()
      expect(result.current.confirmUnsavedNavigation()).toBe(false)
      expect(confirmSpy).toHaveBeenCalledOnce()
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
    } finally {
      storageSpy.mockRestore()
      confirmSpy.mockRestore()
    }
  })

  it('does not consume or open an assistant brief when the quote AI module is disabled', () => {
    const brief = JSON.stringify({ description: 'Brief à conserver pour plus tard.' })
    window.sessionStorage.setItem('sarah_brief_chloe', brief)
    const { result } = renderHook(() => useQuoteEditor(hookProps({
      initialQuote: null,
      modules: { quote_ai: false } as never,
      canUseQuoteAi: true,
    })))

    expect(result.current.canUseQuoteAssistant).toBe(false)
    expect(result.current.startChoice).toBe('done')
    expect(result.current.aiPanelOpen).toBe(false)
    expect(window.sessionStorage.getItem('sarah_brief_chloe')).toBe(brief)
    act(() => result.current.setAIPanelOpen(true))
    expect(result.current.aiPanelOpen).toBe(false)
  })
})
