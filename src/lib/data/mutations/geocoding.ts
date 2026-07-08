'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'

export type RoutePoint = {
  chantierId: string
  label: string
  latitude: number
  longitude: number
}

type GeocodableChantier = {
  id: string
  title: string
  address_line1: string | null
  postal_code: string | null
  city: string | null
  latitude: number | null
  longitude: number | null
}

async function geocodeAddress(query: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await fetch(
      `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&limit=1`,
    )
    if (!res.ok) return null
    const json = await res.json()
    const feature = json.features?.[0]
    if (!feature) return null
    const [lng, lat] = feature.geometry.coordinates
    return { lat, lng }
  } catch {
    return null
  }
}

/**
 * Géocode à la volée les chantiers d'une tournée qui n'ont pas encore de
 * lat/lng, persiste le résultat, et retourne les points affichables (ceux
 * dont le géocodage échoue ou n'ont pas d'adresse exploitable sont omis,
 * pas d'erreur bloquante).
 */
export async function getOrGeocodeRoutePoints(chantierIds: string[]): Promise<RoutePoint[]> {
  if (chantierIds.length === 0) return []

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  const { data: chantiers } = await supabase
    .from('chantiers')
    .select('id, title, address_line1, postal_code, city, latitude, longitude')
    .in('id', chantierIds)
    .eq('organization_id', orgId)

  if (!chantiers || chantiers.length === 0) return []

  const admin = createAdminClient()
  const points: RoutePoint[] = []

  for (const c of chantiers as GeocodableChantier[]) {
    if (c.latitude != null && c.longitude != null) {
      points.push({ chantierId: c.id, label: c.title, latitude: c.latitude, longitude: c.longitude })
      continue
    }

    const addressQuery = [c.address_line1, c.postal_code, c.city].filter(Boolean).join(' ')
    if (!addressQuery.trim()) continue

    const geocoded = await geocodeAddress(addressQuery)
    if (!geocoded) continue

    await admin
      .from('chantiers')
      .update({ latitude: geocoded.lat, longitude: geocoded.lng })
      .eq('id', c.id)
      .eq('organization_id', orgId)

    points.push({ chantierId: c.id, label: c.title, latitude: geocoded.lat, longitude: geocoded.lng })
  }

  return points
}
