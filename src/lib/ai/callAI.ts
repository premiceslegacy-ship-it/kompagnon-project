import { createAdminClient } from '@/lib/supabase/admin'
import { isModuleEnabledAdmin } from '@/lib/data/queries/organization-modules'
import type { OrganizationModuleKey } from '@/lib/organization-modules'
import { getOperatorSourceInstance, signOperatorRequest, OPERATOR_TIMESTAMP_HEADER, type OperatorUsageEventPayload } from '@/lib/operator'
import { checkAIRateLimit } from '@/lib/rate-limit'
import { AIQuotaExceededError, checkQuota, type AIBillingMode, type QuotaCheckResult } from '@/lib/quota'
import { getOrganizationOpenRouterKey } from '@/lib/ai/openrouter-credentials'

export type AIProvider = 'openrouter'
export type AIInputKind = 'text' | 'image' | 'audio' | 'mixed'

export type AIFeature =
  | 'quote_analysis'
  | 'labor_estimate'
  | 'task_suggestion'
  | 'document_parse'
  | 'receipt_ocr'
  | 'weekly_summary'
  | 'planning_ai'
  | 'voice_transcription'
  | 'reminder_draft'
  | 'auto_reminder_draft'
  | 'email_draft'
  | 'chantier_report_summary'
  | 'chantier_assistant'
  | 'sarah_assistant'
  | 'catalog_extract'

type AIUsageLogStatus = 'success' | 'error'

type AIRequest = {
  body: FormData | Record<string, unknown>
  headers?: Record<string, string>
  timeoutMs?: number
}

export type CallAIParams = {
  organizationId: string
  provider: AIProvider
  feature: AIFeature
  model: string
  inputKind: AIInputKind
  request: AIRequest
  metadata?: Record<string, unknown> | null
  quotaQuantity?: number
}

export type AIUsageMetrics = {
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  providerCost: number | null
  currency: string
}

export type CallAIResult<T> = {
  data: T
  usage: AIUsageMetrics
  externalRequestId: string | null
  latencyMs: number
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const OPENROUTER_TRANSCRIPTION_URL = 'https://openrouter.ai/api/v1/audio/transcriptions'

const MODULE_BY_FEATURE: Record<AIFeature, OrganizationModuleKey> = {
  quote_analysis: 'quote_ai',
  labor_estimate: 'labor_estimate_ai',
  task_suggestion: 'suggest_tasks',
  document_parse: 'document_import_ai',
  receipt_ocr: 'receipt_ocr',
  weekly_summary: 'weekly_summary',
  planning_ai: 'planning_ai',
  voice_transcription: 'voice_input',
  reminder_draft: 'relances_ai',
  auto_reminder_draft: 'relances_ai',
  email_draft: 'relances_ai',
  chantier_report_summary: 'chantier_report_ai',
  chantier_assistant: 'chantier_assistant',
  sarah_assistant: 'sarah_assistant',
  catalog_extract: 'catalog_ai',
}

export class AIModuleDisabledError extends Error {
  readonly moduleKey: OrganizationModuleKey
  readonly feature: AIFeature

  constructor(moduleKey: OrganizationModuleKey, feature: AIFeature) {
    super(`Le module "${moduleKey}" n'est pas activé pour la feature "${feature}".`)
    this.name = 'AIModuleDisabledError'
    this.moduleKey = moduleKey
    this.feature = feature
  }
}

export class AIRateLimitError extends Error {
  readonly feature: AIFeature
  readonly limit: number
  readonly windowSeconds: number

  constructor(feature: AIFeature, limit: number, windowSeconds: number) {
    super('Trop de requêtes IA pour cette organisation. Réessayez plus tard.')
    this.name = 'AIRateLimitError'
    this.feature = feature
    this.limit = limit
    this.windowSeconds = windowSeconds
  }
}

export class AIProviderCreditError extends Error {
  readonly provider: AIProvider
  readonly aiBillingMode: AIBillingMode
  readonly status: number | null

  constructor(provider: AIProvider, aiBillingMode: AIBillingMode, status: number | null, message?: string) {
    super(message ?? 'Crédits ou limite provider IA atteints.')
    this.name = 'AIProviderCreditError'
    this.provider = provider
    this.aiBillingMode = aiBillingMode
    this.status = status
  }
}
export class AIQuotaUnavailableError extends Error {
  readonly feature: AIFeature

  constructor(feature: AIFeature) {
    super('La vérification du quota IA est indisponible. Réessayez plus tard.')
    this.name = 'AIQuotaUnavailableError'
    this.feature = feature
  }
}


type LogUsageParams = {
  organizationId: string
  provider: AIProvider
  feature: AIFeature
  model: string
  inputKind: AIInputKind
  status: AIUsageLogStatus
  usage: AIUsageMetrics
  externalRequestId: string | null
  metadata: Record<string, unknown> | null
  quotaCheck: QuotaCheckResult | null
}

function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
}

