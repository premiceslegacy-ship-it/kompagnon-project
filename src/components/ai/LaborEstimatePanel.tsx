'use client'
// @atelier-migrated

import { useState } from 'react'
import type { CatalogLaborRate } from '@/lib/data/queries/catalog'
import type { LaborEstimateItem } from '@/app/api/ai/estimate-labor/route'
import { createLaborRateQuick } from '@/lib/data/mutations/catalog'
import { getInternalResourceUnitCost } from '@/lib/catalog-ui'
import { AI_NAME } from '@/lib/brand'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { CheckRow, ListGroup, ListRow } from '@/components/ui/ListGroup'
import { SearchField } from '@/components/ui/SearchField'
import { Sheet } from '@/components/ui/Sheet'
import styles from '@/app/(app)/finances/quote-editor/QuoteEditor.module.css'

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
  const totalEstimate = estimates ? estimates.reduce((sum, e) => sum + e.quantity * e.unit_price, 0) : 0

  return (
    <Sheet
      open
      onOpenChange={open => { if (!open) onClose() }}
      title={`${AI_NAME}, main-d’œuvre`}
      description="Estimation des heures à partir des ressources internes du catalogue."
      cancelLabel="Fermer"
      onConfirm={handleInsert}
      confirmLabel="Insérer dans le devis"
      confirmDisabled={!hasContent}
    >
      <div className={styles.detail}>
        <div className={styles.fields}>
          <Field
            type="textarea"
            label="Description du chantier"
            hint={`${AI_NAME} estime les heures d’après les travaux décrits.`}
            rows={3}
            value={description}
            onChange={e => { setDescription(e.target.value); setEstimates(null) }}
          />
        </div>

        {laborRates.length === 0 ? (
          <p className={styles.hint} style={{ marginTop: 0 }}>
            Aucune ressource interne dans le catalogue. Ajoutez un profil libre ci-dessous.
          </p>
        ) : (
          <>
            <SearchField label="Rechercher une ressource" placeholder="Rechercher" value={search} onChange={setSearch} />
            <ListGroup title="Ressources internes">
              {filtered.map(lr => (
                <CheckRow
                  key={lr.id}
                  title={lr.designation}
                  description={`${fmt(getInternalResourceUnitCost(lr))} / ${lr.unit ?? 'h'}`}
                  checked={selectedIds.has(lr.id)}
                  onCheckedChange={checked => {
                    setSelectedIds(prev => {
                      const next = new Set(prev)
                      if (checked) next.add(lr.id)
                      else next.delete(lr.id)
                      return next
                    })
                    setEstimates(null)
                  }}
                />
              ))}
            </ListGroup>
          </>
        )}

        {customProfiles.length > 0 && (
          <ListGroup title="Profils libres">
            {customProfiles.map(cp => (
              <ListRow
                key={cp._id}
                title={cp.designation}
                description={`${fmt(cp.rate)} / ${cp.unit}${cp.savedId ? ' · enregistré au catalogue' : ''}`}
                trailing={
                  <span className={styles.inline}>
                    {!cp.savedId && (
                      <Button variant="text" size="sm" onClick={() => handleSaveToCatalog(cp._id)} loading={savingId === cp._id}>
                        Au catalogue
                      </Button>
                    )}
                    <Button variant="text" size="sm" onClick={() => { setCustomProfiles(prev => prev.filter(p => p._id !== cp._id)); setEstimates(null) }}>
                      Retirer
                    </Button>
                  </span>
                }
              />
            ))}
          </ListGroup>
        )}

        {showCustomForm ? (
          <>
            <div className={styles.fields}>
              <Field type="text" label="Désignation" placeholder="Charpentier" value={customDesignation} onChange={e => setCustomDesignation(e.target.value)} />
              <Field type="text" inputMode="decimal" label="Taux (€)" value={customRate} onChange={e => setCustomRate(e.target.value)} />
              <Field type="select" label="Unité" value={customUnit} onChange={e => setCustomUnit(e.target.value)}>
                <option value="h">h</option>
                <option value="j">j</option>
                <option value="sem">sem</option>
                <option value="u">u</option>
                <option value="forfait">forfait</option>
              </Field>
            </div>
            <div className={styles.inline}>
              <Button variant="secondary" size="md" onClick={handleAddCustom} disabled={!customDesignation.trim() || !customRate}>Ajouter ce profil</Button>
              <Button variant="text" size="md" onClick={() => { setShowCustomForm(false); setCustomDesignation(''); setCustomRate('') }}>Annuler</Button>
            </div>
          </>
        ) : (
          <div className={styles.inline}>
            <Button variant="secondary" size="md" onClick={() => setShowCustomForm(true)}>Ajouter un profil libre</Button>
          </div>
        )}

        <div className={styles.inline}>
          <Button
            variant="secondary"
            size="md"
            onClick={handleEstimate}
            loading={aiLoading}
            loadingText={`${AI_NAME} calcule…`}
            disabled={profiles.length === 0 || !description.trim()}
          >
            {`Demander à ${AI_NAME}`}
          </Button>
        </div>
        {aiError && <p className={`${styles.hint} ${styles.warn}`} role="alert" style={{ marginTop: 0 }}>{aiError}</p>}

        {estimates && (
          <>
            <p className={styles.hint} style={{ marginTop: 0 }}>Estimation de {AI_NAME} : ajustez les quantités si besoin.</p>
            <div className={styles.fields}>
              {estimates.map((est, i) => (
                <Field
                  key={i}
                  type="number"
                  label={est.designation}
                  hint={`${est.unit} · ${fmt(est.quantity * est.unit_price)}`}
                  min={0}
                  decimals={1}
                  allowEmpty={false}
                  value={est.quantity}
                  onChange={v => setEstimates(prev => prev?.map((r, j) => (j === i ? { ...r, quantity: v ?? 0 } : r)) ?? null)}
                />
              ))}
            </div>
            <ListGroup>
              <ListRow title="Total main-d’œuvre" trailing={<span className={styles.fieldValue}>{fmt(totalEstimate)}</span>} />
            </ListGroup>
          </>
        )}

        <div className={styles.detail}>
          <p className={styles.hint} style={{ marginTop: 0 }}><strong>Transport</strong> (facultatif)</p>
          <div className={styles.fields}>
            <Field type="text" inputMode="decimal" label="Distance (km)" value={transportKm} onChange={e => setTransportKm(e.target.value)} />
            <Field type="text" inputMode="decimal" label="Consommation (L / 100 km)" placeholder="8" value={transportL100} onChange={e => setTransportL100(e.target.value)} />
            <Field type="text" inputMode="decimal" label="Prix du litre (€)" placeholder="1,80" value={transportFuelPrice} onChange={e => setTransportFuelPrice(e.target.value)} />
          </div>
          {transportCost > 0 && (
            <ListGroup>
              <ListRow title="Coût du transport" trailing={<span className={styles.fieldValue}>{fmt(transportCost)}</span>} />
            </ListGroup>
          )}
        </div>
      </div>
    </Sheet>
  )
}
