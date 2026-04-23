import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

// Taux légaux autorisés en France
export const LEGAL_VAT_RATES = [0, 5.5, 10, 20] as const
export type LegalVatRate = typeof LEGAL_VAT_RATES[number]
export type VatConfig = {
  isVatSubject: boolean
  defaultVatRate: number | null
}

/**
 * Parse un taux de TVA depuis une valeur brute (string, number, null…).
 * Contrairement à `parseFloat(x) || fallback`, ne remplace jamais 0 par le fallback.
 */
export function parseVatRate(raw: unknown, fallback = 20): number {
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''))
  return Number.isNaN(n) ? fallback : n
}

export function coerceLegalVatRate(raw: unknown, fallback = 20): number {
  const parsed = parseVatRate(raw, fallback)
  return LEGAL_VAT_RATES.includes(parsed as LegalVatRate) ? parsed : fallback
}

export function resolveDefaultVatRate(config: VatConfig, fallback = 20): number {
  if (!config.isVatSubject) return 0
  return coerceLegalVatRate(config.defaultVatRate, fallback)
}

export function getDocumentDefaultVatRate(config: VatConfig, fallback = 20): number {
  return resolveDefaultVatRate(config, fallback)
}

export function getCatalogDocumentVatRate(config: VatConfig, fallback = 20): number {
  return getDocumentDefaultVatRate(config, fallback)
}
