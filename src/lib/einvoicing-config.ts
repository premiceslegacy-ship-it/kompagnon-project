export const EINVOICING_MODES = ['off', 'export_only', 'b2brouter'] as const
export const EINVOICING_PROVIDERS = ['external_pa', 'b2brouter'] as const
export const EINVOICING_ENVIRONMENTS = ['sandbox', 'production'] as const
export const EINVOICING_ONBOARDING_MODELS = ['edoc_exchange', 'edoc_sync'] as const
export const EINVOICING_ANNUAIRE_STATUSES = ['not_started', 'pending', 'active', 'error'] as const

export type EinvoicingMode = typeof EINVOICING_MODES[number]
export type EinvoicingProvider = typeof EINVOICING_PROVIDERS[number]
export type EinvoicingEnvironment = typeof EINVOICING_ENVIRONMENTS[number]
export type EinvoicingOnboardingModel = typeof EINVOICING_ONBOARDING_MODELS[number]
export type EinvoicingAnnuaireStatus = typeof EINVOICING_ANNUAIRE_STATUSES[number]

export type EinvoicingConfig = {
  mode: EinvoicingMode
  provider: EinvoicingProvider | null
  environment: EinvoicingEnvironment
  onboarding_model: EinvoicingOnboardingModel | null
  b2brouter_account_id: string | null
  annuaire_status: EinvoicingAnnuaireStatus
}

export const DEFAULT_EINVOICING_CONFIG: EinvoicingConfig = {
  mode: 'off',
  provider: null,
  environment: 'sandbox',
  onboarding_model: null,
  b2brouter_account_id: null,
  annuaire_status: 'not_started',
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
    mode === 'b2brouter' ? 'b2brouter'
    : mode === 'export_only' ? 'external_pa'
    : null

  const onboardingModel = mode === 'b2brouter'
    ? isOneOf(EINVOICING_ONBOARDING_MODELS, source.onboarding_model)
      ? source.onboarding_model
      : 'edoc_exchange'
    : null

  return {
    mode,
    provider,
    environment: isOneOf(EINVOICING_ENVIRONMENTS, source.environment)
      ? source.environment
      : DEFAULT_EINVOICING_CONFIG.environment,
    onboarding_model: onboardingModel,
    b2brouter_account_id: mode === 'b2brouter' ? optionalString(source.b2brouter_account_id) : null,
    annuaire_status: mode === 'b2brouter' && isOneOf(EINVOICING_ANNUAIRE_STATUSES, source.annuaire_status)
      ? source.annuaire_status
      : DEFAULT_EINVOICING_CONFIG.annuaire_status,
  }
}

export function normalizeEinvoicingConfigFromDb(input: Partial<EinvoicingConfig> | null | undefined): EinvoicingConfig {
  return normalizeEinvoicingConfig(input ?? DEFAULT_EINVOICING_CONFIG)
}
