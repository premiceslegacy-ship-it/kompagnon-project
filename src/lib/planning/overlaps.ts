export function overlaps(aStart: string | null, aEnd: string | null, bStart: string | null, bEnd: string | null): boolean {
  // Un créneau sans horaire est considéré comme couvrant toute la journée (conflit prudent par défaut).
  if (!aStart || !aEnd || !bStart || !bEnd) return true
  return aStart < bEnd && bStart < aEnd
}
