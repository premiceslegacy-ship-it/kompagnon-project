export const APP_NAME = 'ATELIER'
export const APP_SIGNATURE = 'ATELIER by Orsayn'

export const AI_ASSISTANTS = {
  sarah:    { name: 'Sarah',   role: 'Secrétaire métier',    avatar: '/brand/sarah-avatar.webp' },
  chloe:    { name: 'Chloé',   role: 'Chiffreuse',           avatar: '/brand/chloe-avatar.webp' },
  marco:    { name: 'Marco',   role: 'Chef de chantier',     avatar: '/brand/marco-avatar.webp' },
  valentin: { name: 'Valentin',role: 'Estimateur MO',        avatar: null },
  lea:      { name: 'Léa',     role: 'Assistante catalogue', avatar: '/brand/lea-avatar.webp' },
} as const

export const AI_NAME = AI_ASSISTANTS.chloe.name

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

/**
 * Logo entier en PNG pour les emails : Gmail et Outlook n'affichent pas les SVG.
 * `dark` = logo blanc à poser sur un fond sombre, `light` = logo noir sur fond clair.
 */
export const EMAIL_BRAND_ASSETS = {
  wordmark: {
    light: '/brand/atelier/logo-atelier-noir.png',
    dark: '/brand/atelier/logo-atelier-blanc.png',
  },
} as const

export function emailWordmarkUrl(background: BrandBackground): string | null {
  return absoluteBrandAssetUrl(EMAIL_BRAND_ASSETS.wordmark[background])
}

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

/**
 * Nom d'expéditeur de tous les emails écrits par Atelier lui-même (support,
 * essai, facturation, codes de connexion). Aligné sur l'en-tête, la signature et
 * le pied de page des emails. Les emails envoyés au nom d'une entreprise portent
 * le nom de cette entreprise, jamais celui-ci.
 */
export const ATELIER_SENDER_NAME = 'Atelier BTP'

export function defaultBrandedSenderName(name?: string | null): string {
  return name?.trim() || ATELIER_SENDER_NAME
}
