import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { getCurrentMembershipContext, hasPermission } from '@/lib/data/queries/membership'
import { APP_NAME } from '@/lib/brand'
import { AIModuleDisabledError, AIProviderCreditError, AIRateLimitError, callAI } from '@/lib/ai/callAI'
import { AIQuotaExceededError } from '@/lib/quota'

export type PlanMeasurementRoom = {
  name: string
  area_m2?: number | null
  perimeter_m?: number | null
  height_m?: number | null
  confidence?: number | null
  assumptions?: string[]
}

export type PlanMeasurementItem = {
  roomName: string
  trade: string
  designation: string
  quantity: number
  unit: string
  length_m?: number | null
  width_m?: number | null
  height_m?: number | null
  dim_quantity?: number
  dimension_pricing_mode?: 'none' | 'linear' | 'area' | 'volume' | null
  confidence?: number | null
  assumptions?: string[]
  warnings?: string[]
  formula?: string | null
  formulaVariables?: Record<string, number>
}

export type PlanMeasurementResult = {
  title: string
  rooms: PlanMeasurementRoom[]
  items: PlanMeasurementItem[]
  globalWarnings: string[]
  scale: {
    detected: boolean
    value?: string | null
    needsCalibration: boolean
    assumptions?: string[]
  }
  needsCalibration: boolean
}

const VISION_MODEL = 'google/gemini-2.5-flash'
const FALLBACK_MODEL = 'anthropic/claude-sonnet-4-6'
const FAST_MODEL_TIMEOUT_MS = 35_000
const FALLBACK_MODEL_TIMEOUT_MS = 45_000
const ACCEPTED_MIME_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'])

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  const obj = text.match(/\{[\s\S]*\}/)
  return obj ? obj[0] : text.trim()
}

function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(',', '.')) : NaN
  return Number.isFinite(n) ? n : fallback
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(v => String(v ?? '').trim()).filter(Boolean).slice(0, 8)
    : []
}

function asNumberRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, raw]) => [key, asNumber(raw, NaN)] as const)
      .filter(([, n]) => Number.isFinite(n)),
  )
}

function clampConfidence(value: unknown): number | null {
  const n = asNumber(value, NaN)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(1, n > 1 ? n / 100 : n))
}

function normalizeDimensionMode(value: unknown): PlanMeasurementItem['dimension_pricing_mode'] {
  return value === 'linear' || value === 'area' || value === 'volume' || value === 'none' ? value : null
}

function normalizeMeasurement(raw: unknown): PlanMeasurementResult | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  const rawRooms = Array.isArray(obj.rooms) ? obj.rooms : []
  const rawItems = Array.isArray(obj.items) ? obj.items : []

  const rooms: PlanMeasurementRoom[] = rawRooms
    .filter(r => r && typeof r === 'object')
    .map(r => {
      const room = r as Record<string, unknown>
      return {
        name: String(room.name ?? 'Zone sans nom').trim() || 'Zone sans nom',
        area_m2: room.area_m2 == null ? null : asNumber(room.area_m2, 0),
        perimeter_m: room.perimeter_m == null ? null : asNumber(room.perimeter_m, 0),
        height_m: room.height_m == null ? null : asNumber(room.height_m, 0),
        confidence: clampConfidence(room.confidence),
        assumptions: asStringArray(room.assumptions),
      }
    })

  const items: PlanMeasurementItem[] = rawItems
    .filter(i => i && typeof i === 'object')
    .map(i => {
      const item = i as Record<string, unknown>
      const mode = normalizeDimensionMode(item.dimension_pricing_mode)
      return {
        roomName: String(item.roomName ?? item.room_name ?? 'Général').trim() || 'Général',
        trade: String(item.trade ?? 'Général').trim() || 'Général',
        designation: String(item.designation ?? '').trim(),
        quantity: Math.max(0, asNumber(item.quantity, 0)),
        unit: String(item.unit ?? 'u').trim() || 'u',
        length_m: item.length_m == null ? null : asNumber(item.length_m, 0),
        width_m: item.width_m == null ? null : asNumber(item.width_m, 0),
        height_m: item.height_m == null ? null : asNumber(item.height_m, 0),
        dim_quantity: Math.max(1, Math.round(asNumber(item.dim_quantity, 1))),
        dimension_pricing_mode: mode,
        confidence: clampConfidence(item.confidence),
        assumptions: asStringArray(item.assumptions),
        warnings: asStringArray(item.warnings),
        formula: typeof item.formula === 'string' && item.formula.trim() ? item.formula.trim().slice(0, 180) : null,
        formulaVariables: asNumberRecord(item.formulaVariables ?? item.formula_variables),
      }
    })
    .filter(i => i.designation && i.quantity > 0)

  if (items.length === 0) return null

  const scaleRaw = obj.scale && typeof obj.scale === 'object' && !Array.isArray(obj.scale)
    ? obj.scale as Record<string, unknown>
    : {}
  const scale = {
    detected: Boolean(scaleRaw.detected),
    value: typeof scaleRaw.value === 'string' && scaleRaw.value.trim() ? scaleRaw.value.trim() : null,
    needsCalibration: Boolean(scaleRaw.needsCalibration ?? scaleRaw.needs_calibration),
    assumptions: asStringArray(scaleRaw.assumptions),
  }
  const needsCalibration = Boolean(obj.needsCalibration ?? obj.needs_calibration ?? scale.needsCalibration)

  return {
    title: String(obj.title ?? 'Pré-métré depuis plan').trim() || 'Pré-métré depuis plan',
    rooms,
    items,
    globalWarnings: asStringArray(obj.globalWarnings ?? obj.global_warnings),
    scale: { ...scale, needsCalibration },
    needsCalibration,
  }
}

