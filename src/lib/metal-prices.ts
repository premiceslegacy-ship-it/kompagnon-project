import { createAdminClient } from '@/lib/supabase/admin'

// Codes LME : cotés en temps réel via le fournisseur de cours métaux.
export const LME_METAL_CODES = ['ALU', 'XCU', 'ZNC', 'PB'] as const
export type LmeMetalCode = typeof LME_METAL_CODES[number]

// Codes manuels : prix saisi par l'artisan, pas de cotation disponible
export const MANUAL_METAL_CODES = ['STEEL'] as const
export type ManualMetalCode = typeof MANUAL_METAL_CODES[number]

// Tous les codes acceptés dans le module
export const METAL_CODES = [...LME_METAL_CODES, ...MANUAL_METAL_CODES] as const
export type MetalCode = typeof METAL_CODES[number]

export const METAL_LABELS: Record<MetalCode, string> = {
  ALU:   'Aluminium',
  XCU:   'Cuivre',
  ZNC:   'Zinc',
  PB:    'Plomb',
  STEEL: 'Acier',
}

export type CachedMetalPrice = {
  metal_code: MetalCode
  price_eur_kg: number
  source: string
  fetched_at: string
  updated_at: string
}

// Délai de rafraîchissement aligné sur le plan fournisseur actuel (10 min).
const CACHE_TTL_MS = 10 * 60 * 1000
const DEMO_SOURCE = 'atelier_demo_market_data'

type MetalPriceApiResponse = {
  success: boolean
  base: string
  timestamp: number
  rates: Record<string, number>
  error?: {
    code?: number
    statusCode?: number
    info?: string
    message?: string
  }
}

// 1 once avoirdupois = 0.0283495 kg (métaux industriels, plan Basic sans unit=kilogram)
const OZ_TO_KG = 0.0283495

const DEMO_BASE_PRICES_EUR_KG: Record<LmeMetalCode, number> = {
  ALU: 2.35,
  XCU: 9.15,
  ZNC: 2.65,
  PB: 1.95,
}

export class MetalPriceProviderError extends Error {
  code: number | null

  constructor(message: string, code: number | null = null) {
    super(message)
    this.name = 'MetalPriceProviderError'
    this.code = code
  }
}

function getProviderErrorMessage(data: MetalPriceApiResponse): string {
  const code = data.error?.code ?? data.error?.statusCode ?? null
  const details = data.error?.info ?? data.error?.message ?? 'réponse non valide'

  if (details.toLowerCase().includes('requires a paid plan')) {
    return 'Accès aux cours des métaux industriels non activé pour cet environnement.'
  }

  return code ? `Fournisseur cours métaux ${code}: ${details}` : `Fournisseur cours métaux: ${details}`
}

export function getMetalPriceLogMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Cours indisponibles temporairement'
}

export function getMetalPricePublicMessage(err: unknown): string {
  if (err instanceof MetalPriceProviderError && err.message.toLowerCase().includes('non activé')) {
    return 'Les cours automatiques Atelier ne sont pas disponibles sur cet environnement de test. Les grilles à prix fixe restent utilisables.'
  }

  return 'Les cours automatiques Atelier sont momentanément indisponibles. Les grilles à prix fixe restent utilisables.'
}

function isDemoMetalPricesEnabled(): boolean {
  return process.env.ATELIER_DEMO_METAL_PRICES === 'true'
}

function getDailyDemoFactor(code: LmeMetalCode, date: Date): number {
  const daySeed = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86400000
  const codeSeed = code.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)
  const wave = Math.sin((daySeed + codeSeed) * 0.73)
  return 1 + wave * 0.018
}

function buildDemoPrices(): CachedMetalPrice[] {
  const now = new Date()
  const isoNow = now.toISOString()

  return LME_METAL_CODES.map((code) => ({
    metal_code: code,
    price_eur_kg: Math.round(DEMO_BASE_PRICES_EUR_KG[code] * getDailyDemoFactor(code, now) * 100) / 100,
    source: DEMO_SOURCE,
    fetched_at: isoNow,
    updated_at: isoNow,
  }))
}

async function getDemoPrices(): Promise<CachedMetalPrice[]> {
  const cached = await getCachedPrices()
  if (cached?.every((price) => price.source === DEMO_SOURCE)) return cached

  const demoPrices = buildDemoPrices()
  await persistPrices(demoPrices)
  return demoPrices
}