function getOpenRouterHeaders(apiKey: string, extraHeaders?: Record<string, string>): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': getAppUrl(),
    'X-Title': process.env.NEXT_PUBLIC_APP_NAME ?? 'ATELIER',
    ...extraHeaders,
  }
}

// Pas de Content-Type ici : le body est un FormData multipart, fetch pose lui-même
// le boundary. En fixer un manuellement casserait l'encodage de la requête.
function getOpenRouterAudioHeaders(apiKey: string, extraHeaders?: Record<string, string>): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    'HTTP-Referer': getAppUrl(),
    'X-Title': process.env.NEXT_PUBLIC_APP_NAME ?? 'ATELIER',
    ...extraHeaders,
  }
}

function buildUsageMetrics(rawUsage: Record<string, unknown> | null | undefined): AIUsageMetrics {
  const usage = rawUsage ?? {}
  const promptTokens = typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : null
  const completionTokens = typeof usage.completion_tokens === 'number' ? usage.completion_tokens : null
  const totalTokens = typeof usage.total_tokens === 'number' ? usage.total_tokens : null
  const providerCost = typeof usage.cost === 'number' ? usage.cost : null

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    providerCost,
    currency: 'USD',
  }
}

async function insertUsageLog(params: LogUsageParams): Promise<string | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('usage_logs')
    .insert({
      organization_id: params.organizationId,
      provider: params.provider,
      feature: params.feature,
      model: params.model,
      input_kind: params.inputKind,
      status: params.status,
      prompt_tokens: params.usage.promptTokens,
      completion_tokens: params.usage.completionTokens,
      total_tokens: params.usage.totalTokens,
      provider_cost: params.usage.providerCost,
      currency: params.usage.currency,
      external_request_id: params.externalRequestId,
      metadata: params.metadata ?? null,
      quota_feature: params.quotaCheck?.quotaFeature ?? null,
      quota_unit: params.quotaCheck?.quotaUnit ?? null,
      quota_quantity: params.quotaCheck?.requestedQuantity ?? 1,
      overflow_mode: params.quotaCheck?.overflowMode ?? null,
      over_quota: params.quotaCheck?.overQuota ?? false,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[callAI.insertUsageLog]', error)
    return null
  }

  return data?.id ?? null
}

/**
 * Clôt la ligne réservée par `reserve_quota` (elle compte déjà dans le quota)
 * ou, à défaut de réservation, insère une ligne complète. Insérer une seconde
 * ligne doublerait la consommation comptée.
 */
async function settleUsageLog(params: LogUsageParams & { reservationId: string | null }): Promise<string | null> {
  if (!params.reservationId) return insertUsageLog(params)

  const admin = createAdminClient()
  // Deux tentatives : une réservation laissée ouverte bloque le quota jusqu'à
  // la réconciliation (`expire_stale_quota_reservations`), qui ne passe
  // qu'après 30 minutes. La ligne porte déjà son id, ce n'est pas bloquant.
  for (const attempt of [1, 2]) {
    const { error } = await admin
      .from('usage_logs')
      .update({
        status: params.status,
        prompt_tokens: params.usage.promptTokens,
        completion_tokens: params.usage.completionTokens,
        total_tokens: params.usage.totalTokens,
        provider_cost: params.usage.providerCost,
        currency: params.usage.currency,
        external_request_id: params.externalRequestId,
        metadata: params.metadata ?? null,
        over_quota: params.quotaCheck?.overQuota ?? false,
      })
      .eq('id', params.reservationId)

    if (!error) return params.reservationId
    console.error(`[callAI.settleUsageLog] tentative ${attempt}`, error)
  }

  return params.reservationId
}

async function updateUsageLogSyncState(logId: string, state: {
  status: 'synced' | 'failed' | 'skipped'
  error?: string | null
  syncedAt?: string | null
}) {
  const admin = createAdminClient()
  const { error } = await admin
    .from('usage_logs')
    .update({
      operator_sync_status: state.status,
      operator_sync_error: state.error ?? null,
      operator_synced_at: state.syncedAt ?? null,
    })
    .eq('id', logId)

  if (error) {
    console.error('[callAI.updateUsageLogSyncState]', error)
  }
}

async function pushUsageEventToOperator(payload: OperatorUsageEventPayload): Promise<void> {
  const url = process.env.OPERATOR_INGEST_URL?.trim()
  const secret = process.env.OPERATOR_INGEST_SECRET?.trim()

  if (!url || !secret) {
    throw new Error('Operator ingest env vars missing')
  }

  const body = JSON.stringify(payload)
  const { signature, timestamp } = signOperatorRequest(body, secret)

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-operator-signature': signature,
        [OPERATOR_TIMESTAMP_HEADER]: timestamp,
    },
    body,
  })

  if (!response.ok) {
    throw new Error(`Operator ingest ${response.status}: ${await response.text()}`)
  }
}

