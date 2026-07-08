'use client'

import { useEffect, useRef, useState } from 'react'

export type AddressFeature = {
  label: string
  postalCode: string | null
  city: string | null
  latitude: number
  longitude: number
}

type ApiAdresseFeature = {
  properties: {
    label: string
    postcode?: string
    city?: string
  }
  geometry: {
    coordinates: [number, number] // [lon, lat]
  }
}

const MIN_LENGTH = 3
const DEBOUNCE_MS = 300

export function useAddressAutocomplete(query: string) {
  const [suggestions, setSuggestions] = useState<AddressFeature[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < MIN_LENGTH) {
      setSuggestions([])
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    const timer = setTimeout(async () => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      try {
        const res = await fetch(
          `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(trimmed)}&limit=5`,
          { signal: controller.signal },
        )
        if (!res.ok) throw new Error('geocoding failed')
        const json = await res.json()
        const features: ApiAdresseFeature[] = json.features ?? []
        setSuggestions(features.map(f => ({
          label: f.properties.label,
          postalCode: f.properties.postcode ?? null,
          city: f.properties.city ?? null,
          latitude: f.geometry.coordinates[1],
          longitude: f.geometry.coordinates[0],
        })))
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setSuggestions([])
      } finally {
        setIsLoading(false)
      }
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
    }
  }, [query])

  return { suggestions, isLoading }
}

export async function reverseGeocode(latitude: number, longitude: number): Promise<AddressFeature | null> {
  try {
    const res = await fetch(
      `https://api-adresse.data.gouv.fr/reverse/?lon=${longitude}&lat=${latitude}`,
    )
    if (!res.ok) return null
    const json = await res.json()
    const feature: ApiAdresseFeature | undefined = json.features?.[0]
    if (!feature) return null
    return {
      label: feature.properties.label,
      postalCode: feature.properties.postcode ?? null,
      city: feature.properties.city ?? null,
      latitude: feature.geometry.coordinates[1],
      longitude: feature.geometry.coordinates[0],
    }
  } catch {
    return null
  }
}
