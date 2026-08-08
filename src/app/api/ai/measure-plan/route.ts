import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { getCurrentMembershipContext, hasPermission } from '@/lib/data/queries/membership'
import { getBusinessActivityById, normalizeSecondaryActivityIds } from '@/lib/catalog-context'
import { APP_NAME } from '@/lib/brand'
import { AIModuleDisabledError, AIProviderCreditError, AIRateLimitError, callAI } from '@/lib/ai/callAI'
import { buildDocumentContentBlock, buildPdfParserPlugins, validatePdfForVision, type PdfParserPlugin } from '@/lib/ai/document-content'
import { AIQuotaExceededError } from '@/lib/quota'
import { getVerticalPackDefinition } from '@/lib/vertical-packs'
import {
  DEFAULT_MEASUREMENT_SETTINGS,
  PLAN_MEASUREMENT_RULES_VERSION,
  PLAN_MEASUREMENT_TRADES,
  buildMeasurementItems,
  inferMeasurementTrades,
  type MeasurementEvidence,
  type PlanMeasurementOpening,
  type PlanMeasurementObservation,
  type PlanMeasurementResult,
  type PlanMeasurementRoom,
  type PlanMeasurementScope,
  type PlanMeasurementSettings,
  type PlanMeasurementTrade,
  type PlanProjectType,
  type PlanWorkScope,
} from '@/lib/plan-measurement'

export type { PlanMeasurementItem, PlanMeasurementResult, PlanMeasurementRoom } from '@/lib/plan-measurement'

export const maxDuration = 150

const VISION_MODEL = 'google/gemini-2.5-flash'
const MODEL_TIMEOUT_MS = 55_000
const ACCEPTED_MIME_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'])
const TRADE_SET = new Set<string>(PLAN_MEASUREMENT_TRADES)
const WORK_SCOPE_SET = new Set<PlanWorkScope>(['create', 'replace', 'remove', 'preserve'])

type RawPlanFacts = {
  title?: unknown
  rooms?: unknown
  openings?: unknown
  observations?: unknown
  globalWarnings?: unknown
  scale?: unknown
  needsCalibration?: unknown
}

const PLAN_FACTS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'rooms', 'openings', 'observations', 'globalWarnings', 'scale', 'needsCalibration'],
  properties: {
    title: { type: 'string' },
    rooms: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['name', 'kind', 'area_m2', 'perimeter_m', 'height_m', 'confidence', 'evidence', 'assumptions', 'warnings'],
        properties: {
          name: { type: 'string' },
          kind: { type: 'string', enum: ['interior', 'exterior'] },
          area_m2: { type: ['number', 'null'] }, perimeter_m: { type: ['number', 'null'] }, height_m: { type: ['number', 'null'] },
          confidence: { type: ['number', 'null'] },
          evidence: { type: 'array', items: { $ref: '#/$defs/evidence' } },
          assumptions: { type: 'array', items: { type: 'string' } }, warnings: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    openings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['roomName', 'type', 'quantity', 'width_m', 'height_m', 'confidence', 'evidence', 'warnings'],
        properties: {
          roomName: { type: 'string' }, type: { type: 'string', enum: ['door', 'window', 'bay', 'other'] }, quantity: { type: 'number' },
          width_m: { type: ['number', 'null'] }, height_m: { type: ['number', 'null'] }, confidence: { type: ['number', 'null'] },
          evidence: { type: 'array', items: { $ref: '#/$defs/evidence' } }, warnings: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    observations: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['roomName', 'type', 'label', 'quantity', 'confidence', 'evidence', 'warnings'],
        properties: {
          roomName: { type: 'string' }, type: { type: 'string', enum: ['fixture', 'electrical_symbol', 'plumbing_symbol', 'equipment', 'other'] },
          label: { type: 'string' }, quantity: { type: 'number' }, confidence: { type: ['number', 'null'] },
          evidence: { type: 'array', items: { $ref: '#/$defs/evidence' } }, warnings: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    globalWarnings: { type: 'array', items: { type: 'string' } },
    scale: {
      type: 'object', additionalProperties: false, required: ['detected', 'value', 'confidence', 'needsCalibration', 'evidence', 'assumptions'],
      properties: {
        detected: { type: 'boolean' }, value: { type: ['string', 'null'] }, confidence: { type: ['number', 'null'] }, needsCalibration: { type: 'boolean' },
        evidence: { type: 'array', items: { $ref: '#/$defs/evidence' } }, assumptions: { type: 'array', items: { type: 'string' } },
      },
    },
    needsCalibration: { type: 'boolean' },
  },
  $defs: {
    evidence: {
      type: 'object', additionalProperties: false, required: ['label', 'source', 'value'],
      properties: {
        label: { type: 'string' },
        source: { type: 'string', enum: ['printed_dimension', 'printed_area', 'scale', 'plan_label', 'visible_symbol', 'user_input', 'assumption'] },
        value: { type: ['string', 'null'] },
      },
    },
  },
} as const

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  const object = text.match(/\{[\s\S]*\}/)
  return object ? object[0] : text.trim()
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(',', '.')) : NaN
  return Number.isFinite(parsed) ? parsed : fallback
}