export async function syncUsageLogToOperator(logId: string | null, payload: Omit<OperatorUsageEventPayload, 'local_usage_log_id'>) {
  if (!logId) return

  const url = process.env.OPERATOR_INGEST_URL?.trim()
  const secret = process.env.OPERATOR_INGEST_SECRET?.trim()
  if (!url || !secret) {
    await updateUsageLogSyncState(logId, { status: 'skipped' })
    return
  }

  try {
    await pushUsageEventToOperator({
      ...payload,
      local_usage_log_id: logId,
    })

    await updateUsageLogSyncState(logId, {
      status: 'synced',
      syncedAt: new Date().toISOString(),
    })
  } catch (error) {
    await updateUsageLogSyncState(logId, {
      status: 'failed',
      error: error instanceof Error ? error.message : 'Operator ingest failed',
    })
  }
}

async function ensureFeatureEnabled(organizationId: string, feature: AIFeature) {
  const moduleKey = MODULE_BY_FEATURE[feature]
  const enabled = await isModuleEnabledAdmin(organizationId, moduleKey)

  if (!enabled) {
    throw new AIModuleDisabledError(moduleKey, feature)
  }
}

function withTimeout(timeoutMs: number | undefined) {
  if (!timeoutMs) return { signal: undefined as AbortSignal | undefined, cleanup: () => undefined }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer),
  }
}

