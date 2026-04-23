export const ORGANIZATION_MODULE_KEYS = [
  'whatsapp_agent',
  'voice_input',
  'planning_ai',
  'quote_ai',
  'document_ai',
] as const

export type OrganizationModuleKey = typeof ORGANIZATION_MODULE_KEYS[number]

export type OrganizationModules = Record<OrganizationModuleKey, boolean>

export const DEFAULT_ORGANIZATION_MODULES: OrganizationModules = {
  whatsapp_agent: false,
  voice_input: false,
  planning_ai: false,
  quote_ai: false,
  document_ai: false,
}

export function normalizeOrganizationModules(input: unknown): OrganizationModules {
  const source = input && typeof input === 'object' ? input as Record<string, unknown> : {}

  return ORGANIZATION_MODULE_KEYS.reduce<OrganizationModules>((acc, key) => {
    acc[key] = source[key] === true
    return acc
  }, { ...DEFAULT_ORGANIZATION_MODULES })
}