function asNullablePositiveNumber(value: unknown): number | null {
  if (value == null) return null
  const parsed = asNumber(value, NaN)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function asStringArray(value: unknown, limit = 8): string[] {
  return Array.isArray(value) ? value.map(item => String(item ?? '').trim()).filter(Boolean).slice(0, limit) : []
}

function clampConfidence(value: unknown): number | null {
  const parsed = asNumber(value, NaN)
  if (!Number.isFinite(parsed)) return null
  return Math.max(0, Math.min(1, parsed > 1 ? parsed / 100 : parsed))
}

function stableId(prefix: string, label: string, index: number): string {
  const slug = label.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  return `${prefix}-${slug || 'zone'}-${index + 1}`
}

function normalizeEvidence(value: unknown): MeasurementEvidence[] {
  if (!Array.isArray(value)) return []
  const allowed = new Set<MeasurementEvidence['source']>(['printed_dimension', 'printed_area', 'scale', 'plan_label', 'visible_symbol', 'user_input', 'assumption'])
  return value.flatMap(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
    const evidence = raw as Record<string, unknown>
    const label = String(evidence.label ?? '').trim()
    const source = String(evidence.source ?? '') as MeasurementEvidence['source']
    if (!label || !allowed.has(source)) return []
    return [{ label, source, value: evidence.value == null ? null : String(evidence.value).trim() }]
  }).slice(0, 10)
}

