// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CatalogClient from '@/app/(app)/catalog/CatalogClient'
import JalonsSection from '@/app/(app)/chantiers/[chantierId]/JalonsSection'
import { NewTaskSheet } from '@/app/(app)/chantiers/[chantierId]/TaskSheets'

const mocks = vi.hoisted(() => ({
  catalogState: { value: {} as Record<string, unknown> },
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/components/ui/Menu', () => ({
  Menu: ({ items }: { items: Array<{ label: string }> }) => <div>{items.map(item => <span key={item.label}>{item.label}</span>)}</div>,
}))

vi.mock('@/lib/data/mutations/chantier-jalons', () => ({
  createJalon: vi.fn(), updateJalon: vi.fn(), deleteJalon: vi.fn(), completeJalon: vi.fn(),
  generateJalonInvoice: vi.fn(), assignTasksToJalon: vi.fn(),
}))

vi.mock('@/app/(app)/catalog/useCatalog', () => ({ useCatalog: () => mocks.catalogState.value }))
vi.mock('@/app/(app)/catalog/catalogModel', () => ({
  fmtMoney: (value: number) => `${value} €`,
  getLaborImportConfig: () => ({}),
  getMaterialImportConfig: () => ({}),
  getSupplierImportConfig: () => ({}),
  laborMarginPct: () => null,
  visibleSlice: (items: unknown[]) => ({ items, rest: 0 }),
}))
vi.mock('@/app/(app)/catalog/ModeleEditor', () => ({ default: () => null }))
vi.mock('@/app/(app)/catalog/ModeleImportSheet', () => ({ default: () => null }))
vi.mock('@/app/(app)/catalog/CatalogSheets', () => ({
  ImportSheet: () => null, LaborSheet: () => null, MaterialSheet: () => null, SupplierSheet: () => null,
}))
vi.mock('@/components/catalog/CatalogAIPanel', () => ({ default: () => null }))

const catalogContext = {
  activityId: 'btp', sectorFallback: 'BTP', onboardingDescription: 'Bâtiment', resourceTypeOptions: [],
  laborRateUi: { typeHumanLabel: 'Main d’œuvre' },
  defaultCategories: { material: [], service: [], laborRate: [], bundleTemplate: [] },
  labelSet: {
    catalogTitle: 'Catalogue', catalogSubtitle: 'Vos ressources',
    material: { plural: 'Matériaux', singular: 'matériau', createLabel: 'Créer un matériau', emptyLabel: 'Aucun matériau', emptyHelp: 'Ajoutez un matériau.' },
    service: { plural: 'Prestations', singular: 'prestation', createLabel: 'Créer une prestation', emptyLabel: 'Aucune prestation', emptyHelp: 'Ajoutez une prestation.' },
    laborRate: { plural: 'Main-d’œuvre', singular: 'tarif', createLabel: 'Créer un tarif', emptyLabel: 'Aucun tarif', emptyHelp: 'Ajoutez un tarif.' },
    bundleTemplate: { plural: 'Modèles', singular: 'modèle', createLabel: 'Créer un modèle', emptyLabel: 'Aucun modèle', emptyHelp: 'Ajoutez un modèle.' },
  },
}

function emptyCatalogState() {
  const noop = vi.fn()
  return {
    tab: 'materials', setTab: noop, search: '', setSearch: noop, count: 20, showMore: noop,
    counts: { materials: 0, services: 0, labor: 0, prestations: 0, suppliers: 0 },
    filteredMaterials: [], filteredLabor: [], filteredPrestations: [], filteredSuppliers: [],
    actionError: null, editor: null, openCreate: noop, importTab: null, setImportTab: noop,
    aiOpen: false, setAiOpen: noop, materialSheet: null, laborSheet: null, supplierSheet: null,
    confirm: null, setConfirm: noop, refresh: noop,
    materials: [], laborRates: [], suppliers: [], serviceCategories: [], materialCategories: [],
    laborCategories: [], setMaterialSheet: noop, setLaborSheet: noop, setSupplierSheet: noop,
    handleMaterialSaved: noop, handleLaborSaved: noop, handleSupplierSaved: noop,
    handleDuplicateMaterial: noop, handlePrestationSaved: noop, handleConfirmArchive: noop,
  }
}

describe('assistant entry visibility', () => {
  beforeEach(() => { mocks.catalogState.value = emptyCatalogState() })

  it('omits chantier suggestions when the permission/module gate is off', () => {
    const { rerender } = render(<JalonsSection initialJalons={[]} chantierId="chantier-1" budgetHt={0} taches={[]} canSuggestAi={false} />)
    expect(screen.queryByText(/Proposer des jalons avec/)).toBeNull()

    rerender(<JalonsSection initialJalons={[]} chantierId="chantier-1" budgetHt={0} taches={[]} canSuggestAi />)
    expect(screen.queryByText(/Proposer des jalons avec/)).not.toBeNull()
  })

  it('omits the catalogue AI menu entry when its permission/module gate is off', () => {
    render(
      <CatalogClient
        initialMaterials={[]}
        initialLaborRates={[]}
        initialPrestationTypes={[]}
        catalogContext={catalogContext as never}
        catalogAIEnabled={false}
      />,
    )
    expect(screen.queryByText(/Demander à/)).toBeNull()
    expect(screen.queryByText('Importer (CSV ou Excel)')).not.toBeNull()
  })

  it('hides task suggestions when their module or permission gate is off', () => {
    const common = {
      linkedQuoteId: 'quote-1',
      taskLibraryTitles: [],
      suggestTasksError: null,
      suggestTasksLoading: false,
      tacheLoading: false,
      newTacheTitle: '',
      newTacheDue: '',
      newTacheEquipeIds: new Set<string>(),
      newTacheMemberIds: new Set<string>(),
      setNewTacheTitle: vi.fn(),
      setNewTacheDue: vi.fn(),
      handleAddTache: vi.fn(),
      allEquipes: [],
      allAssignableMembers: [],
    }
    const props = {
      q: { ...common, canSuggestAiMilestones: false } as never,
      onClose: vi.fn(),
      onSuggest: vi.fn(),
    }
    const { rerender } = render(<NewTaskSheet {...props} />)
    expect(screen.queryByText('Importer depuis le devis')).toBeNull()

    rerender(<NewTaskSheet {...props} q={{ ...common, canSuggestAiMilestones: true } as never} />)
    expect(screen.queryByText('Importer depuis le devis')).not.toBeNull()
  })
})
