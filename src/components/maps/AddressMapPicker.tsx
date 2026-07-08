'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { MapPin, Loader2, Search } from 'lucide-react'
import { useAddressAutocomplete, reverseGeocode, type AddressFeature } from '@/lib/hooks/useAddressAutocomplete'

const LeafletMap = dynamic(() => import('./LeafletMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-interactive dark:bg-white/5">
      <Loader2 className="h-5 w-5 animate-spin text-secondary" />
    </div>
  ),
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

  return (
    <div className={className}>
      <div ref={containerRef} className="relative">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary" />
          <input
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setShowSuggestions(true) }}
            onFocus={() => setShowSuggestions(true)}
            placeholder="Rechercher une adresse (ex : 15 avenue de l'Atelier, Lyon)"
            className="w-full pl-9 pr-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all"
          />
          {isLoading && (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-secondary" />
          )}
        </div>

        {showSuggestions && suggestions.length > 0 && (
          <div className="menu-panel absolute z-[1100] mt-1.5 w-full max-h-64 overflow-y-auto">
            {suggestions.map((feature, i) => (
              <button
                key={i}
                type="button"
                onClick={() => selectSuggestion(feature)}
                className="flex w-full items-start gap-2 px-3.5 py-2.5 text-left text-sm text-primary hover:bg-interactive dark:hover:bg-white/5 transition-colors"
              >
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-secondary" />
                <span className="truncate">{feature.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <p className="mt-2 text-xs text-secondary">
        {helpText ?? 'Cliquez ou glissez le repère sur la carte pour ajuster précisément le point de départ.'}
      </p>

      <div className="relative mt-3 h-72 w-full overflow-hidden rounded-2xl border border-[var(--elevation-border)] shadow-kompagnon">
        {value.latitude != null && value.longitude != null ? (
          <LeafletMap latitude={value.latitude} longitude={value.longitude} onPick={handlePick} />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-interactive text-center dark:bg-white/5">
            <MapPin className="h-6 w-6 text-secondary" />
            <p className="max-w-xs text-sm text-secondary">
              Recherchez une adresse ci-dessus ou cliquez directement sur la carte pour positionner le point de départ.
            </p>
          </div>
        )}
      </div>

      {(value.latitude != null && value.longitude != null) && (
        <p className="mt-1.5 text-xs font-mono tabular-nums text-secondary">
          {isReversing ? 'Recherche de l\'adresse…' : `${value.latitude.toFixed(6)}, ${value.longitude.toFixed(6)}`}
        </p>
      )}
    </div>
  )
}