function normalizeFacts(raw: RawPlanFacts): Omit<PlanMeasurementResult, 'id' | 'sourceName' | 'scope' | 'settings' | 'items' | 'rulesVersion' | 'processingMs' | 'model'> | null {
  if (!raw || typeof raw !== 'object') return null
  const rawRooms = Array.isArray(raw.rooms) ? raw.rooms : []
  const rooms: PlanMeasurementRoom[] = rawRooms.flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const room = entry as Record<string, unknown>
    const name = String(room.name ?? '').trim()
    if (!name) return []
    return [{
      id: stableId('room', name, index), name,
      kind: room.kind === 'exterior' ? 'exterior' : 'interior',
      area_m2: asNullablePositiveNumber(room.area_m2), perimeter_m: asNullablePositiveNumber(room.perimeter_m), height_m: asNullablePositiveNumber(room.height_m),
      confidence: clampConfidence(room.confidence), evidence: normalizeEvidence(room.evidence),
      assumptions: asStringArray(room.assumptions), warnings: asStringArray(room.warnings),
    }]
  })
  if (rooms.length === 0) return null

  const rawOpenings = Array.isArray(raw.openings) ? raw.openings : []
  const openings: PlanMeasurementOpening[] = rawOpenings.flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const opening = entry as Record<string, unknown>
    const roomName = String(opening.roomName ?? '').trim() || 'Général'
    const room = rooms.find(candidate => candidate.name.toLowerCase() === roomName.toLowerCase())
    const type = opening.type === 'door' || opening.type === 'window' || opening.type === 'bay' ? opening.type : 'other'
    return [{
      id: stableId(type, `${roomName}-${type}`, index), roomId: room?.id ?? null, roomName, type,
      quantity: Math.max(1, Math.round(asNumber(opening.quantity, 1))), width_m: asNullablePositiveNumber(opening.width_m), height_m: asNullablePositiveNumber(opening.height_m),
      confidence: clampConfidence(opening.confidence), evidence: normalizeEvidence(opening.evidence), warnings: asStringArray(opening.warnings),
    }]
  })

  const rawObservations = Array.isArray(raw.observations) ? raw.observations : []
  const observations: PlanMeasurementObservation[] = rawObservations.flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const observation = entry as Record<string, unknown>
    const label = String(observation.label ?? '').trim()
    if (!label) return []
    const roomName = String(observation.roomName ?? '').trim() || 'Général'
    const room = rooms.find(candidate => candidate.name.toLowerCase() === roomName.toLowerCase())
    const allowedTypes = new Set<PlanMeasurementObservation['type']>(['fixture', 'electrical_symbol', 'plumbing_symbol', 'equipment', 'other'])
    const rawType = String(observation.type ?? 'other') as PlanMeasurementObservation['type']
    return [{
      id: stableId('observation', `${roomName}-${label}`, index), roomId: room?.id ?? null, roomName,
      type: allowedTypes.has(rawType) ? rawType : 'other', label, quantity: Math.max(1, Math.round(asNumber(observation.quantity, 1))),
      confidence: clampConfidence(observation.confidence), evidence: normalizeEvidence(observation.evidence), warnings: asStringArray(observation.warnings),
    }]
  })

  const scaleRaw = raw.scale && typeof raw.scale === 'object' && !Array.isArray(raw.scale) ? raw.scale as Record<string, unknown> : {}
  const scaleNeedsCalibration = Boolean(scaleRaw.needsCalibration)
  const needsCalibration = Boolean(raw.needsCalibration || scaleNeedsCalibration)
  return {
    title: String(raw.title ?? 'Pré-métré depuis plan').trim() || 'Pré-métré depuis plan', rooms, openings, observations,
    globalWarnings: asStringArray(raw.globalWarnings),
    scale: {
      detected: Boolean(scaleRaw.detected), value: typeof scaleRaw.value === 'string' && scaleRaw.value.trim() ? scaleRaw.value.trim() : null,
      confidence: clampConfidence(scaleRaw.confidence), needsCalibration, evidence: normalizeEvidence(scaleRaw.evidence), assumptions: asStringArray(scaleRaw.assumptions),
    },
    needsCalibration,
  }
}

type ParsedFactsResult =
  | { ok: true; facts: NonNullable<ReturnType<typeof normalizeFacts>> }
  | { ok: false; reason: 'unreadable' | 'no_rooms' }