/**
 * Récupère les cours depuis le fournisseur de marché et les convertit en EUR/kg.
 *
 * Convention de l'API (plan Basic, base=EUR) :
 *   rates["ALU"] = nombre d'onces d'aluminium que vaut 1 EUR
 *   → EUR/oz  = 1 / rates["ALU"]
 *   → EUR/kg  = (1 / rates["ALU"]) / OZ_TO_KG
 *
 * Le paramètre unit=kilogram existe mais est réservé aux plans supérieurs.
 * On fait la conversion manuellement ici.
 */
async function fetchFromApi(): Promise<CachedMetalPrice[]> {
  const apiKey = process.env.METALPRICEAPI_KEY
  if (!apiKey) throw new Error('METALPRICEAPI_KEY non configurée')

  const symbols = LME_METAL_CODES.join(',')
  const url = `https://api-eu.metalpriceapi.com/v1/latest?api_key=${apiKey}&base=EUR&currencies=${symbols}`

  const res = await fetch(url, { next: { revalidate: 0 } })
  if (!res.ok) throw new Error(`Fournisseur cours métaux HTTP ${res.status}`)

  const data: MetalPriceApiResponse = await res.json()
  if (!data.success) {
    throw new MetalPriceProviderError(
      getProviderErrorMessage(data),
      data.error?.code ?? data.error?.statusCode ?? null
    )
  }
  if (!data.rates || typeof data.rates !== 'object') {
    throw new MetalPriceProviderError('Fournisseur cours métaux: rates manquant')
  }

  const now = new Date().toISOString()

  return LME_METAL_CODES.map((code) => {
    const ozPerEur = data.rates[code]
    if (!ozPerEur || ozPerEur <= 0) throw new Error(`Cours manquant pour ${code}`)
    // EUR/kg = (1 EUR / ozPerEur oz) / (OZ_TO_KG kg/oz)
    const priceEurKg = 1 / (ozPerEur * OZ_TO_KG)

    return {
      metal_code: code,
      price_eur_kg: Math.round(priceEurKg * 100) / 100, // arrondi au centime
      source: 'atelier_market_data',
      fetched_at: now,
      updated_at: now,
    }
  })
}

/**
 * Lit les cours depuis le cache Supabase.
 * Retourne null si le cache est vide ou expiré (> CACHE_TTL_MS).
 */
export async function getCachedPrices(): Promise<CachedMetalPrice[] | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('cached_metal_prices')
    .select('*')
    .in('metal_code', LME_METAL_CODES)

  if (error || !data || data.length === 0) return null

  const oldestUpdate = Math.min(...data.map((r) => new Date(r.updated_at).getTime()))
  if (Date.now() - oldestUpdate > CACHE_TTL_MS) return null

  return data as CachedMetalPrice[]
}

/**
 * Upsert des cours dans le cache Supabase.
 */
async function persistPrices(prices: CachedMetalPrice[]): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('cached_metal_prices')
    .upsert(prices, { onConflict: 'metal_code' })

  if (error) throw new Error(`Erreur persistance cache : ${error.message}`)
}

/**
 * Retourne les cours en cache valides, ou rafraîchit depuis l'API.
 * En cas d'échec API, retourne le dernier cache connu même expiré (fallback).
 */
export async function getMetalPrices(): Promise<CachedMetalPrice[]> {
  if (isDemoMetalPricesEnabled()) return getDemoPrices()

  const cached = await getCachedPrices()
  if (cached) return cached

  try {
    const fresh = await fetchFromApi()
    await persistPrices(fresh)
    return fresh
  } catch (err) {
    // Fallback : retourner le dernier cache connu, même expiré
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('cached_metal_prices')
      .select('*')
      .in('metal_code', LME_METAL_CODES)

    if (data && data.length > 0) return data as CachedMetalPrice[]
    throw err
  }
}

/**
 * Force un rafraîchissement depuis l'API (utilisé par la route cron).
 */
export async function refreshMetalPrices(): Promise<CachedMetalPrice[]> {
  if (isDemoMetalPricesEnabled()) {
    const demoPrices = buildDemoPrices()
    await persistPrices(demoPrices)
    return demoPrices
  }

  const fresh = await fetchFromApi()
  await persistPrices(fresh)
  return fresh
}
