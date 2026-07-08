export const SUBSCRIPTION_TIERS = ['setup_only', 'starter', 'pro', 'expert'] as const

export type SubscriptionTier = typeof SUBSCRIPTION_TIERS[number]

export const OVERFLOW_MODES = ['block', 'upgrade_prompt', 'charge'] as const

export type OverflowMode = typeof OVERFLOW_MODES[number]

export const QUOTA_UNITS = ['call', 'document', 'message', 'minute'] as const

export type QuotaUnit = typeof QUOTA_UNITS[number]

export const PRODUCT_MODULE_KEYS = [
  'relances_ai',
  'weekly_summary',
  'quote_ai',
  'planning_ai',
  'chantier_assistant',  // Assistant IA inline dans la fiche chantier (Starter+)
  'sarah_assistant',     // Sarah — widget global secrétaire métier (Pro+)
  'suggest_tasks',
  'catalog_ai',
  'document_import_ai',
  'chantier_report_ai',
  'labor_estimate_ai',
  'receipt_ocr',
  'voice_input',
  'voice_live',          // Mode vocal streaming live Sarah (Pro+ et Expert)
  'whatsapp_agent',
  'whatsapp_ocr',
  'whatsapp_proactive',
] as const

export type ProductModuleKey = typeof PRODUCT_MODULE_KEYS[number]

export type TechnicalQuotaFeature =
  | 'quote_analysis'
  | 'labor_estimate'
  | 'task_suggestion'
  | 'document_parse'
  | 'weekly_summary'
  | 'planning_ai'
  | 'whatsapp_reply'
  | 'whatsapp_transcription'
  | 'whatsapp_proactive'
  | 'whatsapp_document_ocr'
  | 'reminder_draft'
  | 'auto_reminder_draft'
  | 'email_draft'         // Rédaction email client via IA (Starter+, quota relances_ai)
  | 'chantier_report_summary'
  | 'chantier_assistant'
  | 'sarah_assistant'
  | 'catalog_extract'
  | 'receipt_ocr'
  | 'voice_transcription'
  | 'voice_live'

export type QuotaFeature =
  | 'relances_ai'
  | 'weekly_summary'
  | 'quote_ai'
  | 'planning_ai'
  | 'chantier_assistant'
  | 'sarah_assistant'
  | 'suggest_tasks'
  | 'catalog_ai'
  | 'document_import_ai'
  | 'chantier_report_ai'
  | 'labor_estimate_ai'
  | 'receipt_ocr'
  | 'voice_input'
  | 'voice_live_minutes'
  | 'wa_messages'
  | 'wa_vocal_minutes'
  | 'wa_proactive_messages'
  | 'whatsapp_ocr'

export type QuotaDefinition = {
  label: string
  unit: QuotaUnit
  moduleKey: ProductModuleKey
  section: 'ia_base' | 'whatsapp'
}

export const QUOTA_DEFINITIONS: Record<QuotaFeature, QuotaDefinition> = {
  relances_ai: { label: 'Relances IA', unit: 'call', moduleKey: 'relances_ai', section: 'ia_base' },
  weekly_summary: { label: 'Synthese hebdo', unit: 'call', moduleKey: 'weekly_summary', section: 'ia_base' },
  quote_ai: { label: 'Analyse devis', unit: 'call', moduleKey: 'quote_ai', section: 'ia_base' },
  planning_ai: { label: 'Planning IA', unit: 'call', moduleKey: 'planning_ai', section: 'ia_base' },
  chantier_assistant: { label: 'Assistant chantier IA', unit: 'call', moduleKey: 'chantier_assistant', section: 'ia_base' },
  sarah_assistant: { label: 'Sarah — secrétaire métier', unit: 'call', moduleKey: 'sarah_assistant', section: 'ia_base' },
  suggest_tasks: { label: 'Suggestions taches', unit: 'call', moduleKey: 'suggest_tasks', section: 'ia_base' },
  catalog_ai: { label: 'Catalogue IA', unit: 'call', moduleKey: 'catalog_ai', section: 'ia_base' },
  document_import_ai: { label: 'Import documents IA', unit: 'document', moduleKey: 'document_import_ai', section: 'ia_base' },
  chantier_report_ai: { label: 'Rapports chantier IA', unit: 'call', moduleKey: 'chantier_report_ai', section: 'ia_base' },
  labor_estimate_ai: { label: 'Estimation main d oeuvre', unit: 'call', moduleKey: 'labor_estimate_ai', section: 'ia_base' },
  receipt_ocr: { label: 'OCR tickets', unit: 'document', moduleKey: 'receipt_ocr', section: 'ia_base' },
  voice_input: { label: 'Saisie vocale (transcription)', unit: 'minute', moduleKey: 'voice_input', section: 'ia_base' },
  voice_live_minutes: { label: 'Vocal live Sarah', unit: 'minute', moduleKey: 'voice_live', section: 'ia_base' },
  wa_messages: { label: 'Messages WhatsApp', unit: 'message', moduleKey: 'whatsapp_agent', section: 'whatsapp' },
  wa_vocal_minutes: { label: 'Vocal WhatsApp', unit: 'minute', moduleKey: 'whatsapp_agent', section: 'whatsapp' },
  wa_proactive_messages: { label: 'WhatsApp proactif', unit: 'message', moduleKey: 'whatsapp_proactive', section: 'whatsapp' },
  whatsapp_ocr: { label: 'OCR WhatsApp', unit: 'document', moduleKey: 'whatsapp_ocr', section: 'whatsapp' },
}

