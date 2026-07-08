'use client'

import { useEffect } from 'react'
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './leaflet-theme.css'

const FALLBACK_CENTER: [number, number] = [46.6, 2.4] // Centre France
const FALLBACK_ZOOM = 5
const PIN_ZOOM = 15

const accentIcon = L.divIcon({
  className: 'kompagnon-map-marker',
  html: `<svg width="32" height="42" viewBox="0 0 32 42" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M16 0C7.163 0 0 7.163 0 16c0 11 16 26 16 26s16-15 16-26c0-8.837-7.163-16-16-16z" fill="rgb(var(--accent-primary))"/>
    <circle cx="16" cy="16" r="6" fill="white"/>
  </svg>`,
  iconSize: [32, 42],
  iconAnchor: [16, 42],
})

function ClickHandler({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

function Recenter({ latitude, longitude }: { latitude: number | null; longitude: number | null }) {
  const map = useMap()
  useEffect(() => {
    if (latitude == null || longitude == null) return
    map.flyTo([latitude, longitude], Math.max(map.getZoom(), PIN_ZOOM), { duration: 0.6 })
  }, [latitude, longitude, map])
  return null
}

type LeafletMapProps = {
  latitude: number | null
  longitude: number | null
  onPick: (lat: number, lng: number) => void
}

export default function LeafletMap({ latitude, longitude, onPick }: LeafletMapProps) {
  const hasPosition = latitude != null && longitude != null
  const center: [number, number] = hasPosition ? [latitude, longitude] : FALLBACK_CENTER

  return (
    <MapContainer
      center={center}
      zoom={hasPosition ? PIN_ZOOM : FALLBACK_ZOOM}
      scrollWheelZoom
      className="h-full w-full"
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&copy; OpenStreetMap contributors"
      />
      <ClickHandler onPick={onPick} />
      <Recenter latitude={latitude} longitude={longitude} />
      {hasPosition && (
        <Marker
          position={[latitude, longitude]}
          icon={accentIcon}
          draggable
          eventHandlers={{
            dragend: (e) => {
              const pos = e.target.getLatLng()
              onPick(pos.lat, pos.lng)
            },
          }}
        />
      )}
    </MapContainer>
  )
}
