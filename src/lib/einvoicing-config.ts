export const EINVOICING_MODES = ['off', 'export_only', 'super_pdp'] as const
export const EINVOICING_PROVIDERS = ['external_pa', 'super_pdp'] as const
export const EINVOICING_ENVIRONMENTS = ['sandbox', 'production'] as const
export const EINVOICING_ANNUAIRE_STATUSES = ['not_started', 'pending', 'active', 'error'] as const
export const EINVOICING_OAUTH_STATUSES = ['not_connected', 'pending', 'connected', 'error', 'revoked'] as const

export type EinvoicingMode = typeof EINVOICING_MODES[number]
export type EinvoicingProvider = typeof EINVOICING_PROVIDERS[number]
export type EinvoicingEnvironment = typeof EINVOICING_ENVIRONMENTS[number]
export type EinvoicingAnnuaireStatus = typeof EINVOICING_ANNUAIRE_STATUSES[number]
export type EinvoicingOauthStatus = typeof EINVOICING_OAUTH_STATUSES[number]

export type EinvoicingConfig = {
  mode: EinvoicingMode
  provider: EinvoicingProvider | null
  environment: EinvoicingEnvironment
  annuaire_status: EinvoicingAnnuaireStatus
  oauth_status: EinvoicingOauthStatus
  oauth_connected_at: string | null
  super_pdp_connection_id: string | null
  // Granularite emission/reception : pilotees uniquement par le cockpit (config-sync),
  // jamais activables depuis l'instance cliente elle-meme. mode/oauth_status='connected'
  // ne suffisent plus a autoriser une operation de facturation electronique.
  emission_enabled: boolean
  reception_enabled: boolean
}

export const DEFAULT_EINVOICING_CONFIG: EinvoicingConfig = {
  mode: 'off',
  provider: null,
  environment: 'sandbox',
  annuaire_status: 'not_started',
  oauth_status: 'not_connected',
  oauth_connected_at: null,
  super_pdp_connection_id: null,
  emission_enabled: false,
  reception_enabled: false,
}

function isOneOf<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
}

function optionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const trimmed = String(value).trim()
  return trimmed || null
}

export function normalizeEinvoicingConfig(input: unknown): EinvoicingConfig {
  const source = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}

  const mode = isOneOf(EINVOICING_MODES, source.mode)
    ? source.mode
    : DEFAULT_EINVOICING_CONFIG.mode

  const provider =
    mode === 'super_pdp' ? 'super_pdp'
    : mode === 'export_only' ? 'external_pa'
    : null

  return {
    mode,
    provider,
    environment: isOneOf(EINVOICING_ENVIRONMENTS, source.environment)
      ? source.environment
      : DEFAULT_EINVOICING_CONFIG.environment,
    annuaire_status: mode === 'super_pdp' && isOneOf(EINVOICING_ANNUAIRE_STATUSES, source.annuaire_status)
      ? source.annuaire_status
      : DEFAULT_EINVOICING_CONFIG.annuaire_status,
    oauth_status: mode === 'super_pdp' && isOneOf(EINVOICING_OAUTH_STATUSES, source.oauth_status)
      ? source.oauth_status
      : DEFAULT_EINVOICING_CONFIG.oauth_status,
    oauth_connected_at: mode === 'super_pdp' ? optionalString(source.oauth_connected_at) : null,
    super_pdp_connection_id: mode === 'super_pdp' ? optionalString(source.super_pdp_connection_id) : null,
    emission_enabled: mode === 'super_pdp' && source.emission_enabled === true,
    reception_enabled: mode === 'super_pdp' && source.reception_enabled === true,
  }
}

export function normalizeEinvoicingConfigFromDb(input: Partial<EinvoicingConfig> | null | undefined): EinvoicingConfig {
  return normalizeEinvoicingConfig(input ?? DEFAULT_EINVOICING_CONFIG)
}
