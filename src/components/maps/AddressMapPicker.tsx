'use client'
// @atelier-migrated

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useAddressAutocomplete, reverseGeocode, type AddressFeature } from '@/lib/hooks/useAddressAutocomplete'
import { Field } from '@/components/ui/Field'
import styles from './Maps.module.css'

const LeafletMap = dynamic(() => import('./LeafletMap'), {
  ssr: false,
  loading: () => <div className={styles.placeholder} role="status">Chargement de la carte…</div>,
})

export type AddressMapPickerValue = {
  address: string | null
  postalCode: string | null
  city: string | null
  latitude: number | null
  longitude: number | null
}

type AddressMapPickerProps = {
  value: AddressMapPickerValue
  onChange: (next: AddressMapPickerValue) => void
  helpText?: string
  className?: string
}

/** Recherche d'adresse avec suggestions, puis ajustement du repère sur la carte. */
export function AddressMapPicker({ value, onChange, helpText, className }: AddressMapPickerProps) {
  const [query, setQuery] = useState(value.address ?? '')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [isReversing, setIsReversing] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const { suggestions, isLoading } = useAddressAutocomplete(showSuggestions ? query : '')

  useEffect(() => {
    setQuery(value.address ?? '')
  }, [value.address])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function selectSuggestion(feature: AddressFeature) {
    setQuery(feature.label)
    setShowSuggestions(false)
    onChange({
      address: feature.label,
      postalCode: feature.postalCode,
      city: feature.city,
      latitude: feature.latitude,
      longitude: feature.longitude,
    })
  }

  async function handlePick(lat: number, lng: number) {
    onChange({ ...value, latitude: lat, longitude: lng })
    setIsReversing(true)
    const reversed = await reverseGeocode(lat, lng)
    setIsReversing(false)
    if (reversed) {
      setQuery(reversed.label)
      onChange({
        address: reversed.label,
        postalCode: reversed.postalCode,
        city: reversed.city,
        latitude: lat,
        longitude: lng,
      })
    }
  }

  const hasPoint = value.latitude != null && value.longitude != null

  return (
    <div className={className}>
      <div ref={containerRef} className={styles.search}>
        <Field
          type="text"
          label="Adresse"
          placeholder="15 avenue de l’Atelier, Lyon"
          autoComplete="off"
          loading={isLoading}
          value={query}
          onChange={e => { setQuery(e.target.value); setShowSuggestions(true) }}
          onFocus={() => setShowSuggestions(true)}
        />
        {showSuggestions && suggestions.length > 0 && (
          <ul className={styles.suggestions}>
            {suggestions.map((feature, i) => (
              <li key={i}>
                <button type="button" className={styles.suggestion} onClick={() => selectSuggestion(feature)}>
                  {feature.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className={styles.note}>
        {helpText ?? 'Touchez la carte ou glissez le repère pour ajuster précisément le point de départ.'}
      </p>
      <div className={`${styles.frame} ${styles.mapBox}`}>
        {hasPoint ? (
          <LeafletMap latitude={value.latitude!} longitude={value.longitude!} onPick={handlePick} />
        ) : (
          <div className={styles.placeholder}>
            Recherchez une adresse ci-dessus ou touchez la carte pour positionner le point de départ.
          </div>
        )}
      </div>
      {hasPoint && (
        <p className={styles.coords}>
          {isReversing ? 'Recherche de l’adresse…' : `${value.latitude!.toFixed(6)}, ${value.longitude!.toFixed(6)}`}
        </p>
      )}
    </div>
  )
}
