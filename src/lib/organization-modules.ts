import {
  getModulesForTier,
  PRODUCT_MODULE_KEYS,
  type ProductModuleKey,
} from '@/lib/quota-catalog'

export const ORGANIZATION_MODULE_KEYS = PRODUCT_MODULE_KEYS

export type OrganizationModuleKey = ProductModuleKey

export type OrganizationModules = Record<OrganizationModuleKey, boolean>

export type BusinessProfile = 'btp' | 'cleaning' | 'industry'

// Les profils metier gardent le comportement historique: si aucune config n'existe,
// l'instance reste utilisable avec les modules IA principaux actifs.
export const DEFAULT_MODULES_BY_PROFILE: Record<BusinessProfile, OrganizationModules> = {
  btp: getModulesForTier('expert'),
  cleaning: getModulesForTier('expert'),
  industry: getModulesForTier('expert'),
}

export const DEFAULT_ORGANIZATION_MODULES: OrganizationModules = getModulesForTier('expert')

export const MODULES_SETUP_ONLY: OrganizationModules = getModulesForTier('setup_only')
export const MODULES_STARTER: OrganizationModules = getModulesForTier('starter')
export const MODULES_PRO: OrganizationModules = getModulesForTier('pro')
export const MODULES_EXPERT: OrganizationModules = getModulesForTier('expert')

export function getDefaultModulesForProfile(profile: string | null | undefined): OrganizationModules {
  if (profile && profile in DEFAULT_MODULES_BY_PROFILE) {
    return { ...DEFAULT_MODULES_BY_PROFILE[profile as BusinessProfile] }
  }
  return { ...DEFAULT_ORGANIZATION_MODULES }
}

export function normalizeOrganizationModules(input: unknown, profile?: string | null): OrganizationModules {
  const source = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const defaults = getDefaultModulesForProfile(profile)

  return ORGANIZATION_MODULE_KEYS.reduce<OrganizationModules>((acc, key) => {
    // WhatsApp suspendu (vérification Meta en attente) : jamais activable, même
    // via un input explicite { whatsapp_agent: true } — garde serveur, pas
    // seulement un défaut contournable.
    if (key.startsWith('whatsapp_')) {
      acc[key] = false
    } else if (key in source) {
      acc[key] = source[key] === true
    } else {
      acc[key] = defaults[key]
    }
    return acc
  }, { ...defaults })
}
