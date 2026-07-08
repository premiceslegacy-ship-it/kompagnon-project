'use client'

import { useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './leaflet-theme.css'

const FALLBACK_CENTER: [number, number] = [46.6, 2.4] // Centre France
const FALLBACK_ZOOM = 5

function numberedIcon(order: number, isDeparture: boolean): L.DivIcon {
  const bg = isDeparture ? '#22C55E' : 'rgb(var(--accent-primary))'
  return L.divIcon({
    className: 'kompagnon-map-marker-numbered',
    html: `<div style="
      width:28px;height:28px;border-radius:50%;background:${bg};
      display:flex;align-items:center;justify-content:center;
      color:white;font-weight:700;font-size:13px;font-family:'Inter',sans-serif;
      box-shadow:0 2px 6px rgba(0,0,0,0.35);border:2px solid white;
    ">${isDeparture ? '' : order}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  })
}

export type RouteMapPoint = {
  id: string
  lat: number
  lng: number
  label: string
  order: number
}

function FitToPoints({ points }: { points: RouteMapPoint[] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length === 0) return
    if (points.length === 1) {
      map.flyTo([points[0].lat, points[0].lng], 14, { duration: 0.6 })
      return
    }
    const bounds = L.latLngBounds(points.map(p => [p.lat, p.lng] as [number, number]))
    map.fitBounds(bounds, { padding: [32, 32] })
  }, [points, map])
  return null
}

type LeafletRouteMapProps = {
  points: RouteMapPoint[]
  departure?: { lat: number; lng: number } | null
}

export default function LeafletRouteMap({ points, departure }: LeafletRouteMapProps) {
  const hasPoints = points.length > 0
  const center: [number, number] = hasPoints ? [points[0].lat, points[0].lng] : FALLBACK_CENTER

  const polylinePositions: [number, number][] = [
    ...(departure ? [[departure.lat, departure.lng] as [number, number]] : []),
    ...points.map(p => [p.lat, p.lng] as [number, number]),
  ]

  const allPointsForBounds: RouteMapPoint[] = [
    ...(departure ? [{ id: 'departure', lat: departure.lat, lng: departure.lng, label: 'Départ', order: 0 }] : []),
    ...points,
  ]

  return (
    <MapContainer center={center} zoom={hasPoints ? 12 : FALLBACK_ZOOM} scrollWheelZoom className="h-full w-full">
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&copy; OpenStreetMap contributors"
      />
      <FitToPoints points={allPointsForBounds} />
      {polylinePositions.length > 1 && (
        <Polyline positions={polylinePositions} pathOptions={{ color: 'rgb(var(--accent-primary))', weight: 3, dashArray: '6 6' }} />
      )}
      {departure && (
        <Marker position={[departure.lat, departure.lng]} icon={numberedIcon(0, true)} />
      )}
      {points.map(p => (
        <Marker key={p.id} position={[p.lat, p.lng]} icon={numberedIcon(p.order, false)} />
      ))}
    </MapContainer>
  )
}