function parseMeasurement(raw: string): PlanMeasurementResult | null {
  try {
    return normalizeMeasurement(JSON.parse(extractJson(raw)))
  } catch {
    return null
  }
}

function buildSystemPrompt(): string {
  return `Tu es Chloé, chiffreuse spécialisée en pré-métré de plans pour artisans du bâtiment.

Objectif : analyser un plan, croquis coté, photo de plan ou PDF architecte pour produire un pré-métré validable, pas un devis final.

Règles strictes :
- Retourne uniquement un JSON valide.
- Ne prétends jamais que le métré est garanti. Expose les hypothèses et warnings.
- Si l'échelle ou les cotes sont incertaines, mets needsCalibration à true.
- Identifie les pièces/zones quand elles sont lisibles.
- Calcule les surfaces, périmètres et linéaires uniquement quand les cotes visibles le permettent.
- Pour le placo de base, propose si pertinent : plafond BA13, doublage mural, cloisons, rails/montants, isolant, bandes/joints/enduits.
- Pour les surfaces de cloisons/doublage : quantité = longueur × hauteur. Si la hauteur n'est pas lisible, utilise 2.50 m et ajoute un warning.
- Pour les plafonds : quantité = surface de pièce.
- Pour rails/montants : reste simple et indique l'hypothèse dans assumptions.
- Ajoute une formule simple et vérifiable pour chaque ligne dans \`formula\`.
- Utilise uniquement ces variables dans les formules : L (longueur), W (largeur), H (hauteur), N (nombre), A (surface), P (périmètre), O (ouvertures), waste (taux de perte en décimal), spacing (entraxe en m).
- Renseigne \`formulaVariables\` avec les valeurs numériques utilisées quand elles sont connues.
- Les ouvertures doivent être déduites seulement si elles sont clairement identifiables ; sinon ajoute un warning.
- N'ajoute aucun prix. Le prix sera traité après validation humaine.

Structure JSON exacte :
{
  "title": "Pré-métré court du projet",
  "rooms": [
    { "name": "Chambre 1", "area_m2": 12.4, "perimeter_m": 14.2, "height_m": 2.5, "confidence": 0.8, "assumptions": ["Hauteur supposée 2,50 m"] }
  ],
  "items": [
    {
      "roomName": "Chambre 1",
      "trade": "Placo",
      "designation": "Plafond BA13",
      "quantity": 12.4,
      "unit": "m²",
      "length_m": 4,
      "width_m": 3.1,
      "height_m": null,
      "dim_quantity": 1,
      "dimension_pricing_mode": "area",
      "confidence": 0.82,
      "assumptions": ["Surface calculée depuis les cotes visibles"],
      "warnings": [],
      "formula": "L * W * N * (1 + waste)",
      "formulaVariables": { "L": 4, "W": 3.1, "N": 1, "waste": 0 }
    }
  ],
  "globalWarnings": ["Échelle à confirmer avant devis définitif"],
  "scale": { "detected": true, "value": "1:50", "needsCalibration": false, "assumptions": [] },
  "needsCalibration": false
}`
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  const userId = user.id

  if (!await hasPermission('ai.manage')) {
    return NextResponse.json({ error: 'permission_denied', code: 'permission_denied' }, { status: 403 })
  }
  if (!await hasPermission('quotes.create')) {
    return NextResponse.json({ error: 'Action non autorisée.' }, { status: 403 })
  }

  const membership = await getCurrentMembershipContext()
  if (membership?.roleSlug !== 'owner' && membership?.roleSlug !== 'admin') {
    return NextResponse.json({ error: 'Action réservée aux administrateurs.' }, { status: 403 })
  }

  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json({ error: 'Clé API IA non configurée (OPENROUTER_API_KEY manquante)' }, { status: 500 })
  }

  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 })
  }

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 })
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: 'Fichier trop volumineux (max 10 Mo)' }, { status: 400 })

  const mimeType = file.type || 'application/pdf'
  if (!ACCEPTED_MIME_TYPES.has(mimeType)) {
    return NextResponse.json({ error: 'Formats acceptés : PDF, PNG, JPEG' }, { status: 400 })
  }

  const orgId = await getCurrentOrganizationId()
  const description = (formData.get('description') as string | null)?.trim()
  const arrayBuffer = await file.arrayBuffer()
  const base64 = Buffer.from(arrayBuffer).toString('base64')
  const userPrompt = description
    ? `Analyse ce plan pour préparer un pré-métré validable.\n\nPrécisions utilisateur : ${description}\n\nRetourne uniquement le JSON demandé.`
    : 'Analyse ce plan pour préparer un pré-métré validable. Retourne uniquement le JSON demandé.'

  const messages = [
    { role: 'system', content: buildSystemPrompt() },
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
        { type: 'text', text: userPrompt },
      ],
    },
  ]

  try {
    async function callMeasureModel(modelName: string, timeoutMs: number): Promise<PlanMeasurementResult | null> {
      const { data } = await callAI<any>({
        organizationId: orgId ?? userId,
        provider: 'openrouter',
        feature: 'quote_analysis',
        model: modelName,
        inputKind: 'mixed',
        request: {
          body: {
            messages,
            temperature: modelName === FALLBACK_MODEL ? 0.1 : 0.2,
            max_tokens: 4096,
          },
          timeoutMs,
        },
        metadata: {
          route: 'api/ai/measure-plan',
          app_name: APP_NAME,
          fallback: modelName === FALLBACK_MODEL,
        },
      })
      return parseMeasurement(data.choices?.[0]?.message?.content ?? '')
    }

    let measurement: PlanMeasurementResult | null = null
    try {
      measurement = await callMeasureModel(VISION_MODEL, FAST_MODEL_TIMEOUT_MS)
    } catch (fastErr) {
      if (fastErr instanceof AIQuotaExceededError || fastErr instanceof AIModuleDisabledError || fastErr instanceof AIRateLimitError || fastErr instanceof AIProviderCreditError) {
        throw fastErr
      }
      console.warn('[ai/measure-plan] fast model error, trying fallback', fastErr instanceof Error ? fastErr.message : fastErr)
    }

    if (!measurement) {
      console.warn('[ai/measure-plan] fast model insufficient, trying fallback')
      measurement = await callMeasureModel(FALLBACK_MODEL, FALLBACK_MODEL_TIMEOUT_MS)
    }
    if (!measurement) {
      return NextResponse.json({ error: 'Métré IA invalide ou vide, veuillez réessayer avec un plan plus lisible.' }, { status: 500 })
    }

    return NextResponse.json({ measurement })
  } catch (err: any) {
    if (err instanceof AIQuotaExceededError) {
      return NextResponse.json({ error: 'Quota mensuel d\'analyses de devis atteint.' }, { status: 402 })
    }
    if (err instanceof AIModuleDisabledError) {
      return NextResponse.json({ error: 'Module IA devis désactivé pour cette organisation.' }, { status: 403 })
    }
    if (err instanceof AIRateLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 })
    }
    if (err instanceof AIProviderCreditError && err.aiBillingMode === 'client_owned') {
      return NextResponse.json({ error: 'Rechargez vos crédits OpenRouter ou vérifiez la clé OpenRouter de votre organisation pour continuer.' }, { status: 402 })
    }
    console.error('[ai/measure-plan]', err)
    return NextResponse.json({ error: 'Erreur lors de l\'analyse du plan' }, { status: 500 })
  }
}
