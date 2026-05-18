export const APP_NAME = 'ATELIER'
export const APP_SIGNATURE = 'ATELIER by Orsayn'
export const AI_NAME = 'Sarah'

export const AI_ASSISTANTS = {
  sarah: { name: 'Sarah', role: 'Chiffreuse' },
  marco: { name: 'Marco', role: 'Chef de chantier' },
  valentin: { name: 'Valentin', role: 'Estimateur MO' },
  lea: { name: 'Léa', role: 'Assistante catalogue' },
} as const

export type BrandBackground = 'light' | 'dark'

export const BRAND_ASSETS = {
  wordmark: {
    light: '/brand/atelier/logo-atelier-noir.svg',
    dark: '/brand/atelier/logo-atelier-blanc.svg',
  },
  monogram: {
    light: '/brand/atelier/monogramme-noir.svg',
    dark: '/brand/atelier/monogramme-blanc.svg',
  },
} as const

export function wordmarkForTheme(background: BrandBackground): string {
  return BRAND_ASSETS.wordmark[background]
}

export function monogramForTheme(background: BrandBackground): string {
  return BRAND_ASSETS.monogram[background]
}

export function absoluteBrandAssetUrl(path: string): string | null {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')
  if (!appUrl) return null
  return `${appUrl}${path.startsWith('/') ? path : `/${path}`}`
}

export function defaultBrandedSenderName(name?: string | null): string {
  return name?.trim() || APP_SIGNATURE
}
