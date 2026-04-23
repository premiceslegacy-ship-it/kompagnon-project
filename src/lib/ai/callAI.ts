import { createAdminClient } from '@/lib/supabase/admin'
import { isModuleEnabledAdmin } from '@/lib/data/queries/organization-modules'
import type { OrganizationModuleKey } from '@/lib/organization-modules'
import { getOperatorSourceInstance, signOperatorPayload, type OperatorUsageEventPayload } from '@/lib/operator'

export type AIProvider = 'openrouter' | 'mistral'
export type AIInputKind = 'text' | 'image' | 'audio' | 'mixed'

export type AIFeature =
  | 'quote_analysis'
  | 'labor_estimate'
  | 'task_suggestion'
  | 'document_parse'
  | 'weekly_summary'
  | 'planning_ai'
  | 'whatsapp_reply'
  | 'whatsapp_transcription'
  | 'reminder_draft'
  | 'auto_reminder_draft'
  | 'chantier_report_summary'

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
const MISTRAL_TRANSCRIPTION_URL = 'https://api.mistral.ai/v1/audio/transcriptions'

const MODULE_BY_FEATURE: Record<AIFeature, OrganizationModuleKey> = {
  quote_analysis: 'quote_ai',
  labor_estimate: 'quote_ai',
  task_suggestion: 'planning_ai',
  document_parse: 'document_ai',
  weekly_summary: 'planning_ai',
  planning_ai: 'planning_ai',
  whatsapp_reply: 'whatsapp_agent',
  whatsapp_transcription: 'whatsapp_agent',
  reminder_draft: 'quote_ai',
  auto_reminder_draft: 'quote_ai',
  chantier_report_summary: 'quote_ai',
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
}

function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
}

function getOpenRouterHeaders(extraHeaders?: Record<string, string>): HeadersInit {
  return {
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY ?? ''}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': getAppUrl(),
    'X-Title': process.env.NEXT_PUBLIC_APP_NAME ?? 'ATELIER',
    ...extraHeaders,
  }
}

function buildUsageMetrics(provider: AIProvider, rawUsage: Record<string, unknown> | null | undefined): AIUsageMetrics {
  const usage = rawUsage ?? {}
  const promptTokens = typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : null
  const completionTokens = typeof usage.completion_tokens === 'number' ? usage.completion_tokens : null
  const totalTokens = typeof usage.total_tokens === 'number' ? usage.total_tokens : null
  const providerCost = typeof usage.cost === 'number' ? usage.cost : null

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    providerCost: provider === 'openrouter' ? providerCost : providerCost,
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
    })
    .select('id')
    .single()

  if (error) {
    console.error('[callAI.insertUsageLog]', error)
    return null
  }

  return data?.id ?? null
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
  const signature = signOperatorPayload(body, secret)

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-operator-signature': signature,
    },
    body,
  })

  if (!response.ok) {
    throw new Error(`Operator ingest ${response.status}: ${await response.text()}`)
  }
}

async function syncUsageLogToOperator(logId: string | null, payload: Omit<OperatorUsageEventPayload, 'local_usage_log_id'>) {
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
  await ensureFeatureEnabled(params.organizationId, params.feature)

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

    if (params.provider === 'openrouter') {
      if (!process.env.OPENROUTER_API_KEY) {
        throw new Error('OPENROUTER_API_KEY manquante')
      }

      const body = {
        ...(params.request.body as Record<string, unknown>),
        model: params.model,
        user: params.organizationId,
      }
      const timeout = withTimeout(params.request.timeoutMs)

      try {
        const response = await fetch(OPENROUTER_URL, {
          method: 'POST',
          signal: timeout.signal,
          headers: getOpenRouterHeaders(params.request.headers),
          body: JSON.stringify(body),
        })

        if (!response.ok) {
          throw new Error(`OpenRouter ${response.status}: ${await response.text()}`)
        }

        data = await response.json() as T
      } finally {
        timeout.cleanup()
      }
    } else {
      if (!process.env.MISTRAL_API_KEY) {
        throw new Error('MISTRAL_API_KEY manquante')
      }

      if (!(params.request.body instanceof FormData)) {
        throw new Error('La requête Mistral attend un FormData')
      }

      const timeout = withTimeout(params.request.timeoutMs)

      try {
        const response = await fetch(MISTRAL_TRANSCRIPTION_URL, {
          method: 'POST',
          signal: timeout.signal,
          headers: {
            Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
            ...(params.request.headers ?? {}),
          },
          body: params.request.body,
        })

        if (!response.ok) {
          throw new Error(`Mistral ${response.status}: ${await response.text()}`)
        }

        data = await response.json() as T
      } finally {
        timeout.cleanup()
      }
    }

    const raw = data as Record<string, unknown>
    usage = buildUsageMetrics(params.provider, raw.usage as Record<string, unknown> | undefined)
    externalRequestId = typeof raw.id === 'string' ? raw.id : null
    const latencyMs = Date.now() - startedAt

    const logId = await insertUsageLog({
      organizationId: params.organizationId,
      provider: params.provider,
      feature: params.feature,
      model: params.model,
      inputKind: params.inputKind,
      status: 'success',
      usage,
      externalRequestId,
      metadata: params.metadata ?? null,
    })

    // Best effort by design: on ne bloque jamais la réponse métier sur le cockpit opérateur.
    // En cas de crash du process entre l'insert local et ce lancement asynchrone,
    // certains events peuvent rester orphelins avec operator_sync_status = 'pending'.
    void syncUsageLogToOperator(logId, {
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

    const logId = await insertUsageLog({
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
    })

    // Même stratégie best effort côté erreur: on conserve le log local comme source de vérité
    // et on tente la remontée opérateur sans impacter la réponse envoyée au caller.
    void syncUsageLogToOperator(logId, {
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
      metadata: {
        ...(params.metadata ?? {}),
        error: errorMessage,
      },
    })

    throw error
  }
}
