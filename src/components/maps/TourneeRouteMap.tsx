'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { Loader2, MapPinOff } from 'lucide-react'
import { getOrGeocodeRoutePoints } from '@/lib/data/mutations/geocoding'
import type { TourneeSlot } from '@/lib/data/queries/chantiers'
import type { RouteMapPoint } from './LeafletRouteMap'

const LeafletRouteMap = dynamic(() => import('./LeafletRouteMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-interactive dark:bg-white/5">
      <Loader2 className="h-5 w-5 animate-spin text-secondary" />
    </div>
  ),
})

type TourneeRouteMapProps = {
  slots: TourneeSlot[]
  departure?: { latitude: number | null; longitude: number | null } | null
  className?: string
}

export function TourneeRouteMap({ slots, departure, className }: TourneeRouteMapProps) {
  const [points, setPoints] = useState<RouteMapPoint[] | null>(null)

  const uniqueChantierIds = [...new Set(slots.map(s => s.chantier_id).filter(Boolean))]
  const chantierIdsKey = uniqueChantierIds.join(',')

  useEffect(() => {
    let cancelled = false
    setPoints(null)
    getOrGeocodeRoutePoints(uniqueChantierIds).then(routePoints => {
      if (cancelled) return
      // Ordre = ordre d'apparition dans la tournée (route_order), un point par chantier
      const seen = new Set<string>()
      const ordered: RouteMapPoint[] = []
      for (const slot of slots) {
        if (seen.has(slot.chantier_id)) continue
        const rp = routePoints.find(p => p.chantierId === slot.chantier_id)
        if (!rp) continue
        seen.add(slot.chantier_id)
        ordered.push({ id: rp.chantierId, lat: rp.latitude, lng: rp.longitude, label: rp.label, order: ordered.length + 1 })
      }
      setPoints(ordered)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chantierIdsKey])

  const wrapperClass = className ?? 'h-80'

  if (points === null) {
    return (
      <div className={`flex items-center justify-center rounded-2xl border border-[var(--elevation-border)] bg-interactive dark:bg-white/5 ${wrapperClass}`}>
        <Loader2 className="h-5 w-5 animate-spin text-secondary" />
      </div>
    )
  }

  if (points.length === 0) {
    return (
      <div className={`flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--elevation-border)] bg-interactive text-center dark:bg-white/5 ${wrapperClass}`}>
        <MapPinOff className="h-6 w-6 text-secondary" />
        <p className="max-w-xs text-sm text-secondary">Aucun chantier de cette tournée n&apos;a pu être localisé sur la carte.</p>
      </div>
    )
  }

  const hasDeparture = departure?.latitude != null && departure?.longitude != null

  return (
    <div className={`overflow-hidden rounded-2xl border border-[var(--elevation-border)] shadow-kompagnon ${wrapperClass}`}>
      <LeafletRouteMap
        points={points}
        departure={hasDeparture ? { lat: departure!.latitude!, lng: departure!.longitude! } : null}
      />
    </div>
  )
}