export const QUOTA_FEATURES = Object.keys(QUOTA_DEFINITIONS) as QuotaFeature[]

export const TECHNICAL_FEATURE_TO_QUOTA: Record<TechnicalQuotaFeature, QuotaFeature> = {
  quote_analysis: 'quote_ai',
  labor_estimate: 'labor_estimate_ai',
  task_suggestion: 'suggest_tasks',
  document_parse: 'document_import_ai',
  weekly_summary: 'weekly_summary',
  planning_ai: 'planning_ai',
  whatsapp_reply: 'wa_messages',
  whatsapp_transcription: 'wa_vocal_minutes',
  whatsapp_proactive: 'wa_proactive_messages',
  whatsapp_document_ocr: 'whatsapp_ocr',
  reminder_draft: 'relances_ai',
  auto_reminder_draft: 'relances_ai',
  email_draft: 'relances_ai',    // Mails clients IA partagent le quota relances — Starter inclus
  chantier_report_summary: 'chantier_report_ai',
  chantier_assistant: 'chantier_assistant',
  sarah_assistant: 'sarah_assistant',
  catalog_extract: 'catalog_ai',
  receipt_ocr: 'receipt_ocr',
  voice_transcription: 'voice_input',
  voice_live: 'voice_live_minutes',
}

export const MODULES_BY_TIER: Record<SubscriptionTier, Record<ProductModuleKey, boolean>> = {
  setup_only: Object.fromEntries(PRODUCT_MODULE_KEYS.map((key) => [key, false])) as Record<ProductModuleKey, boolean>,
  starter: {
    relances_ai: true,
    weekly_summary: true,
    quote_ai: true,
    planning_ai: true,
    chantier_assistant: true,   // Assistant inline fiche chantier — Starter+
    sarah_assistant: false,     // Sarah widget global — Pro+
    suggest_tasks: true,
    catalog_ai: true,
    document_import_ai: true,
    chantier_report_ai: true,
    labor_estimate_ai: true,
    receipt_ocr: true,
    voice_input: true,
    voice_live: false,          // Vocal live — Pro+
    whatsapp_agent: false,
    whatsapp_ocr: false,
    whatsapp_proactive: false,
  },
  pro: {
    relances_ai: true,
    weekly_summary: true,
    quote_ai: true,
    planning_ai: true,
    chantier_assistant: true,
    sarah_assistant: true,      // Sarah widget global — Pro+
    suggest_tasks: true,
    catalog_ai: true,
    document_import_ai: true,
    chantier_report_ai: true,
    labor_estimate_ai: true,
    receipt_ocr: true,
    voice_input: true,
    voice_live: true,           // Vocal live inclus en Pro
    whatsapp_agent: false,      // WhatsApp suspendu (vérification Meta en attente)
    whatsapp_ocr: false,
    whatsapp_proactive: false,
  },
  // WhatsApp suspendu (vérification Meta en attente) : exclu explicitement même
  // en Expert, qui active tous les autres modules par défaut.
  expert: Object.fromEntries(
    PRODUCT_MODULE_KEYS.map((key) => [key, !key.startsWith('whatsapp_')])
  ) as Record<ProductModuleKey, boolean>,
}

