'use client'
// Éditeur de modèles de devis et import des modèles : conservés tels quels dans ce lot (repris dans le lot suivant).

import React, { useState } from 'react'

import { formatCurrency } from '@/components/shared'
import { type CatalogMaterial, type CatalogLaborRate, type PrestationType, type PrestationTypeItem, type PrestationItemType } from '@/lib/data/queries/catalog'
import { importPrestationTypes, createPrestationType, updatePrestationType, setPrestationTypeItems, type ImportCatalogState } from '@/lib/data/mutations/catalog'
import { type ImportSuppliersState } from '@/lib/data/mutations/suppliers'

import { Plus, Trash2, X, Package, AlertCircle, AlertTriangle, FileUp, Download, CheckCircle2, Layers, ToggleLeft, ToggleRight, Eye, EyeOff, Wrench, Truck, Tag, Cog } from 'lucide-react'
import { ActionButton } from '@/components/ui/ActionButton'

import { type ResolvedCatalogContext } from '@/lib/catalog-context'
import { getCatalogLabelsForProfile, getCatalogSaleUnitPrice, getInternalResourceUnitCost } from '@/lib/catalog-ui'

import { parseFileToRows, downloadCSVTemplate } from './catalogImport'

const inputCls = 'w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all'

// ─── NewPrestationModal ───────────────────────────────────────────────────────

type PrestationHeaderForm = {
  name: string
  description: string
  is_active: boolean
}

type LocalItem = {
  tempId: string
  item_type: PrestationItemType
  material_id: string | null
  labor_rate_id: string | null
  designation: string
  quantity: string
  unit: string
  unit_price_ht: string
  unit_cost_ht: string
  is_internal: boolean
  save_to_catalog: boolean
}

type ModalSection = {
  tempId: string
  title: string
  items: LocalItem[]
}

const ITEM_TYPE_CONFIG: Record<PrestationItemType, { color: string; defaultInternal: boolean }> = {
  service:   { color: 'bg-cyan-500/15 text-cyan-500 border-cyan-500/30',        defaultInternal: false },
  labor:     { color: 'bg-blue-500/15 text-blue-500 border-blue-500/30',         defaultInternal: true  },
  transport: { color: 'bg-orange-500/15 text-orange-500 border-orange-500/30',   defaultInternal: true  },
  material:  { color: 'bg-teal-500/15 text-teal-500 border-teal-500/30',         defaultInternal: false },
  free:      { color: 'bg-secondary/15 text-secondary border-secondary/30',      defaultInternal: false },
  equipment: { color: 'bg-purple-500/15 text-purple-500 border-purple-500/30',   defaultInternal: true  },
}

function parseEquipmentAmortizationLabel(designation: string) {
  const match = designation.match(/Amortissement\s*:\s*([\d.,]+)\s*€\s*\/\s*([\d.,]+)\s*usages?/i)
  const name = (designation.split(/\n/)[0] ?? '').trim()
  const purchasePrice = match ? Number(match[1].replace(',', '.')) : null
  const lifetimeUses = match ? Number(match[2].replace(',', '.')) : null

  return {
    name,
    purchasePrice: purchasePrice != null && Number.isFinite(purchasePrice) ? purchasePrice : null,
    lifetimeUses: lifetimeUses != null && Number.isFinite(lifetimeUses) ? lifetimeUses : null,
  }
}

function buildEquipmentAmortizationLabel(name: string, purchasePrice: number, lifetimeUses: number) {
  const label = name.trim() || 'Équipement amorti'
  if (purchasePrice > 0 && lifetimeUses > 0) {
    return `${label}\n\nAmortissement : ${purchasePrice} € / ${lifetimeUses} usages`
  }
  return label
}

const emptyPrestationHeader = (): PrestationHeaderForm => ({
  name: '', description: '', is_active: true,
})

const newLocalItem = (type: PrestationItemType = 'free'): LocalItem => ({
  tempId: Math.random().toString(36).slice(2),
  item_type: type,
  material_id: null,
  labor_rate_id: null,
  designation: '',
  quantity: '1',
  unit: type === 'labor' ? 'h' : type === 'transport' ? 'L' : type === 'service' ? 'forfait' : type === 'equipment' ? 'usage' : 'u',
  unit_price_ht: '0',
  unit_cost_ht: '0',
  is_internal: ITEM_TYPE_CONFIG[type].defaultInternal,
  save_to_catalog: false,
})

function toLocalItem(i: PrestationTypeItem): LocalItem {
  return {
    tempId: i.id,
    item_type: i.item_type,
    material_id: i.material_id,
    labor_rate_id: i.labor_rate_id,
    designation: i.designation,
    quantity: String(i.quantity),
    unit: i.unit,
    unit_price_ht: String(i.unit_price_ht),
    unit_cost_ht: String(i.unit_cost_ht),
    is_internal: i.is_internal,
    save_to_catalog: false,
  }
}

