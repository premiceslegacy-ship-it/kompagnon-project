import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

// Supprime le markdown basique pour affichage en texte brut dans l'UI
export function cleanMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s+/g, '')          // # titres
    .replace(/\*\*(.+?)\*\*/g, '$1')    // **gras**
    .replace(/\*(.+?)\*/g, '$1')        // *italique*
    .replace(/`(.+?)`/g, '$1')          // `code`
    .replace(/^[-*+]\s+/gm, '• ')       // listes → bullet propre
    .replace(/^\d+\.\s+/gm, '')         // listes numérotées
    .replace(/\[(.+?)\]\(.+?\)/g, '$1') // [liens](url)
    .replace(/_{1,2}(.+?)_{1,2}/g, '$1')// _italique_ __gras__
    .trim()
}

// Taux légaux autorisés en France
export const LEGAL_VAT_RATES = [0, 5.5, 10, 20] as const
export type LegalVatRate = typeof LEGAL_VAT_RATES[number]
export type VatConfig = {
  isVatSubject: boolean
  defaultVatRate: number | null
  defaultQuoteValidityDays?: number | null
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

// Retourne la date du jour au format YYYY-MM-DD selon l'heure de Paris (Europe/Paris).
// À utiliser partout à la place de new Date().toISOString().split('T')[0] qui donne la date UTC.
export function todayParis(): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()).split('/').reverse().join('-')
}

// Retourne la date d'un timestamp (ms) au format YYYY-MM-DD selon l'heure de Paris.
export function dateParis(ms: number): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ms)).split('/').reverse().join('-')
}
