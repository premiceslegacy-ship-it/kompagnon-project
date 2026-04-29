/**
 * Calculs carburant — partagé entre devis/facture (catalogue) et rentabilité chantier.
 * Formule : litres = km × consommation L/100km / 100  → coût = litres × prix €/L
 */

export type FuelInput = {
  km: number
  consumption: number  // L/100km
  pricePerLiter: number
}

export type FuelOutput = {
  liters: number       // arrondi 2 décimales
  costHt: number       // arrondi 2 décimales
}

export function computeFuel({ km, consumption, pricePerLiter }: FuelInput): FuelOutput {
  if (km <= 0 || consumption <= 0 || pricePerLiter <= 0) {
    return { liters: 0, costHt: 0 }
  }
  const liters = Math.round((km * consumption) / 100 * 100) / 100
  const costHt = Math.round(liters * pricePerLiter * 100) / 100
  return { liters, costHt }
}

export const DEFAULT_CONSUMPTION_L_PER_100KM = 8
export const DEFAULT_FUEL_PRICE_EUR_PER_L    = 1.85
