'use client'
// @atelier-migrated
// Catalogue : onglets, recherche, listes locales, feuilles ouvertes, archivage et duplication.

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { CatalogLaborRate, CatalogMaterial, PrestationType } from '@/lib/data/queries/catalog'
import type { Supplier } from '@/lib/data/queries/suppliers'
import type { MetalPriceGrid } from '@/lib/data/mutations/metal-price-grids'
import type { ResolvedCatalogContext } from '@/lib/catalog-context'
import {
  createMaterial, deleteMaterial, deleteLaborRate, deletePrestationType,
} from '@/lib/data/mutations/catalog'
import { deleteSupplier } from '@/lib/data/mutations/suppliers'
import {
  PAGE_SIZE, duplicateMaterialFormData, filterLabor, filterMaterials, filterPrestations, filterSuppliers, mergeCategories,
  type CatalogTab, type MaterialKind,
} from './catalogModel'

export type CatalogProps = {
  initialMaterials: CatalogMaterial[]
  initialLaborRates: CatalogLaborRate[]
  initialPrestationTypes: PrestationType[]
  initialSuppliers?: Supplier[]
  catalogContext: ResolvedCatalogContext
  catalogAIEnabled?: boolean
  hasMetalPricing?: boolean
  metalPriceGrids?: MetalPriceGrid[]
}

export type CatalogState = ReturnType<typeof useCatalog>

export type CatalogConfirm = { type: 'material' | 'labor' | 'prestation' | 'supplier'; id: string; label: string }

