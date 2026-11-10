// Codes conservés pour les grilles manuelles et les documents historiques.
export const METAL_CODES = ['ALU', 'XCU', 'ZNC', 'PB', 'NI', 'STEEL'] as const
export type MetalCode = typeof METAL_CODES[number]

export const METAL_LABELS: Record<MetalCode, string> = {
  ALU:   'Aluminium',
  XCU:   'Cuivre',
  ZNC:   'Zinc',
  PB:    'Plomb',
  STEEL: 'Acier',
  NI:    'Nickel (proxy inox)',
}

// Densités standard (kg/m³) utilisées pour convertir des dimensions (L × l × épaisseur)
// en poids matière. Valeurs de référence métallurgique ; le nickel sert de proxy inox
// (l'inox 304/316 réel est proche de 8000 kg/m³, valeur retenue ici).
export const METAL_DENSITY_KG_M3: Record<MetalCode, number> = {
  ALU:   2700,
  XCU:   8960,
  ZNC:   7140,
  PB:    11340,
  STEEL: 7850,
  NI:    8000,
}


/**
 * Calcule le poids (kg) d'une pièce métal à partir de ses dimensions et de
 * l'épaisseur de la grille (thickness_mm). Remplace le multiplicateur "1 pièce"
 * par un vrai calcul physique quand la grille et les dimensions le permettent :
 *   - surface (tôle) : longueur (m) × largeur (m) × épaisseur (m) × densité (kg/m³)
 *   - linéaire (profilé/tube) : longueur (m) × un poids au mètre linéaire n'est pas
 *     dérivable sans section — non supporté, retourne null (reste au multiplicateur simple).
 * Retourne null si les données nécessaires manquent (pas d'épaisseur sur la grille,
 * pas de dimensions saisies) : l'appelant garde alors le comportement existant.
 */
export function computeMetalWeightKg(
  metalCode: MetalCode,
  thicknessMm: number | null,
  lengthM: number | null,
  widthM: number | null,
): number | null {
  if (!thicknessMm || thicknessMm <= 0) return null
  if (!lengthM || lengthM <= 0 || !widthM || widthM <= 0) return null

  const density = METAL_DENSITY_KG_M3[metalCode]
  const thicknessM = thicknessMm / 1000
  const volumeM3 = lengthM * widthM * thicknessM
  const weightKg = volumeM3 * density

  return Math.round(weightKg * 1000) / 1000
}

/** Quantité dans l'unité de la grille, sans convertir un prix ni utiliser un cours. */
export function computeManualMetalQuantity(
  grid: { metal_code: MetalCode; unit: string; thickness_mm: number | null },
  lengthM: number | null,
  widthM: number | null,
  pieceCount = 1,
): number | null {
  if (!Number.isFinite(pieceCount) || pieceCount <= 0) return null
  let quantity: number | null = null
  if (grid.unit === 'kg') {
    const weightKg = computeMetalWeightKg(grid.metal_code, grid.thickness_mm, lengthM, widthM)
    if (weightKg !== null) quantity = weightKg * pieceCount
  } else if (grid.unit === 'm²' && lengthM !== null && lengthM > 0 && widthM !== null && widthM > 0) {
    quantity = lengthM * widthM * pieceCount
  } else if (grid.unit === 'ml' && lengthM !== null && lengthM > 0) {
    quantity = lengthM * pieceCount
  } else if (grid.unit === 'pièce') {
    quantity = pieceCount
  }
  if (quantity === null || !Number.isFinite(quantity) || quantity < 0) return null
  const rounded = Math.round((quantity + Number.EPSILON) * 1000) / 1000
  return Number.isFinite(rounded) ? rounded : null
}