function ItemRow({
  item, sectionTempId, materials, laborRates, lineTypeLabels,
  serviceItemPlaceholder, materialItemPlaceholder,
  onPatch, onRemove,
}: {
  item: LocalItem
  sectionTempId: string
  materials: CatalogMaterial[]
  laborRates: CatalogLaborRate[]
  lineTypeLabels: ResolvedCatalogContext['bundleTemplateUi']['lineTypeLabels']
  serviceItemPlaceholder: string
  materialItemPlaceholder: string
  onPatch: (sectionId: string, itemId: string, patch: Partial<LocalItem>) => void
  onRemove: (sectionId: string, itemId: string) => void
}) {
  const cfg = ITEM_TYPE_CONFIG[item.item_type]
  const UNITS = ['h', 'j', 'sem', 'u', 'm²', 'ml', 'kg', 'L', 'forfait', 't', 'm³']
  const patch = (p: Partial<LocalItem>) => onPatch(sectionTempId, item.tempId, p)

  // ── Calculateur carburant (transport uniquement) ──────────────────────────
  const [transKm, setTransKm] = React.useState(() => item.item_type === 'transport' ? Math.round((parseFloat(item.quantity) || 0) * 100 / (8)) : 0)
  const [transConso, setTransConso] = React.useState(8)
  const [transPrixL, setTransPrixL] = React.useState(() => item.item_type === 'transport' ? parseFloat(item.unit_cost_ht) || 1.85 : 1.85)
  const transLiters = Math.round(transKm * transConso / 100 * 100) / 100

  // ── Calculateur amortissement (equipment uniquement) ──────────────────────
  const equipmentMeta = parseEquipmentAmortizationLabel(item.designation)
  const storedEquipmentCost = item.item_type === 'equipment' ? parseFloat(item.unit_cost_ht) || 0 : 0
  const [equipPurchase, setEquipPurchase] = React.useState(() => item.item_type === 'equipment' ? equipmentMeta.purchasePrice ?? storedEquipmentCost * 100 : 0)
  const [equipUses, setEquipUses] = React.useState(() => item.item_type === 'equipment' ? equipmentMeta.lifetimeUses ?? 100 : 100)
  const equipCostPerUse = equipUses > 0 ? Math.round((equipPurchase / equipUses) * 100) / 100 : 0

  React.useEffect(() => {
    if (item.item_type !== 'equipment' || equipPurchase <= 0 || equipUses <= 0) return
    const currentName = parseEquipmentAmortizationLabel(item.designation).name
    patch({
      designation: buildEquipmentAmortizationLabel(currentName, equipPurchase, equipUses),
      quantity: '1',
      unit_cost_ht: String(equipCostPerUse),
      unit_price_ht: '0',
      unit: 'usage',
      is_internal: true,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipPurchase, equipUses])

  React.useEffect(() => {
    if (item.item_type !== 'transport' || transKm <= 0) return
    patch({
      quantity: String(transLiters),
      unit: 'L',
      unit_cost_ht: String(transPrixL),
      designation: item.designation || `Carburant - trajet ${transKm} km`,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transKm, transConso, transPrixL])

  function pickMaterial(materialId: string) {
    const mat = materials.find(m => m.id === materialId)
    if (!mat) return
    patch({ material_id: mat.id, labor_rate_id: null, designation: mat.name, unit: mat.unit ?? 'u', unit_price_ht: String(getCatalogSaleUnitPrice(mat)), unit_cost_ht: String(mat.purchase_price ?? 0) })
  }

  function pickLaborRate(laborId: string) {
    const lr = laborRates.find(l => l.id === laborId)
    if (!lr) return
    const internalCost = getInternalResourceUnitCost(lr)
    patch({ labor_rate_id: lr.id, material_id: null, designation: lr.designation, unit: lr.unit ?? 'h', unit_price_ht: String(internalCost), unit_cost_ht: String(internalCost) })
  }

  return (
    <tr className="hover:bg-accent/5 transition-colors">
      {/* Type */}
      <td className="px-3 py-2">
        <select
          value={item.item_type}
          onChange={e => {
            const t = e.target.value as PrestationItemType
            patch({ item_type: t, is_internal: ITEM_TYPE_CONFIG[t].defaultInternal, material_id: null, labor_rate_id: null, unit: t === 'labor' ? 'h' : t === 'transport' ? 'L' : t === 'service' ? 'forfait' : t === 'equipment' ? 'usage' : item.unit })
          }}
          className={`px-2 py-1 rounded-lg text-xs font-bold border appearance-none cursor-pointer ${cfg.color} bg-transparent`}
        >
          {(Object.keys(ITEM_TYPE_CONFIG) as PrestationItemType[]).map(k => (
            <option key={k} value={k}>{lineTypeLabels[k]}</option>
          ))}
        </select>
      </td>

      {/* Désignation */}
      <td className="px-3 py-2 min-w-[160px]">
        {item.item_type === 'labor' ? (
          <div className="flex gap-1.5">
            <input type="text" value={item.designation} onChange={e => patch({ designation: e.target.value })} placeholder="ex: Poseur" className="flex-1 px-2 py-1 bg-base dark:bg-white/5 border border-transparent focus:border-accent rounded-lg text-primary text-sm outline-none" />
            {laborRates.length > 0 && (
              <select value={item.labor_rate_id ?? ''} onChange={e => { if (e.target.value) pickLaborRate(e.target.value) }} className="px-1 py-1 bg-base dark:bg-white/5 border border-transparent focus:border-accent rounded-lg text-secondary text-xs outline-none appearance-none cursor-pointer" title="Choisir depuis le catalogue">
                <option value="">↑ Catalogue</option>
                {laborRates.map(lr => <option key={lr.id} value={lr.id}>{lr.designation}</option>)}
              </select>
            )}
          </div>
        ) : item.item_type === 'material' || item.item_type === 'service' ? (
          <div className="space-y-1">
            <div className="flex gap-1.5">
              <input type="text" value={item.designation} onChange={e => patch({ designation: e.target.value, material_id: null })} placeholder={item.item_type === 'service' ? serviceItemPlaceholder : materialItemPlaceholder} className="flex-1 px-2 py-1 bg-base dark:bg-white/5 border border-transparent focus:border-accent rounded-lg text-primary text-sm outline-none" />
              {materials.length > 0 && (
                <select value={item.material_id ?? ''} onChange={e => { if (e.target.value) pickMaterial(e.target.value) }} className="px-1 py-1 bg-base dark:bg-white/5 border border-transparent focus:border-accent rounded-lg text-secondary text-xs outline-none appearance-none cursor-pointer" title="Choisir depuis le catalogue">
                  <option value="">↑ Catalogue</option>
                  {materials
                    .filter(m => item.item_type === 'service' ? m.item_kind === 'service' : m.item_kind !== 'service')
                    .map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              )}
            </div>
            {!item.material_id && item.designation.trim() && (
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={item.save_to_catalog} onChange={e => patch({ save_to_catalog: e.target.checked })} className="w-3 h-3 accent-[var(--accent)]" />
                <span className="text-[10px] text-secondary">Enregistrer dans le catalogue</span>
              </label>
            )}
          </div>
        ) : item.item_type === 'transport' ? (
          <div className="space-y-1.5">
            <input type="text" value={item.designation} onChange={e => patch({ designation: e.target.value })} placeholder="ex: Carburant - trajet" className="w-full px-2 py-1 bg-base dark:bg-white/5 border border-transparent focus:border-accent rounded-lg text-primary text-sm outline-none" />
            <div className="flex items-center gap-1.5 flex-wrap">
              <label className="flex items-center gap-1 text-xs text-secondary whitespace-nowrap">
                km A/R
                <input type="number" min={0} value={transKm || ''} onChange={e => setTransKm(Number(e.target.value))}
                  className="w-14 px-1.5 py-0.5 bg-base dark:bg-white/5 border border-[var(--elevation-border)] focus:border-accent rounded text-primary tabular-nums text-right text-xs outline-none" />
              </label>
              <label className="flex items-center gap-1 text-xs text-secondary whitespace-nowrap">
                L/100
                <input type="number" min={1} step={0.1} value={transConso} onChange={e => setTransConso(Number(e.target.value))}
                  className="w-12 px-1.5 py-0.5 bg-base dark:bg-white/5 border border-[var(--elevation-border)] focus:border-accent rounded text-primary tabular-nums text-right text-xs outline-none" />
              </label>
              <label className="flex items-center gap-1 text-xs text-secondary whitespace-nowrap">
                €/L
                <input type="number" min={0} step={0.01} value={transPrixL} onChange={e => setTransPrixL(Number(e.target.value))}
                  className="w-14 px-1.5 py-0.5 bg-base dark:bg-white/5 border border-[var(--elevation-border)] focus:border-accent rounded text-primary tabular-nums text-right text-xs outline-none" />
              </label>
              {transKm > 0 && (
                <span className="px-2 py-0.5 text-xs rounded-md bg-amber-500/15 text-amber-600 font-semibold border border-amber-500/30 whitespace-nowrap">
                  = {transLiters.toFixed(2)} L
                </span>
              )}
            </div>
          </div>
        ) : item.item_type === 'equipment' ? (
          <div className="space-y-1.5">
            <input
              type="text"
              value={parseEquipmentAmortizationLabel(item.designation).name}
              onChange={e => patch({ designation: buildEquipmentAmortizationLabel(e.target.value, equipPurchase, equipUses) })}
              placeholder="ex: Aspirateur industriel"
              className="w-full px-2 py-1 bg-base dark:bg-white/5 border border-transparent focus:border-accent rounded-lg text-primary text-sm outline-none"
            />
            <div className="flex items-center gap-1.5 flex-wrap">
              <label className="flex items-center gap-1 text-xs text-secondary whitespace-nowrap">
                Prix achat
                <input type="number" min={0} step={0.01} value={equipPurchase || ''} onChange={e => setEquipPurchase(Number(e.target.value))}
                  className="w-20 px-1.5 py-0.5 bg-base dark:bg-white/5 border border-[var(--elevation-border)] focus:border-accent rounded text-primary tabular-nums text-right text-xs outline-none" />
                <span className="text-secondary/60">€</span>
              </label>
              <label className="flex items-center gap-1 text-xs text-secondary whitespace-nowrap">
                Usages vie
                <input type="number" min={1} step={1} value={equipUses} onChange={e => setEquipUses(Number(e.target.value))}
                  className="w-16 px-1.5 py-0.5 bg-base dark:bg-white/5 border border-[var(--elevation-border)] focus:border-accent rounded text-primary tabular-nums text-right text-xs outline-none" />
              </label>
              {equipPurchase > 0 && (
                <span className="px-2 py-0.5 text-xs rounded-md bg-purple-500/15 text-purple-600 font-semibold border border-purple-500/30 whitespace-nowrap">
                  = {equipCostPerUse.toFixed(2)} €/usage
                </span>
              )}
            </div>
          </div>
        ) : (
          <input type="text" value={item.designation} onChange={e => patch({ designation: e.target.value })} placeholder="Désignation..." className="w-full px-2 py-1 bg-base dark:bg-white/5 border border-transparent focus:border-accent rounded-lg text-primary text-sm outline-none" />
        )}
      </td>

      {/* Quantité */}
      <td className="px-3 py-2">
        {item.item_type === 'transport' ? (
          <span className="block w-14 px-2 py-1 text-primary text-sm text-right tabular-nums opacity-60">{transLiters > 0 ? transLiters.toFixed(2) : '—'}</span>
        ) : item.item_type === 'equipment' ? (
          <span className="block w-14 px-2 py-1 text-primary text-sm text-right tabular-nums opacity-60">1</span>
        ) : (
          <input type="number" step="0.01" value={item.quantity} onChange={e => patch({ quantity: e.target.value })} className="w-14 px-2 py-1 bg-base dark:bg-white/5 border border-transparent focus:border-accent rounded-lg text-primary text-sm text-right tabular-nums outline-none" />
        )}
      </td>

      {/* Unité */}
      <td className="px-3 py-2">
        {item.item_type === 'transport' ? (
          <span className="block px-2 py-1 text-primary text-sm opacity-60">L</span>
        ) : item.item_type === 'equipment' ? (
          <span className="block px-2 py-1 text-primary text-sm opacity-60">usage</span>
        ) : (
          <select value={item.unit} onChange={e => patch({ unit: e.target.value })} className="px-2 py-1 bg-base dark:bg-white/5 border border-transparent focus:border-accent rounded-lg text-primary text-sm outline-none appearance-none">
            {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            {!UNITS.includes(item.unit) && <option value={item.unit}>{item.unit}</option>}
          </select>
        )}
      </td>

      {/* PU HT */}
      <td className="px-3 py-2">
        {item.item_type === 'transport' ? (
          <span className="block w-20 px-2 py-1 text-right tabular-nums text-sm opacity-60">{transPrixL.toFixed(2)} €</span>
        ) : item.item_type === 'equipment' ? (
          <span className="block w-20 px-2 py-1 text-right tabular-nums text-sm opacity-40">—</span>
        ) : (
          <div className="relative">
            <input type="number" step="0.01" value={item.unit_price_ht} onChange={e => patch({ unit_price_ht: e.target.value })} disabled={item.is_internal} className="w-20 px-2 py-1 pr-5 bg-base dark:bg-white/5 border border-transparent focus:border-accent rounded-lg text-primary text-sm text-right tabular-nums outline-none disabled:opacity-40" />
            <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-secondary text-xs">€</span>
          </div>
        )}
      </td>

      {/* CR HT */}
      <td className="px-3 py-2">
        {item.item_type === 'equipment' ? (
          <span className="block w-20 px-2 py-1 text-right tabular-nums text-sm font-semibold text-purple-500">{equipCostPerUse > 0 ? `${equipCostPerUse.toFixed(2)} €` : '—'}</span>
        ) : (
          <div className="relative">
            <input type="number" step="0.01" value={item.unit_cost_ht} onChange={e => patch({ unit_cost_ht: e.target.value })} className="w-20 px-2 py-1 pr-5 bg-base dark:bg-white/5 border border-transparent focus:border-accent rounded-lg text-primary text-sm text-right tabular-nums outline-none" />
            <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-secondary text-xs">€</span>
          </div>
        )}
      </td>

      {/* Interne toggle */}
      <td className="px-3 py-2 text-center">
        <button type="button" onClick={() => patch({ is_internal: !item.is_internal })} title={item.is_internal ? 'Interne (caché du devis client)' : 'Visible dans le devis client'} className={`transition-colors ${item.is_internal ? 'text-accent' : 'text-secondary/30 hover:text-secondary'}`}>
          {item.is_internal ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </td>

      {/* Supprimer */}
      <td className="px-2 py-2">
        <button type="button" onClick={() => onRemove(sectionTempId, item.tempId)} className="p-1.5 rounded-lg text-red-400/60 hover:text-red-500 hover:bg-red-500/10 transition-colors">
          <Trash2 className="w-4 h-4" />
        </button>
      </td>
    </tr>
  )
}

export function NewPrestationModal({
  isOpen, onClose, editing, onSaved, materials, laborRates, catalogContext,
}: {
  isOpen: boolean
  onClose: () => void
  editing: PrestationType | null
  onSaved: (updated: PrestationType) => void
  categories?: string[]
  materials: CatalogMaterial[]
  laborRates: CatalogLaborRate[]
  catalogContext: ResolvedCatalogContext
}) {
  const [form, setForm] = useState<PrestationHeaderForm>(emptyPrestationHeader())
  const [sections, setSections] = useState<ModalSection[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()
  const { serviceItemPlaceholder, materialItemPlaceholder } = getCatalogLabelsForProfile(catalogContext)

  React.useEffect(() => {
    if (!isOpen) return
    if (editing) {
      setForm({ name: editing.name, description: editing.description ?? '', is_active: editing.is_active })
      const sorted = [...(editing.items ?? [])].sort((a, b) => a.position - b.position)
      // Regroup by section_title
      const map = new Map<string, LocalItem[]>()
      for (const it of sorted) {
        const key = it.section_title || ''
        if (!map.has(key)) map.set(key, [])
        map.get(key)!.push(toLocalItem(it))
      }
      if (map.size === 0) {
        setSections([{ tempId: Math.random().toString(36).slice(2), title: '', items: [] }])
      } else {
        setSections([...map.entries()].map(([title, items]) => ({ tempId: Math.random().toString(36).slice(2), title, items })))
      }
    } else {
      setForm(emptyPrestationHeader())
      setSections([{ tempId: Math.random().toString(36).slice(2), title: '', items: [] }])
    }
    setError(null)
  }, [isOpen, editing])

  const allItems = sections.flatMap(s => s.items)
  const totalPriceHt = allItems.reduce((s, i) => !i.is_internal ? s + (parseFloat(i.quantity) || 0) * (parseFloat(i.unit_price_ht) || 0) : s, 0)
  const totalCostHt  = allItems.reduce((s, i) => s + (parseFloat(i.quantity) || 0) * (parseFloat(i.unit_cost_ht) || 0), 0)
  const computedMargin = totalPriceHt > 0 ? ((totalPriceHt - totalCostHt) / totalPriceHt * 100).toFixed(1) : null

  function addSection() {
    setSections(prev => [...prev, { tempId: Math.random().toString(36).slice(2), title: '', items: [] }])
  }

  function removeSection(sectionId: string) {
    setSections(prev => prev.filter(s => s.tempId !== sectionId))
  }

  function patchSectionTitle(sectionId: string, title: string) {
    setSections(prev => prev.map(s => s.tempId === sectionId ? { ...s, title } : s))
  }

  function addItemToSection(sectionId: string, type: PrestationItemType) {
    setSections(prev => prev.map(s => s.tempId === sectionId ? { ...s, items: [...s.items, newLocalItem(type)] } : s))
  }

  function patchItemInSection(sectionId: string, itemId: string, patch: Partial<LocalItem>) {
    setSections(prev => prev.map(s => s.tempId === sectionId ? { ...s, items: s.items.map(i => i.tempId === itemId ? { ...i, ...patch } : i) } : s))
  }

  function removeItemFromSection(sectionId: string, itemId: string) {
    setSections(prev => prev.map(s => s.tempId === sectionId ? { ...s, items: s.items.filter(i => i.tempId !== itemId) } : s))
  }

  function handleSubmit() {
    if (!form.name.trim()) { setError('Le nom est requis.'); return }
    setError(null)
    startTransition(async () => {
      const headerPayload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        unit: 'forfait',
        category: null,
        basePriceHt: 0,
        baseCostHt: 0,
        isActive: form.is_active,
      }

      let prestationId: string
      if (editing) {
        const res = await updatePrestationType(editing.id, headerPayload)
        if (res.error) { setError(res.error); return }
        prestationId = editing.id
      } else {
        const res = await createPrestationType(headerPayload)
        if (res.error || !res.id) { setError(res.error ?? 'Erreur inconnue'); return }
        prestationId = res.id
      }

      let position = 0
      const itemsPayload = sections.flatMap(section =>
        section.items.map(item => {
          const isEquipment = item.item_type === 'equipment'
          const equipmentMeta = isEquipment ? parseEquipmentAmortizationLabel(item.designation) : null
          const unitCost = parseFloat(item.unit_cost_ht) || 0
          const designation = isEquipment && equipmentMeta?.purchasePrice && equipmentMeta.lifetimeUses
            ? buildEquipmentAmortizationLabel(equipmentMeta.name, equipmentMeta.purchasePrice, equipmentMeta.lifetimeUses)
            : item.designation.trim() || '-'

          return {
            position: position++,
            section_title: section.title.trim(),
            item_type: item.item_type,
            material_id: item.material_id,
            labor_rate_id: item.labor_rate_id,
            designation,
            quantity: isEquipment ? 1 : parseFloat(item.quantity) || 1,
            unit: isEquipment ? 'usage' : item.unit || 'u',
            unit_price_ht: isEquipment ? 0 : parseFloat(item.unit_price_ht) || 0,
            unit_cost_ht: unitCost,
            is_internal: isEquipment ? true : item.is_internal,
            save_to_catalog: item.save_to_catalog,
          }
        })
      )

      const res = await setPrestationTypeItems(prestationId, itemsPayload)
      if (res.error) { setError(res.error); return }

      if (res.prestation) onSaved(res.prestation)
      onClose()
    })
  }

  if (!isOpen) return null

  const setF = (k: keyof PrestationHeaderForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }))

  return (
    <div className="modal-overlay">
      <div className="rounded-3xl card dark:bg-[#111118] w-full max-w-5xl max-h-[92vh] flex flex-col relative animate-in fade-in zoom-in duration-300">
        {/* Header */}
        <div className="flex items-center justify-between px-8 pt-8 pb-4 shrink-0">
          <h2 className="text-2xl font-bold text-primary">
            {editing ? `Modifier ${catalogContext.labelSet.bundleTemplate.singular.toLowerCase()}` : catalogContext.labelSet.bundleTemplate.createLabel}
          </h2>
          <button onClick={onClose} className="text-secondary hover:text-primary transition-colors"><X className="w-6 h-6" /></button>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1 px-8 pb-4 space-y-6">
          {error && (
            <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-red-500/10 border border-red-500/25">
              <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}

          {/* Infos générales */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 space-y-1.5">
              <label className="text-sm font-semibold text-secondary">Nom *</label>
              <input type="text" value={form.name} onChange={setF('name')} placeholder="ex: Pose bardage acier" className={inputCls} />
            </div>
            <div className="md:col-span-3 space-y-1.5">
              <label className="text-sm font-semibold text-secondary">Description</label>
              <textarea value={form.description} onChange={setF('description')} rows={2} placeholder="Détails optionnels..." className={`${inputCls} resize-none`} />
            </div>
            <div className="md:col-span-3 rounded-2xl border border-[var(--elevation-border)] bg-base/30 px-4 py-3">
              <p className="text-xs text-secondary">{getCatalogLabelsForProfile(catalogContext).forfaitHelp}</p>
            </div>
          </div>

          {/* Sections */}
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-secondary uppercase tracking-wider">Composition</h3>

            {sections.map((section, sIdx) => (
              <div key={section.tempId} className="rounded-2xl border border-[var(--elevation-border)] overflow-hidden">
                {/* Section header */}
                <div className="flex items-center gap-3 px-4 py-3 bg-base/30 border-b border-[var(--elevation-border)]">
                  <input
                    type="text"
                    value={section.title}
                    onChange={e => patchSectionTitle(section.tempId, e.target.value)}
                    placeholder={sections.length === 1 ? 'Titre de section (optionnel)' : `Section ${sIdx + 1}`}
                    className="flex-1 px-3 py-1.5 bg-transparent border border-transparent focus:border-accent rounded-lg text-sm font-semibold text-primary outline-none placeholder:font-normal placeholder:text-secondary/50"
                  />
                  {/* Add item buttons */}
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                    {(['service', 'labor', 'material', 'transport', 'equipment', 'free'] as PrestationItemType[]).map(type => {
                      const cfg = ITEM_TYPE_CONFIG[type]
                      const Icon = type === 'service' ? Package : type === 'labor' ? Wrench : type === 'material' ? Tag : type === 'transport' ? Truck : type === 'equipment' ? Cog : Plus
                      return (
                        <button key={type} type="button" onClick={() => addItemToSection(section.tempId, type)} className={`shrink-0 whitespace-nowrap px-2.5 py-1 rounded-lg text-xs font-bold border flex items-center gap-1 hover:scale-105 transition-all ${cfg.color}`}>
                          <Icon className="w-3 h-3" />{catalogContext.bundleTemplateUi.lineTypeLabels[type]}
                        </button>
                      )
                    })}
                  </div>
                  {sections.length > 1 && (
                    <button type="button" onClick={() => removeSection(section.tempId)} title="Supprimer la section" className="ml-1 text-secondary hover:text-red-400 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {section.items.length === 0 ? (
                  <div className="py-8 flex flex-col items-center gap-2 text-secondary">
                    <Layers className="w-6 h-6 opacity-30" />
                    <p className="text-xs">Ajoutez des lignes via les boutons ci-dessus.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-base/20">
                          <th className="px-3 py-2 text-xs font-bold text-secondary uppercase tracking-wider text-left w-20 whitespace-nowrap">Type</th>
                          <th className="px-3 py-2 text-xs font-bold text-secondary uppercase tracking-wider text-left whitespace-nowrap">Désignation</th>
                          <th className="px-3 py-2 text-xs font-bold text-secondary uppercase tracking-wider text-right w-16 whitespace-nowrap">Qté</th>
                          <th className="px-3 py-2 text-xs font-bold text-secondary uppercase tracking-wider w-20 whitespace-nowrap">Unité</th>
                          <th className="px-3 py-2 text-xs font-bold text-secondary uppercase tracking-wider text-right w-24 whitespace-nowrap">PU HT</th>
                          <th className="px-3 py-2 text-xs font-bold text-secondary uppercase tracking-wider text-right w-24 whitespace-nowrap">CR HT</th>
                          <th className="px-3 py-2 text-xs font-bold text-secondary uppercase tracking-wider text-center w-12" title="Interne (caché du devis client) whitespace-nowrap">Int.</th>
                          <th className="w-10 px-2" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--elevation-border)]">
                        {section.items.map(item => (
                          <ItemRow
                            key={item.tempId}
                            item={item}
                            sectionTempId={section.tempId}
                            materials={materials}
                            laborRates={laborRates}
                            lineTypeLabels={catalogContext.bundleTemplateUi.lineTypeLabels}
                            serviceItemPlaceholder={serviceItemPlaceholder}
                            materialItemPlaceholder={materialItemPlaceholder}
                            onPatch={patchItemInSection}
                            onRemove={removeItemFromSection}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}

            {/* Add section button */}
            <button
              type="button"
              onClick={addSection}
              className="flex items-center gap-2 text-sm text-secondary hover:text-accent transition-colors font-semibold"
            >
              <Plus className="w-4 h-4" />
              Ajouter une section
            </button>

            {/* Légende interne */}
            {allItems.some(i => i.is_internal) && (
              <p className="text-xs text-secondary flex items-center gap-1.5">
                <EyeOff className="w-3 h-3" />
                {catalogContext.bundleTemplateUi.internalLineHelp}
              </p>
            )}
          </div>
        </div>

        {/* Footer sticky */}
        <div className="shrink-0 px-8 py-5 border-t border-[var(--elevation-border)] flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <div className="text-center">
              <p className="text-xs text-secondary">Prix client HT</p>
              <p className="text-sm font-bold text-primary tabular-nums">{formatCurrency(totalPriceHt)}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-secondary">Coût de revient</p>
              <p className="text-sm font-bold text-secondary tabular-nums">{formatCurrency(totalCostHt)}</p>
            </div>
            {computedMargin !== null && (
              <div className="px-3 py-1 rounded-lg bg-accent/10 border border-accent/20">
                <p className="text-xs text-accent font-bold">Marge {computedMargin} %</p>
              </div>
            )}
            {editing && (
              <label className="flex items-center gap-2 cursor-pointer ml-2">
                <button type="button" onClick={() => setForm(p => ({ ...p, is_active: !p.is_active }))} className="text-secondary hover:text-primary transition-colors">
                  {form.is_active ? <ToggleRight className="w-7 h-7 text-accent" /> : <ToggleLeft className="w-7 h-7" />}
                </button>
                <span className="text-xs font-semibold text-secondary">{form.is_active ? 'Active' : 'Inactive'}</span>
              </label>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={onClose} className="px-6 py-2.5 rounded-full text-secondary hover:text-primary font-semibold transition-colors">Annuler</button>
            <ActionButton
              type="button"
              onClick={handleSubmit}
              loading={isPending}
              className="px-8 py-2.5 rounded-full bg-accent text-black font-bold hover:scale-105 transition-all shadow-lg shadow-accent/20 flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
            >
              {editing ? 'Mettre à jour' : catalogContext.labelSet.bundleTemplate.createLabel}
            </ActionButton>
          </div>
        </div>
      </div>
    </div>
  )
}

const PRESTATION_HEADERS_FIELDS = [
  { key: 'template_ref', label: 'Référence (template_ref)', required: true },
  { key: 'name', label: 'Nom du modèle', required: true },
  { key: 'description', label: 'Description' },
  { key: 'unit', label: 'Unité (forfait, m², h…)' },
  { key: 'category', label: 'Catégorie' },
  { key: 'base_price_ht', label: 'Prix de vente HT (€)' },
  { key: 'base_cost_ht', label: 'Coût de revient HT (€)' },
  { key: 'vat_rate', label: 'TVA (%) - ex : 20, 10' },
]

const PRESTATION_LINES_FIELDS = [
  { key: 'template_ref', label: 'Référence modèle (template_ref)', required: true },
  { key: 'position', label: 'Position (ordre)' },
  { key: 'item_type', label: 'Type (service, material, labor, transport, free)' },
  { key: 'designation', label: 'Désignation', required: true },
  { key: 'quantity', label: 'Quantité' },
  { key: 'unit', label: 'Unité' },
  { key: 'unit_price_ht', label: 'Prix unitaire HT (€)' },
  { key: 'unit_cost_ht', label: 'Coût unitaire HT (€)' },
]

const PRESTATION_HEADERS_EXAMPLE = ['POSE-CARRELAGE', 'Pose carrelage sol', 'Fourniture et pose carrelage avec joint', 'm²', 'Carrelage sol', '85', '55', '10']
const PRESTATION_LINES_EXAMPLE = ['POSE-CARRELAGE', '1', 'material', 'Carrelage grès cérame 60x60', '1', 'm²', '25', '18']

const initImportPrestationsState: ImportCatalogState = { error: null, imported: 0, skipped: 0, skipped_reasons: [] }
const initImportSuppliersState: ImportSuppliersState = { error: null, imported: 0, skipped: 0, skipped_reasons: [] }

export function ImportPrestationsModal({ isOpen, onClose, onSuccess, bundleTemplateLabel = 'modèle de devis', bundleTemplatePluralLabel }: { isOpen: boolean; bundleTemplatePluralLabel?: string; onClose: () => void; onSuccess: () => void; bundleTemplateLabel?: string }) {
  const [step, setStep] = React.useState<1 | 2 | 3>(1)
  const [headersFile, setHeadersFile] = useState<File | null>(null)
  const [linesFile, setLinesFile] = useState<File | null>(null)
  const [headersCount, setHeadersCount] = useState<number | null>(null)
  const [linesCount, setLinesCount] = useState<number | null>(null)
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportCatalogState | null>(null)
  const [isPending, startTransition] = React.useTransition()

  const label = bundleTemplateLabel.charAt(0).toUpperCase() + bundleTemplateLabel.slice(1)
  const plural = bundleTemplatePluralLabel ?? `${bundleTemplateLabel}s`

  function handleClose() {
    setStep(1); setHeadersFile(null); setLinesFile(null)
    setHeadersCount(null); setLinesCount(null)
    setParsing(false); setParseError(null); setResult(null)
    onClose()
  }

  async function handleHeadersChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    setHeadersFile(file)
    setParseError(null)
    if (!file) { setHeadersCount(null); return }
    try {
      const { dataRows } = await parseFileToRows(file)
      setHeadersCount(dataRows.length)
    } catch { setParseError('Impossible de lire le fichier modèles.') }
    e.target.value = ''
  }

  async function handleLinesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    setLinesFile(file)
    if (!file) { setLinesCount(null); return }
    try {
      const { dataRows } = await parseFileToRows(file)
      setLinesCount(dataRows.length)
    } catch { /* ignore */ }
    e.target.value = ''
  }

  async function handleImport() {
    if (!headersFile) return
    setParsing(true)
    setParseError(null)
    try {
      const xlsx = await import('xlsx')
      async function parseXlsx(file: File): Promise<Record<string, string>[]> {
        const buf = await file.arrayBuffer()
        const wb = xlsx.read(buf, { type: 'array' })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        return xlsx.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '' })
      }
      const headers = await parseXlsx(headersFile)
      const lines = linesFile ? await parseXlsx(linesFile) : []
      const fd = new FormData()
      fd.append('headers_json', JSON.stringify(headers))
      fd.append('lines_json', JSON.stringify(lines))
      startTransition(async () => {
        const res = await importPrestationTypes(initImportPrestationsState, fd)
        setResult(res)
        if (!res.error) { setStep(3); onSuccess(); setTimeout(handleClose, 2500) }
      })
    } catch {
      setParseError('Erreur lors de la lecture des fichiers.')
    } finally {
      setParsing(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="modal-overlay">
      <div className="modal-panel animate-in fade-in duration-300">
        <button onClick={handleClose} className="absolute top-6 right-6 text-secondary hover:text-primary transition-colors"><X className="w-6 h-6" /></button>
        <h2 className="text-2xl font-bold text-primary mb-2">Importer des {plural}</h2>

        {/* Stepper */}
        <div className="flex items-center gap-2 mb-8">
          {[{ n: 1, label: 'Fichiers' }, { n: 2, label: 'Aperçu' }, { n: 3, label: 'Import' }].map(({ n, label: l }, i) => (
            <React.Fragment key={n}>
              {i > 0 && <div className={`h-px flex-1 ${step > i ? 'bg-accent' : 'bg-[var(--elevation-border)]'}`} />}
              <div className={`flex items-center gap-1.5 ${step >= n ? 'text-accent' : 'text-secondary'}`}>
                <div className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center border-2 ${step > n ? 'bg-accent border-accent text-black' : step === n ? 'border-accent text-accent' : 'border-[var(--elevation-border)] text-secondary'}`}>
                  {step > n ? '✓' : n}
                </div>
                <span className="text-xs font-semibold hidden sm:inline">{l}</span>
              </div>
            </React.Fragment>
          ))}
        </div>

        {/* Étape 1 : sélection des fichiers */}
        {step === 1 && (
          <div className="flex flex-col gap-6">
            <p className="text-sm text-secondary">
              L&apos;import utilise <strong className="text-primary">deux fichiers liés</strong> par la colonne <code className="bg-base px-1 rounded text-xs">template_ref</code>. Téléchargez les templates pour voir le format attendu.
            </p>

            {/* Fichier modèles */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold text-primary">Fichier {plural} <span className="text-red-500">*</span></label>
                <button
                  type="button"
                  onClick={() => downloadCSVTemplate(PRESTATION_HEADERS_FIELDS, 'template_modeles_devis.csv', PRESTATION_HEADERS_EXAMPLE)}
                  className="flex items-center gap-1 text-xs text-accent hover:underline"
                >
                  <Download className="w-3 h-3" />Template CSV
                </button>
              </div>
              <p className="text-xs text-secondary">Colonnes : {PRESTATION_HEADERS_FIELDS.map(f => f.key).join(', ')}</p>
              <label className="flex items-center justify-center gap-2 p-4 rounded-xl border-2 border-dashed border-[var(--elevation-border)] hover:border-accent/50 hover:bg-accent/5 transition-colors cursor-pointer text-sm text-secondary">
                <FileUp className="w-4 h-4 flex-shrink-0" />
                {headersFile ? (
                  <span className="text-primary font-medium truncate max-w-xs">{headersFile.name}{headersCount != null ? ` (${headersCount} ligne${headersCount > 1 ? 's' : ''})` : ''}</span>
                ) : 'Choisir le fichier CSV ou Excel'}
                <input type="file" accept=".csv,.xlsx,.xls" onChange={handleHeadersChange} className="sr-only" />
              </label>
            </div>

            {/* Fichier lignes */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold text-primary">Fichier lignes <span className="text-secondary font-normal">(optionnel)</span></label>
                <button
                  type="button"
                  onClick={() => downloadCSVTemplate(PRESTATION_LINES_FIELDS, 'template_lignes_devis.csv', PRESTATION_LINES_EXAMPLE)}
                  className="flex items-center gap-1 text-xs text-accent hover:underline"
                >
                  <Download className="w-3 h-3" />Template CSV
                </button>
              </div>
              <p className="text-xs text-secondary">Colonnes : {PRESTATION_LINES_FIELDS.map(f => f.key).join(', ')}</p>
              <label className="flex items-center justify-center gap-2 p-4 rounded-xl border-2 border-dashed border-[var(--elevation-border)] hover:border-accent/50 hover:bg-accent/5 transition-colors cursor-pointer text-sm text-secondary">
                <FileUp className="w-4 h-4 flex-shrink-0" />
                {linesFile ? (
                  <span className="text-primary font-medium truncate max-w-xs">{linesFile.name}{linesCount != null ? ` (${linesCount} ligne${linesCount > 1 ? 's' : ''})` : ''}</span>
                ) : 'Choisir le fichier CSV ou Excel'}
                <input type="file" accept=".csv,.xlsx,.xls" onChange={handleLinesChange} className="sr-only" />
              </label>
            </div>

            {parseError && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-600 dark:text-red-400">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />{parseError}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button onClick={handleClose} className="px-6 py-2.5 rounded-full text-secondary hover:text-primary font-semibold transition-colors">Annuler</button>
              <button
                onClick={() => setStep(2)}
                disabled={!headersFile}
                className="px-8 py-2.5 rounded-full bg-accent text-black font-bold hover:scale-105 transition-all shadow-lg shadow-accent/20 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
              >
                Suivant
              </button>
            </div>
          </div>
        )}

        {/* Étape 2 : aperçu */}
        {step === 2 && (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2 p-4 rounded-xl bg-base border border-[var(--elevation-border)] text-sm">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                <span className="text-primary font-medium">{headersCount ?? '?'} {bundleTemplateLabel}{(headersCount ?? 0) > 1 ? 's' : ''} à importer</span>
              </div>
              {linesFile && (
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                  <span className="text-primary font-medium">{linesCount ?? '?'} ligne{(linesCount ?? 0) > 1 ? 's' : ''} de détail associées</span>
                </div>
              )}
              {!linesFile && (
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-secondary flex-shrink-0" />
                  <span className="text-secondary">Pas de fichier lignes : les modèles seront créés sans lignes de détail</span>
                </div>
              )}
            </div>

            {result?.error && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-600 dark:text-red-400">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />{result.error}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button onClick={() => setStep(1)} className="px-6 py-2.5 rounded-full text-secondary hover:text-primary font-semibold transition-colors">Retour</button>
              <ActionButton
                onClick={handleImport}
                loading={parsing || isPending}
                className="px-8 py-2.5 rounded-full bg-accent text-black font-bold hover:scale-105 transition-all shadow-lg shadow-accent/20 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center gap-2"
              >
                Importer
              </ActionButton>
            </div>
          </div>
        )}

        {/* Étape 3 : succès */}
        {step === 3 && result && (
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="w-14 h-14 rounded-full flex items-center justify-center">
              <CheckCircle2 className="w-7 h-7 text-green-500" />
            </div>
            <p className="font-bold text-primary text-center">
              {result.imported} {bundleTemplateLabel}{result.imported > 1 ? 's' : ''} importé{result.imported > 1 ? 's' : ''}
              {result.skipped > 0 ? `, ${result.skipped} ignoré${result.skipped > 1 ? 's' : ''}` : ''}.
            </p>
            {result.skipped_reasons.length > 0 && (
              <ul className="text-xs text-secondary space-y-0.5 w-full max-h-32 overflow-y-auto">
                {result.skipped_reasons.map((r, i) => <li key={i} className="flex items-start gap-1"><AlertTriangle className="w-3 h-3 text-orange-400 flex-shrink-0 mt-0.5" />{r}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

