'use client'

import { useState } from 'react'
import type { CatalogLaborRate } from '@/lib/data/queries/catalog'
import type { LaborEstimateItem } from '@/app/api/ai/estimate-labor/route'
import { createLaborRateQuick } from '@/lib/data/mutations/catalog'
import { X, Sparkles, Loader2, Plus, Save, Car, CheckCircle2, Search, Trash2 } from 'lucide-react'
import { getInternalResourceUnitCost } from '@/lib/catalog-ui'

const fmt = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n)

export type MOInsertItem = {
  designation: string
  quantity: number
  unit: string
  unit_price: number
  labor_rate_id: string | null
}

type CustomProfile = {
  _id: string
  designation: string
  rate: number
  unit: string
  savedId: string | null
}

type EstimateResult = {
  labor_rate_id: string | null
  designation: string
  quantity: number
  unit: string
  unit_price: number
}

type Props = {
  laborRates: CatalogLaborRate[]
  quoteTitle: string
  onInsert: (items: MOInsertItem[]) => void
  onClose: () => void
}

export default function LaborEstimatePanel({ laborRates, quoteTitle, onInsert, onClose }: Props) {
  const [description, setDescription] = useState(quoteTitle)
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Free entry
  const [showCustomForm, setShowCustomForm] = useState(false)
  const [customDesignation, setCustomDesignation] = useState('')
  const [customRate, setCustomRate] = useState('')
  const [customUnit, setCustomUnit] = useState('h')
  const [customProfiles, setCustomProfiles] = useState<CustomProfile[]>([])
  const [savingId, setSavingId] = useState<string | null>(null)

  // AI estimate
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [estimates, setEstimates] = useState<EstimateResult[] | null>(null)

  // Transport
  const [transportKm, setTransportKm] = useState('')
  const [transportL100, setTransportL100] = useState('')
  const [transportFuelPrice, setTransportFuelPrice] = useState('')

  const transportCost = (() => {
    const km = parseFloat(transportKm) || 0
    const l100 = parseFloat(transportL100) || 0
    const price = parseFloat(transportFuelPrice) || 0
    if (!km || !l100 || !price) return 0
    return Math.round(km * l100 / 100 * price * 100) / 100
  })()

  const filtered = laborRates.filter(lr =>
    !search || lr.designation.toLowerCase().includes(search.toLowerCase()) ||
    (lr.category ?? '').toLowerCase().includes(search.toLowerCase())
  )

  function getAllProfiles() {
    const fromCatalog = laborRates
      .filter(lr => selectedIds.has(lr.id))
      .map(lr => ({
        labor_rate_id: lr.id,
        designation: lr.designation,
        rate: getInternalResourceUnitCost(lr),
        unit: lr.unit ?? 'h',
      }))
    const fromCustom = customProfiles.map(cp => ({
      labor_rate_id: cp.savedId,
      designation: cp.designation,
      rate: cp.rate,
      unit: cp.unit,
    }))
    return [...fromCatalog, ...fromCustom]
  }

  function handleAddCustom() {
    if (!customDesignation.trim() || !customRate) return
    setCustomProfiles(prev => [...prev, {
      _id: `custom_${Date.now()}`,
      designation: customDesignation.trim(),
      rate: parseFloat(customRate),
      unit: customUnit,
      savedId: null,
    }])
    setCustomDesignation('')
    setCustomRate('')
    setCustomUnit('h')
    setShowCustomForm(false)
    setEstimates(null)
  }

  async function handleSaveToCatalog(id: string) {
    const profile = customProfiles.find(p => p._id === id)
    if (!profile) return
    setSavingId(id)
    const result = await createLaborRateQuick({
      designation: profile.designation,
      rate: profile.rate,
      unit: profile.unit,
    })
    setSavingId(null)
    if (!result.error && result.laborRate) {
      setCustomProfiles(prev => prev.map(p =>
        p._id === id ? { ...p, savedId: result.laborRate!.id } : p
      ))
    }
  }

  async function handleEstimate() {
    const profiles = getAllProfiles()
    if (!description.trim() || profiles.length === 0) {
      setAiError('Renseignez la description et sélectionnez au moins un profil.')
      return
    }
    setAiLoading(true)
    setAiError(null)
    setEstimates(null)

    try {
      const res = await fetch('/api/ai/estimate-labor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: description.trim(),
          profiles,
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setAiError(data.error ?? "Erreur lors de l'estimation")
        return
      }
      const estResults: EstimateResult[] = (data as LaborEstimateItem[]).map(item => {
        const profile = profiles.find(
          p => p.designation === item.designation || p.labor_rate_id === item.labor_rate_id
        )
        return {
          labor_rate_id: item.labor_rate_id,
          designation: item.designation,
          quantity: item.quantity,
          unit: item.unit || profile?.unit || 'h',
          unit_price: profile?.rate ?? 0,
        }
      })
      setEstimates(estResults)
    } catch {
      setAiError('Erreur réseau. Vérifiez votre connexion.')
    } finally {
      setAiLoading(false)
    }
  }

  function handleInsert() {
    const items: MOInsertItem[] = []

    if (estimates) {
      for (const est of estimates) {
        if (est.quantity > 0) {
          items.push({
            designation: est.designation,
            quantity: est.quantity,
            unit: est.unit,
            unit_price: est.unit_price,
            labor_rate_id: est.labor_rate_id,
          })
        }
      }
    } else {
      for (const p of getAllProfiles()) {
        items.push({
          designation: p.designation,
          quantity: 1,
          unit: p.unit,
          unit_price: p.rate,
          labor_rate_id: p.labor_rate_id,
        })
      }
    }

    if (transportCost > 0) {
      items.push({
        designation: `Transport${transportKm ? ` (${transportKm} km)` : ''}`,
        quantity: 1,
        unit: 'forfait',
        unit_price: transportCost,
        labor_rate_id: null,
      })
    }

    onInsert(items)
  }

  const profiles = getAllProfiles()
  const hasContent = profiles.length > 0 || transportCost > 0

  return (
    <div className="fixed inset-0 z-[100] flex justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-[440px] bg-surface dark:bg-[#111] dark:border-l dark:border-[var(--elevation-border)] h-full overflow-hidden flex flex-col shadow-2xl">

        {/* Header */}
        <div className="border-b border-[var(--elevation-border)] px-6 py-5 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-primary">Estimer la main d&apos;œuvre</h2>
              <p className="text-xs text-secondary">IA + ressources internes</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-secondary hover:text-primary rounded-full hover:bg-base transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* Description */}
          <div>
            <label className="text-sm font-semibold text-secondary block mb-2">Description du chantier</label>
            <textarea
              value={description}
              onChange={e => { setDescription(e.target.value); setEstimates(null) }}
              rows={3}
              placeholder="Décrivez les travaux pour que l'IA estime les heures..."
              className="w-full p-3 rounded-xl bg-base border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none"
            />
          </div>

          {/* Catalog selection */}
          <div>
            <h3 className="text-sm font-semibold text-secondary mb-3">Ressources internes</h3>
            {laborRates.length === 0 ? (
              <p className="text-sm text-secondary py-4 text-center bg-base/50 rounded-xl">
                Aucune ressource interne dans le catalogue —{' '}
                <button onClick={() => setShowCustomForm(true)} className="text-accent hover:underline">ajouter un profil libre</button>
              </p>
            ) : (
              <>
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-secondary" />
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Rechercher..."
                    className="w-full pl-9 pr-3 py-2 rounded-xl bg-base border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                  />
                </div>
                <div className="space-y-0.5 max-h-48 overflow-y-auto pr-1">
                  {filtered.map(lr => (
                    <label key={lr.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-base/60 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(lr.id)}
                        onChange={e => {
                          setSelectedIds(prev => {
                            const s = new Set(prev)
                            e.target.checked ? s.add(lr.id) : s.delete(lr.id)
                            return s
                          })
                          setEstimates(null)
                        }}
                        className="w-4 h-4 rounded"
                      />
                      <span className="flex-1 text-sm text-primary truncate">{lr.designation}</span>
                      <span className="text-xs text-secondary tabular-nums flex-shrink-0">
                        {fmt(getInternalResourceUnitCost(lr))}/{lr.unit ?? 'h'}
                      </span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Custom profiles list */}
          {customProfiles.length > 0 && (
            <div className="space-y-1.5">
              {customProfiles.map(cp => (
                <div key={cp._id} className="flex items-center gap-2 p-3 rounded-xl bg-violet-500/5 border border-violet-500/20">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-primary truncate">{cp.designation}</p>
                    <p className="text-xs text-secondary tabular-nums">{fmt(cp.rate)}/{cp.unit}</p>
                  </div>
                  {cp.savedId ? (
                    <span className="text-xs text-emerald-500 flex items-center gap-1 flex-shrink-0">
                      <CheckCircle2 className="w-3 h-3" />Enregistré
                    </span>
                  ) : (
                    <button
                      onClick={() => handleSaveToCatalog(cp._id)}
                      disabled={savingId === cp._id}
                      className="text-xs text-violet-500 hover:text-violet-600 flex items-center gap-1 flex-shrink-0 disabled:opacity-50"
                    >
                      {savingId === cp._id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                      Catalogue
                    </button>
                  )}
                  <button
                    onClick={() => { setCustomProfiles(prev => prev.filter(p => p._id !== cp._id)); setEstimates(null) }}
                    className="p-1 text-secondary hover:text-red-500 flex-shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add custom profile form */}
          {showCustomForm ? (
            <div className="rounded-xl border border-[var(--elevation-border)] p-4 space-y-3 bg-base/50">
              <p className="text-sm font-semibold text-primary">Profil libre</p>
              <input
                type="text"
                value={customDesignation}
                onChange={e => setCustomDesignation(e.target.value)}
                placeholder="Désignation (ex: Charpentier)"
                className="w-full p-2.5 rounded-xl bg-base border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
              <div className="flex gap-2">
                <input
                  type="number"
                  value={customRate}
                  onChange={e => setCustomRate(e.target.value)}
                  placeholder="Taux (€)"
                  min={0}
                  className="flex-1 p-2.5 rounded-xl bg-base border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                />
                <select
                  value={customUnit}
                  onChange={e => setCustomUnit(e.target.value)}
                  className="w-24 p-2.5 rounded-xl bg-base border border-[var(--elevation-border)] text-primary text-sm focus:outline-none"
                >
                  <option value="h">h</option>
                  <option value="j">j</option>
                  <option value="sem">sem</option>
                  <option value="u">u</option>
                  <option value="forfait">forfait</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleAddCustom}
                  disabled={!customDesignation.trim() || !customRate}
                  className="flex-1 py-2 rounded-xl bg-accent text-black text-sm font-semibold disabled:opacity-50"
                >
                  Ajouter
                </button>
                <button
                  onClick={() => { setShowCustomForm(false); setCustomDesignation(''); setCustomRate('') }}
                  className="px-4 py-2 rounded-xl text-secondary hover:text-primary text-sm"
                >
                  Annuler
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowCustomForm(true)}
              className="flex items-center gap-2 text-sm text-secondary hover:text-accent transition-colors"
            >
              <Plus className="w-4 h-4" />Ajouter un profil libre
            </button>
          )}

          {/* AI Estimate button */}
          <button
            onClick={handleEstimate}
            disabled={aiLoading || profiles.length === 0 || !description.trim()}
            className="w-full py-3 rounded-2xl bg-gradient-to-r from-violet-500 to-indigo-600 text-white font-semibold flex items-center justify-center gap-2 hover:from-violet-600 hover:to-indigo-700 transition-all shadow-lg shadow-violet-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {aiLoading ? 'Estimation en cours...' : "Estimer avec l'IA"}
          </button>

          {aiError && <p className="text-sm text-red-400 text-center">{aiError}</p>}

          {/* AI Results */}
          {estimates && (
            <div className="rounded-2xl border border-[var(--elevation-border)] overflow-hidden">
              <div className="px-4 py-3 bg-base/50 border-b border-[var(--elevation-border)] flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-violet-500" />
                <span className="text-sm font-semibold text-primary">Résultats IA — ajustez si besoin</span>
              </div>
              <div className="divide-y divide-[var(--elevation-border)]">
                {estimates.map((est, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3">
                    <span className="flex-1 text-sm text-primary truncate">{est.designation}</span>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <input
                        type="number"
                        value={est.quantity}
                        min={0}
                        step={0.5}
                        onChange={e => setEstimates(prev =>
                          prev?.map((r, j) => j === i ? { ...r, quantity: Number(e.target.value) } : r) ?? null
                        )}
                        className="w-16 p-1.5 rounded-lg border border-[var(--elevation-border)] bg-base text-primary text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-accent/50"
                      />
                      <span className="text-xs text-secondary w-8">{est.unit}</span>
                    </div>
                    <span className="text-sm font-semibold text-primary tabular-nums w-20 text-right flex-shrink-0">
                      {fmt(est.quantity * est.unit_price)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="px-4 py-3 bg-base/50 border-t border-[var(--elevation-border)] flex justify-between">
                <span className="text-sm font-semibold text-secondary">Total MO</span>
                <span className="text-sm font-bold text-primary tabular-nums">
                  {fmt(estimates.reduce((s, e) => s + e.quantity * e.unit_price, 0))}
                </span>
              </div>
            </div>
          )}

          {/* Transport */}
          <div className="rounded-2xl border border-[var(--elevation-border)] overflow-hidden">
            <div className="px-4 py-3 bg-base/50 border-b border-[var(--elevation-border)] flex items-center gap-2">
              <Car className="w-4 h-4 text-secondary" />
              <span className="text-sm font-semibold text-primary">Transport (optionnel)</span>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-xs text-secondary block mb-1">Distance (km)</label>
                  <input
                    type="number"
                    value={transportKm}
                    onChange={e => setTransportKm(e.target.value)}
                    placeholder="0"
                    min={0}
                    className="w-full p-2 rounded-xl bg-base border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 tabular-nums"
                  />
                </div>
                <div>
                  <label className="text-xs text-secondary block mb-1">L/100 km</label>
                  <input
                    type="number"
                    value={transportL100}
                    onChange={e => setTransportL100(e.target.value)}
                    placeholder="8"
                    min={0}
                    step={0.1}
                    className="w-full p-2 rounded-xl bg-base border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 tabular-nums"
                  />
                </div>
                <div>
                  <label className="text-xs text-secondary block mb-1">Prix/L (€)</label>
                  <input
                    type="number"
                    value={transportFuelPrice}
                    onChange={e => setTransportFuelPrice(e.target.value)}
                    placeholder="1.80"
                    min={0}
                    step={0.01}
                    className="w-full p-2 rounded-xl bg-base border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 tabular-nums"
                  />
                </div>
              </div>
              {transportCost > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-secondary">Coût calculé</span>
                  <span className="text-sm font-bold text-primary tabular-nums">{fmt(transportCost)}</span>
                </div>
              )}
            </div>
          </div>

        </div>

        {/* Footer CTA */}
        <div className="border-t border-[var(--elevation-border)] p-5 flex-shrink-0">
          <button
            onClick={handleInsert}
            disabled={!hasContent}
            className="w-full py-3 rounded-2xl bg-accent text-black font-bold flex items-center justify-center gap-2 hover:scale-[1.01] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
          >
            <Plus className="w-4 h-4" />
            Insérer dans le devis
          </button>
        </div>

      </div>
    </div>
  )
}