function parseFacts(content: string): ParsedFactsResult {
  let raw: RawPlanFacts
  try {
    raw = JSON.parse(extractJson(content)) as RawPlanFacts
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
  const facts = normalizeFacts(raw)
  if (!facts) return { ok: false, reason: 'no_rooms' }
  return { ok: true, facts }
}

function parseJsonField<T>(formData: FormData, key: string, fallback: T): T {
  const raw = formData.get(key)
  if (typeof raw !== 'string' || !raw.trim()) return fallback
  try { return JSON.parse(raw) as T } catch { return fallback }
}

function parseScope(formData: FormData, inferredTrades: PlanMeasurementTrade[]): PlanMeasurementScope {
  const projectType: PlanProjectType = formData.get('projectType') === 'new' ? 'new' : 'renovation'
  const requested = parseJsonField<unknown[]>(formData, 'selectedTrades', inferredTrades)
  const selectedTrades = requested.filter((trade): trade is PlanMeasurementTrade => typeof trade === 'string' && TRADE_SET.has(trade))
  const rawScopes = parseJsonField<Record<string, unknown>>(formData, 'workScopes', {})
  const workScopes: Partial<Record<PlanMeasurementTrade, PlanWorkScope>> = {}
  for (const trade of selectedTrades) {
    const scope = rawScopes[trade]
    workScopes[trade] = typeof scope === 'string' && WORK_SCOPE_SET.has(scope as PlanWorkScope)
      ? scope as PlanWorkScope
      : projectType === 'new' ? 'create' : 'replace'
  }
  return { projectType, selectedTrades: selectedTrades.length ? [...new Set(selectedTrades)] : inferredTrades, workScopes }
}

function parseSettings(formData: FormData): PlanMeasurementSettings {
  const raw = parseJsonField<Partial<PlanMeasurementSettings>>(formData, 'settings', {})
  return {
    defaultHeightM: Math.max(1, Math.min(10, asNumber(raw.defaultHeightM, DEFAULT_MEASUREMENT_SETTINGS.defaultHeightM))),
    wastePct: Math.max(0, Math.min(50, asNumber(raw.wastePct, DEFAULT_MEASUREMENT_SETTINGS.wastePct))),
    studSpacingM: Math.max(0.1, Math.min(2, asNumber(raw.studSpacingM, DEFAULT_MEASUREMENT_SETTINGS.studSpacingM))),
    paintCoats: Math.max(1, Math.min(5, Math.round(asNumber(raw.paintCoats, DEFAULT_MEASUREMENT_SETTINGS.paintCoats)))),
    wallTileHeightM: Math.max(0.1, Math.min(5, asNumber(raw.wallTileHeightM, DEFAULT_MEASUREMENT_SETTINGS.wallTileHeightM))),
  }
}

function buildSystemPrompt(context: { sector: string; activityLabels: string[]; verticalPackLabel?: string | null }): string {
  return `Tu es Chloé, spécialiste de la lecture factuelle de plans pour artisans du bâtiment.

Entreprise : ${context.sector || 'BTP'}${context.activityLabels.length ? ` — activités : ${context.activityLabels.join(', ')}` : ''}${context.verticalPackLabel ? ` — pack métier : ${context.verticalPackLabel}` : ''}.

Ta seule mission est d'extraire les faits visibles. Tu ne proposes aucun ouvrage, matériau, corps de métier, prix ou formule.
- Identifie toutes les pièces et zones, y compris les zones extérieures comme les terrasses.
- Utilise d'abord les cotes et surfaces imprimées. Ne déduis une mesure par l'échelle que si c'est fiable.
- Une surface imprimée prévaut sur un produit de dimensions contradictoire ; signale la contradiction.
- Calcule le périmètre seulement avec des dimensions lisibles. Sinon laisse null.
- Pour chaque mesure, ajoute une preuve courte et sa source.
- Détecte les portes, fenêtres et baies avec dimensions seulement lorsqu'elles sont lisibles.
- Inventorie dans observations les équipements et symboles réellement visibles (sanitaires, prises, luminaires), sans compléter selon une norme ou une moyenne par pièce.
- Ne confonds jamais mobilier dessiné et travaux à réaliser.
- needsCalibration vaut false lorsque les cotes imprimées suffisent, même si l'échelle graphique n'est pas exploitable.
- needsCalibration vaut true lorsqu'une mesure nécessaire dépend d'une échelle ou cote incertaine.
- Retourne exclusivement le JSON conforme au schéma demandé.`
}

async function persistMeasurement(input: {
  supabase: Awaited<ReturnType<typeof createClient>>
  organizationId: string
  userId: string
  sourceName: string
  measurement: PlanMeasurementResult
  description: string | null
}): Promise<string | null> {
  const { data, error } = await input.supabase.from('plan_measurements').insert({
    organization_id: input.organizationId,
    created_by: input.userId,
    title: input.measurement.title,
    source_name: input.sourceName,
    status: 'ready',
    project_type: input.measurement.scope.projectType,
    selected_trades: input.measurement.scope.selectedTrades,
    work_scopes: input.measurement.scope.workScopes,
    settings: input.measurement.settings,
    result: input.measurement,
    user_description: input.description,
    model: input.measurement.model,
    processing_ms: input.measurement.processingMs,
    rules_version: PLAN_MEASUREMENT_RULES_VERSION,
  }).select('id').single()
  if (error) {
    console.error('[ai/measure-plan.persist]', error)
    return null
  }
  return data?.id ?? null
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  if (!await hasPermission('quotes.view')) return NextResponse.json({ error: 'Action non autorisée.' }, { status: 403 })
  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) return NextResponse.json({ measurement: null })
  const { data, error } = await supabase.from('plan_measurements')
    .select('id, result')
    .eq('organization_id', organizationId)
    .eq('status', 'ready')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error('[ai/measure-plan.latest]', error)
    return NextResponse.json({ measurement: null })
  }
  const measurement = data?.result && typeof data.result === 'object' ? { ...(data.result as PlanMeasurementResult), id: data.id } : null
  return NextResponse.json({ measurement })
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  if (!await hasPermission('ai.manage')) return NextResponse.json({ error: 'permission_denied', code: 'permission_denied' }, { status: 403 })
  if (!await hasPermission('quotes.create')) return NextResponse.json({ error: 'Action non autorisée.' }, { status: 403 })
  const membership = await getCurrentMembershipContext()
  if (membership?.roleSlug !== 'owner' && membership?.roleSlug !== 'admin') return NextResponse.json({ error: 'Action réservée aux administrateurs.' }, { status: 403 })
  if (!process.env.OPENROUTER_API_KEY) return NextResponse.json({ error: 'Clé API IA non configurée (OPENROUTER_API_KEY manquante)' }, { status: 500 })
  if (!(req.headers.get('content-type') ?? '').includes('multipart/form-data')) return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 })

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 })
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: 'Fichier trop volumineux (max 10 Mo)' }, { status: 400 })
  const mimeType = file.type || 'application/pdf'
  if (!ACCEPTED_MIME_TYPES.has(mimeType)) return NextResponse.json({ error: 'Formats acceptés : PDF, PNG, JPEG' }, { status: 400 })

  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) return NextResponse.json({ error: 'Organisation introuvable.' }, { status: 400 })
  const { data: organization } = await supabase.from('organizations')
    .select('sector, business_activity_id, secondary_activity_ids, business_vertical_pack')
    .eq('id', organizationId).single()
  const activityIds = [organization?.business_activity_id, ...normalizeSecondaryActivityIds(organization?.secondary_activity_ids, organization?.business_activity_id)].filter(Boolean) as string[]
  const activityLabels = activityIds.map(id => getBusinessActivityById(id)?.label).filter((label): label is string => Boolean(label))
  const verticalPackLabel = getVerticalPackDefinition(organization?.business_vertical_pack)?.label ?? null
  const scope = parseScope(formData, inferMeasurementTrades(activityIds, organization?.sector))
  const settings = parseSettings(formData)
  const description = typeof formData.get('description') === 'string' ? String(formData.get('description')).trim() || null : null
  const fileBuffer = Buffer.from(await file.arrayBuffer())
  const base64 = fileBuffer.toString('base64')
  let pdfParserPlugins: PdfParserPlugin[] | undefined

  if (mimeType === 'application/pdf') {
    const validation = await validatePdfForVision(fileBuffer, 'Envoyez un extrait ciblé sur le plan à mesurer.')
    if (!validation.ok) {
      return NextResponse.json({ error: validation.message, code: validation.code }, { status: validation.code === 'pdf_images_too_heavy' ? 422 : 400 })
    }
    pdfParserPlugins = buildPdfParserPlugins(validation.inspection)
  }

  const fileName = file.name
  const orgIdForAI = organizationId

  async function extractFacts(): Promise<ParsedFactsResult> {
    const { data } = await callAI<any>({
      organizationId: orgIdForAI,
      provider: 'openrouter',
      feature: 'quote_analysis',
      model: VISION_MODEL,
      inputKind: 'mixed',
      request: {
        body: {
          messages: [
            { role: 'system', content: buildSystemPrompt({ sector: organization?.sector ?? 'BTP', activityLabels, verticalPackLabel }) },
            { role: 'user', content: [
              buildDocumentContentBlock(mimeType, base64, fileName),
              { type: 'text', text: `Extrais les faits mesurables de ce plan.${description ? `\nContexte utilisateur, à utiliser seulement pour lever une ambiguïté : ${description}` : ''}` },
            ] },
          ],
          temperature: 0,
          max_tokens: 4096,
          plugins: pdfParserPlugins,
          response_format: { type: 'json_schema', json_schema: { name: 'plan_facts', strict: true, schema: PLAN_FACTS_JSON_SCHEMA } },
        },
        timeoutMs: MODEL_TIMEOUT_MS,
      },
      metadata: { route: 'api/ai/measure-plan', app_name: APP_NAME, rules_version: PLAN_MEASUREMENT_RULES_VERSION },
    })
    return parseFacts(data.choices?.[0]?.message?.content ?? '')
  }

  try {
    let result = await extractFacts()
    // Une extraction à zéro pièce sur un plan par ailleurs valide (JSON conforme au schéma)
    // peut être un raté ponctuel du modèle plutôt qu'un vrai plan sans géométrie : on retente une fois.
    if (!result.ok && result.reason === 'no_rooms') {
      result = await extractFacts()
    }
    if (!result.ok) {
      const message = result.reason === 'unreadable'
        ? 'Le plan n’a pas pu être analysé (image illisible ou trop basse résolution). Réessayez avec un fichier plus net.'
        : 'Aucune pièce détectée sur ce plan après deux analyses. Vérifiez qu’il s’agit bien d’un plan de distribution intérieure avec des pièces cotées, ou réessayez.'
      return NextResponse.json({ error: message, code: result.reason }, { status: 422 })
    }
    const facts = result.facts
    const processingMs = Date.now() - startedAt
    const measurement: PlanMeasurementResult = {
      ...facts, sourceName: file.name, scope, settings,
      items: buildMeasurementItems({ rooms: facts.rooms, openings: facts.openings, scope, settings }),
      rulesVersion: PLAN_MEASUREMENT_RULES_VERSION, processingMs, model: VISION_MODEL,
    }
    const id = await persistMeasurement({ supabase, organizationId, userId: user.id, sourceName: file.name, measurement, description })
    measurement.id = id
    return NextResponse.json({ measurement })
  } catch (error: any) {
    if (error instanceof AIQuotaExceededError) return NextResponse.json({ error: 'Quota mensuel d’analyses de devis atteint.' }, { status: 402 })
    if (error instanceof AIModuleDisabledError) return NextResponse.json({ error: 'Module IA devis désactivé pour cette organisation.' }, { status: 403 })
    if (error instanceof AIRateLimitError) return NextResponse.json({ error: error.message }, { status: 429 })
    if (error instanceof AIProviderCreditError && error.aiBillingMode === 'client_owned') return NextResponse.json({ error: 'Rechargez vos crédits OpenRouter ou vérifiez la clé OpenRouter de votre organisation pour continuer.' }, { status: 402 })
    const timedOut = error?.name === 'AbortError' || /aborted|timeout/i.test(error instanceof Error ? error.message : String(error))
    console.error('[ai/measure-plan]', error)
    return NextResponse.json({
      error: timedOut
        ? 'L’analyse a dépassé 55 secondes. Réduisez la résolution du plan ou recadrez-le, puis relancez.'
        : 'Erreur lors de l’analyse du plan. Vous pouvez relancer sans perdre vos paramètres.',
    }, { status: timedOut ? 504 : 500 })
  }
}