const UNLIMITED = -1

export const QUOTAS_BY_TIER: Record<SubscriptionTier, Record<QuotaFeature, number>> = {
  setup_only: Object.fromEntries(QUOTA_FEATURES.map((key) => [key, 0])) as Record<QuotaFeature, number>,
  starter: {
    relances_ai: 20,
    weekly_summary: 8,
    quote_ai: 15,
    planning_ai: 10,
    chantier_assistant: 25,
    sarah_assistant: 0,         // Sarah Pro+ uniquement
    suggest_tasks: 15,
    catalog_ai: 10,
    document_import_ai: 15,
    chantier_report_ai: UNLIMITED,
    labor_estimate_ai: UNLIMITED,
    receipt_ocr: UNLIMITED,
    voice_input: 20,
    voice_live_minutes: 0,      // Vocal live — Pro+
    wa_messages: 0,
    wa_vocal_minutes: 0,
    wa_proactive_messages: 0,
    whatsapp_ocr: 0,
  },
  pro: {
    relances_ai: 60,
    weekly_summary: 12,
    quote_ai: 60,
    planning_ai: UNLIMITED,
    chantier_assistant: 120,    // 2 utilisateurs IA × 60 appels
    sarah_assistant: 120,       // 2 utilisateurs IA × 60 appels/mois
    suggest_tasks: 60,
    catalog_ai: 50,
    document_import_ai: 50,
    chantier_report_ai: UNLIMITED,
    labor_estimate_ai: UNLIMITED,
    receipt_ocr: UNLIMITED,
    voice_input: 120,
    voice_live_minutes: 60,     // ~2 min/jour ouvré — marge ElevenLabs préservée (~$6-7/mois)
    wa_messages: 0,
    wa_vocal_minutes: 0,
    wa_proactive_messages: 0,
    whatsapp_ocr: 0,
  },
  expert: {
    relances_ai: UNLIMITED,
    weekly_summary: UNLIMITED,
    quote_ai: UNLIMITED,
    planning_ai: UNLIMITED,
    chantier_assistant: UNLIMITED,
    sarah_assistant: UNLIMITED,
    suggest_tasks: UNLIMITED,
    catalog_ai: UNLIMITED,
    document_import_ai: UNLIMITED,
    chantier_report_ai: UNLIMITED,
    labor_estimate_ai: UNLIMITED,
    receipt_ocr: UNLIMITED,
    voice_input: UNLIMITED,
    voice_live_minutes: 300,    // ~10 min/jour ouvré — ElevenLabs ~$30-36/mois (couvert par hausse Expert 119→139€)
    wa_messages: 0,
    wa_vocal_minutes: 0,
    wa_proactive_messages: 0,
    whatsapp_ocr: 0,
  },
}

export function isSubscriptionTier(value: string): value is SubscriptionTier {
  return (SUBSCRIPTION_TIERS as readonly string[]).includes(value)
}

export function isOverflowMode(value: string): value is OverflowMode {
  return (OVERFLOW_MODES as readonly string[]).includes(value)
}

export function isQuotaFeature(value: string): value is QuotaFeature {
  return (QUOTA_FEATURES as readonly string[]).includes(value)
}

export function getQuotaFeatureForTechnicalFeature(feature: string): QuotaFeature | null {
  return (TECHNICAL_FEATURE_TO_QUOTA as Record<string, QuotaFeature | undefined>)[feature] ?? null
}

export function getQuotaConfigForTier(tier: SubscriptionTier): Record<QuotaFeature, number> {
  return { ...QUOTAS_BY_TIER[tier] }
}

export function getModulesForTier(tier: SubscriptionTier): Record<ProductModuleKey, boolean> {
  return { ...MODULES_BY_TIER[tier] }
}

export function getQuotaUnit(feature: QuotaFeature): QuotaUnit {
  return QUOTA_DEFINITIONS[feature].unit
}
