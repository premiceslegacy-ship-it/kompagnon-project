// Algorithme d'optimisation de tournée par proximité géographique estimée.
// Module pur TypeScript — pas de dépendances Node, importable côté client et serveur.

export type OptimizableSlot = {
  id: string
  postal_code: string | null
  city?: string | null
  address_line1?: string | null
}

function normalizePostal(value: string | null | undefined): string | null {
  const raw = value?.replace(/\s/g, '').toUpperCase()
  if (!raw) return null
  if (/^2A\d{3}$/.test(raw)) return raw
  if (/^2B\d{3}$/.test(raw)) return raw
  const digits = raw.replace(/\D/g, '')
  return digits ? digits.padStart(5, '0').slice(0, 5) : null
}

function postalRank(value: string | null | undefined): number | null {
  const cp = normalizePostal(value)
  if (!cp) return null
  if (cp.startsWith('2A')) return 200
  if (cp.startsWith('2B')) return 201
  return parseInt(cp.slice(0, 2), 10)
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function sameStreet(a?: string | null, b?: string | null): boolean {
  const aa = normalizeText(a).replace(/^\d+\s+/, '')
  const bb = normalizeText(b).replace(/^\d+\s+/, '')
  return aa.length > 5 && aa === bb
}

function estimatedTravelScore(a: OptimizableSlot | null, b: OptimizableSlot): number {
  if (!a) return 0
  const aPostal = normalizePostal(a.postal_code)
  const bPostal = normalizePostal(b.postal_code)
  let score = 300

  if (aPostal && bPostal) {
    if (aPostal === bPostal) score = 80
    else if (aPostal.slice(0, 3) === bPostal.slice(0, 3)) score = 130
    else if (aPostal.slice(0, 2) === bPostal.slice(0, 2)) score = 210
    else {
      const aRank = postalRank(aPostal)
      const bRank = postalRank(bPostal)
      const diff = aRank != null && bRank != null ? Math.abs(aRank - bRank) : 8
      score = 260 + Math.min(diff, 12) * 28
    }
  }

  const aCity = normalizeText(a.city)
  const bCity = normalizeText(b.city)
  if (aCity && bCity && aCity === bCity) score -= 45
  if (sameStreet(a.address_line1, b.address_line1)) score -= 35

  return Math.max(60, score)
}

function routeScore(route: OptimizableSlot[], start?: OptimizableSlot | null): number {
  let score = 0
  let prev = start ?? null
  for (const slot of route) {
    score += estimatedTravelScore(prev, slot)
    prev = slot
  }
  return score
}

function nearestNeighbor(slots: OptimizableSlot[], start?: OptimizableSlot | null): OptimizableSlot[] {
  const remaining = [...slots]
  const ordered: OptimizableSlot[] = []
  let current = start ?? null

  while (remaining.length > 0) {
    let bestIdx = 0
    let bestScore = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const score = estimatedTravelScore(current, remaining[i])
      if (score < bestScore) {
        bestScore = score
        bestIdx = i
      }
    }
    const chosen = remaining.splice(bestIdx, 1)[0]
    ordered.push(chosen)
    current = chosen
  }

  return ordered
}

function improveWithTwoOpt(route: OptimizableSlot[], start?: OptimizableSlot | null): OptimizableSlot[] {
  if (route.length < 4) return route
  let best = route
  let bestScore = routeScore(best, start)
  let improved = true

  while (improved) {
    improved = false
    for (let i = 0; i < best.length - 2; i++) {
      for (let j = i + 2; j < best.length; j++) {
        const candidate = [
          ...best.slice(0, i + 1),
          ...best.slice(i + 1, j + 1).reverse(),
          ...best.slice(j + 1),
        ]
        const candidateScore = routeScore(candidate, start)
        if (candidateScore + 1 < bestScore) {
          best = candidate
          bestScore = candidateScore
          improved = true
        }
      }
    }
  }

  return best
}

// Estime le temps de trajet en minutes selon la proximité des codes postaux, villes et rues.
export function estimateTravelMin(a: OptimizableSlot | string | null, b: OptimizableSlot | string | null): number {
  const from = typeof a === 'string' || a == null ? { id: 'from', postal_code: a } : a
  const to = typeof b === 'string' || b == null ? { id: 'to', postal_code: b } : b
  const score = estimatedTravelScore(from, to)
  return Math.max(8, Math.round(score / 10) * 5)
}

// Retourne les IDs dans l'ordre optimisé.
// Sans API de cartographie, on teste plusieurs points de départ puis on applique une passe 2-opt.
export function optimizeRouteOrder(
  slots: OptimizableSlot[],
  startPostalCode?: string | null,
): string[] {
  if (slots.length <= 1) return slots.map(s => s.id)

  const start = startPostalCode ? { id: 'start', postal_code: startPostalCode } : null
  const starts = start ? [start] : slots
  let bestRoute: OptimizableSlot[] | null = null
  let bestScore = Infinity

  for (const candidateStart of starts) {
    const pool = start ? slots : slots.filter(s => s.id !== candidateStart.id)
    const route = start
      ? nearestNeighbor(pool, candidateStart)
      : [candidateStart, ...nearestNeighbor(pool, candidateStart)]
    const improved = improveWithTwoOpt(route, start)
    const score = routeScore(improved, start)
    if (score < bestScore) {
      bestRoute = improved
      bestScore = score
    }
  }

  return (bestRoute ?? slots).map(s => s.id)
}

// Retourne l'ordre optimisé avec les temps de trajet calculés pour chaque slot.
export function buildTourneeWithTravel(
  orderedSlots: OptimizableSlot[],
  startPostalCode?: string | null,
): Array<{ id: string; route_order: number; travel_from_prev_min: number | null }> {
  const start = startPostalCode ? { id: 'start', postal_code: startPostalCode } : null
  return orderedSlots.map((slot, i) => {
    const prev = i === 0 ? start : orderedSlots[i - 1]
    return {
      id: slot.id,
      route_order: i + 1,
      travel_from_prev_min:
        i === 0 && !startPostalCode
          ? null
          : estimateTravelMin(prev, slot),
    }
  })
}