export async function callAI<T>(params: CallAIParams): Promise<CallAIResult<T>> {
  const [quotaCheck, rateLimit] = await Promise.all([
    checkQuota({
      supabase: createAdminClient(),
      organizationId: params.organizationId,
      technicalFeature: params.feature,
      quantity: params.quotaQuantity ?? 1,
      reserve: true,
      provider: params.provider,
      model: params.model,
      inputKind: params.inputKind,
    }),
    checkAIRateLimit({
      organizationId: params.organizationId,
      feature: params.feature,
    }),
  ])

  // Une réservation posée puis refusée plus bas ne serait jamais close et
  // consommerait le quota à chaque tentative : on la relâche avant de lever.
  async function releaseReservation() {
    if (quotaCheck.reservationId) {
      await createAdminClient()
        .from('usage_logs')
        .delete()
        .eq('id', quotaCheck.reservationId)
        .eq('status', 'reserved')
    }
  }

  try {
    if (quotaCheck.aiBillingMode !== 'client_owned') {
      await ensureFeatureEnabled(params.organizationId, params.feature)
    }
  } catch (error) {
    await releaseReservation()
    throw error
  }

  if (!quotaCheck.allowed) {
    await releaseReservation()
    if (quotaCheck.quotaFeature && quotaCheck.quotaMonthly !== null) {
      throw new AIQuotaExceededError({
        quotaFeature: quotaCheck.quotaFeature,
        quotaMonthly: quotaCheck.quotaMonthly,
        usedQuantity: quotaCheck.usedQuantity,
        requestedQuantity: quotaCheck.requestedQuantity,
      })
    }
    throw new AIQuotaUnavailableError(params.feature)
  }
  if (!rateLimit.allowed) {
    await releaseReservation()
    throw new AIRateLimitError(params.feature, rateLimit.limit, rateLimit.windowSeconds)
  }

  const occurredAt = new Date().toISOString()
  const startedAt = Date.now()

  let usage: AIUsageMetrics = {
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
    providerCost: null,
    currency: 'USD',
  }
  let externalRequestId: string | null = null

  try {
    let data: T

    // client_owned : la clé du client vit soit dans organization_ai_credentials
    // (mutualisé, plusieurs orgs sur le même Worker), soit directement dans
    // OPENROUTER_API_KEY du Worker (modèle dédié historique, 1 org par instance
    // : le client fournit sa clé au provisioning, voir scripts/deploy-client.sh)
    // — les deux sont "la clé de ce client", pas orsayn_shared vs client_owned.
    const apiKey = quotaCheck.aiBillingMode === 'client_owned'
      ? (await getOrganizationOpenRouterKey(params.organizationId)) ?? process.env.OPENROUTER_API_KEY ?? null
      : process.env.OPENROUTER_API_KEY ?? null

    if (!apiKey) {
      if (quotaCheck.aiBillingMode === 'client_owned') {
        throw new AIProviderCreditError('openrouter', quotaCheck.aiBillingMode, null, 'Clé OpenRouter client manquante.')
      }
      throw new Error('OPENROUTER_API_KEY manquante')
    }

    const timeout = withTimeout(params.request.timeoutMs)

    try {
      const isAudio = params.inputKind === 'audio'

      if (isAudio && !(params.request.body instanceof FormData)) {
        throw new Error('La requête de transcription attend un FormData')
      }

      const response = isAudio
        ? await fetch(OPENROUTER_TRANSCRIPTION_URL, {
            method: 'POST',
            signal: timeout.signal,
            headers: getOpenRouterAudioHeaders(apiKey, params.request.headers),
            body: params.request.body as FormData,
          })
        : await fetch(OPENROUTER_URL, {
            method: 'POST',
            signal: timeout.signal,
            headers: getOpenRouterHeaders(apiKey, params.request.headers),
            body: JSON.stringify({
              ...(params.request.body as Record<string, unknown>),
              model: params.model,
              user: params.organizationId,
              // Sans ce flag, OpenRouter n'inclut pas `usage.cost` dans la
              // réponse : provider_cost reste NULL en base et le cockpit
              // agrège 0 € pour tout le monde, silencieusement.
              usage: { include: true },
            }),
          })

      if (!response.ok) {
        const errorText = await response.text()
        if (quotaCheck.aiBillingMode === 'client_owned' && [401, 402, 429].includes(response.status)) {
          throw new AIProviderCreditError('openrouter', quotaCheck.aiBillingMode, response.status, `OpenRouter ${response.status}: ${errorText}`)
        }
        throw new Error(`OpenRouter ${response.status}: ${errorText}`)
      }

      data = await response.json() as T
    } finally {
      timeout.cleanup()
    }

    const raw = data as Record<string, unknown>
    usage = buildUsageMetrics(raw.usage as Record<string, unknown> | undefined)
    externalRequestId = typeof raw.id === 'string' ? raw.id : null
    const latencyMs = Date.now() - startedAt

    const logId = await settleUsageLog({
      reservationId: quotaCheck.reservationId ?? null,
      organizationId: params.organizationId,
      provider: params.provider,
      feature: params.feature,
      model: params.model,
      inputKind: params.inputKind,
      status: 'success',
      usage,
      externalRequestId,
      metadata: params.metadata ?? null,
      quotaCheck,
    })

    // La synchronisation doit être attendue sur Cloudflare : une promesse détachée
    // peut être interrompue dès que la réponse HTTP est renvoyée. La fonction
    // absorbe elle-même les erreurs et marque le log `failed`, donc l'appel métier
    // reste disponible même si le cockpit est momentanément indisponible.
    await syncUsageLogToOperator(logId, {
      source_instance: getOperatorSourceInstance(),
      organization_id: params.organizationId,
      occurred_at: occurredAt,
      provider: params.provider,
      feature: params.feature,
      model: params.model,
      provider_cost: usage.providerCost,
      currency: usage.currency,
      total_tokens: usage.totalTokens,
      status: 'success',
      quota_feature: quotaCheck.quotaFeature,
      quota_unit: quotaCheck.quotaUnit,
      quota_quantity: quotaCheck.requestedQuantity,
      overflow_mode: quotaCheck.overflowMode,
      over_quota: quotaCheck.overQuota,
      metadata: params.metadata ?? null,
    })

    return {
      data,
      usage,
      externalRequestId,
      latencyMs,
    }
  } catch (error) {
    const latencyMs = Date.now() - startedAt
    const errorMessage = error instanceof Error ? error.message : 'Erreur IA inconnue'

    const logId = await settleUsageLog({
      reservationId: quotaCheck.reservationId ?? null,
      organizationId: params.organizationId,
      provider: params.provider,
      feature: params.feature,
      model: params.model,
      inputKind: params.inputKind,
      status: 'error',
      usage,
      externalRequestId,
      metadata: {
        ...(params.metadata ?? {}),
        error: errorMessage,
        latency_ms: latencyMs,
      },
      quotaCheck,
    })

    // Même garantie côté erreur : le journal local reste la source de vérité et
    // la tentative opérateur est terminée (ou marquée failed) avant de répondre.
    await syncUsageLogToOperator(logId, {
      source_instance: getOperatorSourceInstance(),
      organization_id: params.organizationId,
      occurred_at: occurredAt,
      provider: params.provider,
      feature: params.feature,
      model: params.model,
      provider_cost: usage.providerCost,
      currency: usage.currency,
      total_tokens: usage.totalTokens,
      status: 'error',
      quota_feature: quotaCheck.quotaFeature,
      quota_unit: quotaCheck.quotaUnit,
      quota_quantity: quotaCheck.requestedQuantity,
      overflow_mode: quotaCheck.overflowMode,
      over_quota: quotaCheck.overQuota,
      metadata: {
        ...(params.metadata ?? {}),
        error: errorMessage,
      },
    })

    throw error
  }
}
