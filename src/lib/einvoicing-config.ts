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
  // Granularite emission/reception : self-service cote client (Settings et onboarding),
  // le cockpit garde la capacite d'ecrire ces flags directement pour intervenir sur un
  // compte precis, mais n'est plus le chemin principal. mode/oauth_status='connected'
  // ne suffisent pas a eux seuls a autoriser une operation de facturation electronique.
  emission_enabled: boolean
  reception_enabled: boolean
  // Horodatage du dernier choix explicite du client sur chaque flag -- preuve de
  // consentement eclaire, notamment pour la desactivation de la reception (obligatoire
  // par la loi depuis le 01/09/2026, sans derogation possible).
  emission_consent_at: string | null
  reception_consent_at: string | null
  // Intention exprimee a l'onboarding, avant toute connexion Super PDP (voir
  // src/app/onboarding/actions.ts, saveEinvoicingOnboardingIntent). N'active rien par
  // elle-meme -- sert uniquement a afficher un rappel cible dans les Settings.
  onboarding_intent: 'activate' | 'later' | null
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
  emission_consent_at: null,
  reception_consent_at: null,
  onboarding_intent: null,
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
    emission_consent_at: mode === 'super_pdp' ? optionalString(source.emission_consent_at) : null,
    reception_consent_at: mode === 'super_pdp' ? optionalString(source.reception_consent_at) : null,
    // Contrairement aux champs ci-dessus, reste lisible même hors mode 'super_pdp' :
    // c'est une intention exprimée avant toute connexion.
    onboarding_intent: source.onboarding_intent === 'activate' || source.onboarding_intent === 'later'
      ? source.onboarding_intent
      : null,
  }
}

export function normalizeEinvoicingConfigFromDb(input: Partial<EinvoicingConfig> | null | undefined): EinvoicingConfig {
  return normalizeEinvoicingConfig(input ?? DEFAULT_EINVOICING_CONFIG)
}