export function useCatalog({
  initialMaterials, initialLaborRates, initialPrestationTypes, initialSuppliers = [], catalogContext,
}: CatalogProps) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [tab, setTabState] = useState<CatalogTab>('materials')
  const [search, setSearchState] = useState('')
  const [count, setCount] = useState(PAGE_SIZE)

  // Données locales, resynchronisées quand le serveur renvoie de nouvelles props
  const [materials, setMaterials] = useState<CatalogMaterial[]>(initialMaterials)
  const [laborRates, setLaborRates] = useState<CatalogLaborRate[]>(initialLaborRates)
  const [prestationTypes, setPrestationTypes] = useState<PrestationType[]>(initialPrestationTypes)
  const [suppliers, setSuppliers] = useState<Supplier[]>(initialSuppliers)
  useEffect(() => { setMaterials(initialMaterials) }, [initialMaterials])
  useEffect(() => { setLaborRates(initialLaborRates) }, [initialLaborRates])
  useEffect(() => { setPrestationTypes(initialPrestationTypes) }, [initialPrestationTypes])
  useEffect(() => { setSuppliers(initialSuppliers) }, [initialSuppliers])

  // Feuilles
  const [materialSheet, setMaterialSheet] = useState<{ material: CatalogMaterial | null; kind: MaterialKind } | null>(null)
  const [laborSheet, setLaborSheet] = useState<{ item: CatalogLaborRate | null } | null>(null)
  const [supplierSheet, setSupplierSheet] = useState<{ supplier: Supplier | null } | null>(null)
  const [importTab, setImportTab] = useState<CatalogTab | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [newPrestationOpen, setNewPrestationOpen] = useState(false)
  const [editingPrestation, setEditingPrestation] = useState<PrestationType | null>(null)
  const [confirm, setConfirm] = useState<CatalogConfirm | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  function setTab(next: CatalogTab) { setTabState(next); setCount(PAGE_SIZE); setSearchState('') }
  function setSearch(value: string) { setSearchState(value); setCount(PAGE_SIZE) }
  function showMore() { setCount(c => c + PAGE_SIZE) }

  // ── Catégories ──────────────────────────────────────────────────────────────

  const d = catalogContext.defaultCategories
  const materialCategories = useMemo(() => mergeCategories(d.material, materials.map(m => m.category)), [d.material, materials])
  const serviceCategories = useMemo(() => mergeCategories(d.service, materials.filter(m => m.item_kind === 'service').map(m => m.category)), [d.service, materials])
  const laborCategories = useMemo(() => mergeCategories(d.laborRate, laborRates.map(l => l.category)), [d.laborRate, laborRates])
  const prestationCategories = useMemo(() => mergeCategories(d.bundleTemplate, prestationTypes.map(p => p.category)), [d.bundleTemplate, prestationTypes])

  // ── Listes filtrées ─────────────────────────────────────────────────────────

  const filteredMaterials = useMemo(() => (tab === 'materials' || tab === 'services') ? filterMaterials(materials, tab, search) : [], [materials, tab, search])
  const filteredLabor = useMemo(() => filterLabor(laborRates, search), [laborRates, search])
  const filteredPrestations = useMemo(() => filterPrestations(prestationTypes, search), [prestationTypes, search])
  const filteredSuppliers = useMemo(() => filterSuppliers(suppliers, search), [suppliers, search])
  const counts: Record<CatalogTab, number> = {
    materials: materials.filter(m => m.item_kind !== 'service').length,
    services: materials.filter(m => m.item_kind === 'service').length,
    labor: laborRates.length,
    prestations: prestationTypes.length,
    suppliers: suppliers.length,
  }

  // ── Actions ─────────────────────────────────────────────────────────────────

  function handleMaterialSaved(updated: CatalogMaterial) {
    setMaterials(prev => prev.map(m => m.id === updated.id ? updated : m))
  }

  function handleLaborSaved(updated: CatalogLaborRate) {
    setLaborRates(prev => prev.map(l => l.id === updated.id ? updated : l))
  }

  function handleSupplierSaved(updated: Supplier) {
    setSuppliers(prev => prev.map(s => s.id === updated.id ? updated : s))
  }

  function handlePrestationSaved(updated: PrestationType) {
    setPrestationTypes(prev => prev.some(p => p.id === updated.id) ? prev.map(p => p.id === updated.id ? updated : p) : [updated, ...prev])
  }

  function refresh() { router.refresh() }

  function handleDuplicateMaterial(item: CatalogMaterial) {
    setActionError(null)
    startTransition(async () => {
      const res = await createMaterial({ error: null, success: false }, duplicateMaterialFormData(item))
      if (res.error) setActionError(res.error)
      else router.refresh()
    })
  }

  /** Archivage confirmé : la ligne disparaît tout de suite, et revient si le serveur refuse. */
  function handleConfirmArchive() {
    const c = confirm
    if (!c) return
    setConfirm(null)
    setActionError(null)
    startTransition(async () => {
      let error: string | null = null
      if (c.type === 'material') {
        const prev = materials
        setMaterials(p => p.filter(m => m.id !== c.id))
        error = (await deleteMaterial(c.id)).error
        if (error) setMaterials(prev)
      } else if (c.type === 'labor') {
        const prev = laborRates
        setLaborRates(p => p.filter(l => l.id !== c.id))
        error = (await deleteLaborRate(c.id)).error
        if (error) setLaborRates(prev)
      } else if (c.type === 'prestation') {
        const prev = prestationTypes
        setPrestationTypes(p => p.filter(x => x.id !== c.id))
        error = (await deletePrestationType(c.id)).error
        if (error) setPrestationTypes(prev)
      } else {
        const prev = suppliers
        setSuppliers(p => p.filter(s => s.id !== c.id))
        error = (await deleteSupplier(c.id)).error
        if (error) setSuppliers(prev)
      }
      if (error) setActionError(error)
    })
  }

  function openCreate() {
    setActionError(null)
    if (tab === 'materials') setMaterialSheet({ material: null, kind: 'article' })
    else if (tab === 'services') setMaterialSheet({ material: null, kind: 'service' })
    else if (tab === 'labor') setLaborSheet({ item: null })
    else if (tab === 'prestations') setNewPrestationOpen(true)
    else setSupplierSheet({ supplier: null })
  }

  return {
    router, tab, setTab, search, setSearch, count, showMore,
    materials, laborRates, prestationTypes, suppliers,
    materialCategories, serviceCategories, laborCategories, prestationCategories,
    filteredMaterials, filteredLabor, filteredPrestations, filteredSuppliers, counts,
    materialSheet, setMaterialSheet, laborSheet, setLaborSheet, supplierSheet, setSupplierSheet,
    importTab, setImportTab, aiOpen, setAiOpen, newPrestationOpen, setNewPrestationOpen, editingPrestation, setEditingPrestation,
    confirm, setConfirm, actionError, setActionError,
    handleMaterialSaved, handleLaborSaved, handleSupplierSaved, handlePrestationSaved, refresh,
    handleDuplicateMaterial, handleConfirmArchive, openCreate,
  }
}
