export const ORGANIZATION_MODULE_KEYS = [
  'whatsapp_agent',
  'voice_input',
  'planning_ai',
  'quote_ai',
  'document_ai',
  'catalog_ai',
] as const

export type OrganizationModuleKey = typeof ORGANIZATION_MODULE_KEYS[number]

export type OrganizationModules = Record<OrganizationModuleKey, boolean>

export type BusinessProfile = 'btp' | 'cleaning' | 'industry'

// Modules activés par défaut selon le profil métier.
// L'override individuel dans organization_modules prend toujours le dessus.
export const DEFAULT_MODULES_BY_PROFILE: Record<BusinessProfile, OrganizationModules> = {
  btp: {
    whatsapp_agent: true,
    voice_input:    true,
    planning_ai:    true,
    quote_ai:       true,
    document_ai:    true,
    catalog_ai:     true,
  },
  cleaning: {
    whatsapp_agent: true,
    voice_input:    true,
    planning_ai:    true,
    quote_ai:       true,
    document_ai:    true,
    catalog_ai:     true,
  },
  industry: {
    whatsapp_agent: true,
    voice_input:    true,
    planning_ai:    true,
    quote_ai:       true,
    document_ai:    true,
    catalog_ai:     true,
  },
}

// Fallback si aucun profil connu
export const DEFAULT_ORGANIZATION_MODULES: OrganizationModules = {
  whatsapp_agent: true,
  voice_input:    true,
  planning_ai:    true,
  quote_ai:       true,
  document_ai:    true,
  catalog_ai:     true,
}

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
    // Override explicite en DB (true/false) → prioritaire
    if (key in source) {
      acc[key] = source[key] === true
    } else {
      // Pas de valeur en DB → on tombe sur le default du profil
      acc[key] = defaults[key]
    }
    return acc
  }, { ...defaults })
}

