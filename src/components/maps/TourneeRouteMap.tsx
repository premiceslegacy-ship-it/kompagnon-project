'use client'
// @atelier-migrated

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { getOrGeocodeRoutePoints } from '@/lib/data/mutations/geocoding'
import type { TourneeSlot } from '@/lib/data/queries/chantiers'
import type { RouteMapPoint } from './LeafletRouteMap'
import styles from './Maps.module.css'

const LeafletRouteMap = dynamic(() => import('./LeafletRouteMap'), {
  ssr: false,
  loading: () => <div className={styles.placeholder} role="status">Chargement de la carte…</div>,
})

type TourneeRouteMapProps = {
  slots: TourneeSlot[]
  departure?: { latitude: number | null; longitude: number | null } | null
  className?: string
}

export function TourneeRouteMap({ slots, departure, className }: TourneeRouteMapProps) {
  const [points, setPoints] = useState<RouteMapPoint[] | null>(null)

  const uniqueChantierIds = [...new Set(slots.map(s => s.chantier_id).filter((id): id is string => !!id))]
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
        if (!slot.chantier_id || seen.has(slot.chantier_id)) continue
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
      <div className={`${styles.placeholder} ${styles.frame} ${wrapperClass}`} role="status">Chargement de la carte…</div>
    )
  }

  if (points.length === 0) {
    return (
      <div className={`${styles.placeholder} ${styles.placeholderDashed} ${wrapperClass}`}>
        Aucun chantier de cette tournée n’a pu être localisé sur la carte.
      </div>
    )
  }

  const hasDeparture = departure?.latitude != null && departure?.longitude != null

  return (
    <div className={`${styles.frame} ${wrapperClass}`}>
      <LeafletRouteMap
        points={points}
        departure={hasDeparture ? { lat: departure!.latitude!, lng: departure!.longitude! } : null}
      />
    </div>
  )
}
