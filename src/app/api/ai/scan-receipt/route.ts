import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { AIModuleDisabledError, AIRateLimitError, callAI } from '@/lib/ai/callAI'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'

const VISION_MODEL = 'google/gemini-2.5-flash-lite'
const VISION_FALLBACK = 'anthropic/claude-sonnet-4-6'
const MODEL_TIMEOUT_MS = 30_000

export type ScanReceiptResult = {
  label: string
  amountHt: number | null
  amountTtc: number | null
  vatRate: number | null
  amountSource: 'ht_detected' | 'ttc_converted' | 'unknown'
  expenseDate: string | null
  supplierName: string | null
  category: 'materiel' | 'sous_traitance' | 'location' | 'transport' | 'autre'
  subcategory: string | null
  confidence: 'high' | 'medium' | 'low'
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  const obj = text.match(/\{[\s\S]*\}/)
  if (obj) return obj[0]
  return text.trim()
}

const PROMPT = `Tu es un assistant d'extraction de données pour des tickets de caisse, reçus et justificatifs de dépenses professionnelles.

Analyse ce document et extrais les informations suivantes. Retourne UNIQUEMENT un objet JSON valide (sans markdown, sans explication) avec ce format exact :

{
  "label": "libellé court de la dépense (ex: Péage A10 Vinci, Carburant Total, Fournitures Brico)",
  "amountHt": montant_HT_en_nombre_decimal_ou_null,
  "amountTtc": montant_TTC_total_a_payer_en_nombre_decimal_ou_null,
  "vatRate": taux_TVA_en_pourcentage_ou_null,
  "expenseDate": "YYYY-MM-DD ou null",
  "supplierName": "nom de l'enseigne ou du fournisseur ou null",
  "category": "transport" | "materiel" | "sous_traitance" | "location" | "autre",
  "subcategory": "peage" | "carburant" | null,
  "confidence": "high" | "medium" | "low"
}

Règles :
- Priorité absolue : lis le montant total payé / total TTC / net à payer / total CB. Ne laisse jamais amountTtc à null si un montant total est clairement visible.
- Ne confonds pas le montant total avec un numéro de carte, un ticket, une autorisation, une monnaie rendue, un solde de points ou une ligne article isolée.
- Si le ticket affiche explicitement HT et TVA, renseigne amountHt et vatRate.
- Si seul le montant TTC est visible, renseigne amountTtc avec ce montant et laisse amountHt à null.
- Si la TVA est visible avec le TTC, calcule amountHt = montant_TTC / (1 + taux_TVA/100).
- Pour un ticket de péage : category="transport", subcategory="peage"
- Pour un ticket de carburant/essence/gazole : category="transport", subcategory="carburant"
- Pour du matériel, fournitures, outillage : category="materiel"
- Pour de la location d'engin ou matériel : category="location"
- Pour toute autre dépense professionnelle : category="autre"
- confidence="high" si montant + date clairement lisibles, "medium" si partiellement lisible, "low" si document illisible ou incertain
- Ne retourne que le JSON, sans aucun autre texte`

function parseAmount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 100) / 100
  if (typeof value !== 'string') return null

  const normalized = value
    .replace(/\s/g, '')
    .replace(/[€A-Za-z]/g, '')
    .replace(',', '.')

  const parsed = Number.parseFloat(normalized)
  if (!Number.isFinite(parsed)) return null
  return Math.round(parsed * 100) / 100
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

async function callModel(
  model: string,
  base64: string,
  mimeType: string,
  organizationId: string,
): Promise<{ result: ScanReceiptResult } | { error: string }> {
  try {
    const { data } = await callAI<any>({
      organizationId,
      provider: 'openrouter',
      feature: 'document_parse',
      model,
      inputKind: 'mixed',
      request: {
        body: {
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
                { type: 'text', text: PROMPT },
              ],
            },
          ],
          temperature: 0.1,
          max_tokens: 512,
        },
        timeoutMs: MODEL_TIMEOUT_MS,
      },
      metadata: { route: 'api/ai/scan-receipt' },
    })
    const raw = data.choices?.[0]?.message?.content ?? ''
    try {
      const parsed = JSON.parse(extractJson(raw))
      if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object')
      const amountTtc = parseAmount(parsed.amountTtc)
      const parsedAmountHt = parseAmount(parsed.amountHt)
      const parsedVatRate = parseAmount(parsed.vatRate)
      const vatRate = parsedVatRate ?? (amountTtc != null ? 20 : null)
      const amountHt = parsedAmountHt ?? (
        amountTtc != null && vatRate != null
          ? roundMoney(amountTtc / (1 + vatRate / 100))
          : null
      )
      const result: ScanReceiptResult = {
        label: parsed.label ?? '',
        amountHt,
        amountTtc,
        vatRate,
        amountSource: parsedAmountHt != null ? 'ht_detected' : amountTtc != null ? 'ttc_converted' : 'unknown',
        expenseDate: parsed.expenseDate ?? null,
        supplierName: parsed.supplierName ?? null,
        category: (['materiel', 'sous_traitance', 'location', 'transport', 'autre'] as const).includes(parsed.category)
          ? parsed.category
          : 'autre',
        subcategory: parsed.subcategory ?? null,
        confidence: (['high', 'medium', 'low'] as const).includes(parsed.confidence) ? parsed.confidence : 'low',
      }
      return { result }
    } catch {
      return { error: 'parse_error' }
    }
  } catch (err: any) {
    if (err instanceof AIModuleDisabledError) return { error: 'module_disabled' }
    if (err instanceof AIRateLimitError) return { error: 'rate_limited' }
    if (err?.name === 'AbortError') return { error: 'timeout' }
    throw err
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json({ error: 'Clé API IA non configurée' }, { status: 500 })
  }

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 })
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: 'Fichier trop volumineux (max 10 Mo)' }, { status: 400 })
  }

  const orgId = await getCurrentOrganizationId()
  const organizationId = orgId ?? user.id

  const arrayBuffer = await file.arrayBuffer()
  const base64 = Buffer.from(arrayBuffer).toString('base64')
  const mimeType = file.type || 'image/jpeg'

  try {
    let res = await callModel(VISION_MODEL, base64, mimeType, organizationId)
    if ('error' in res) {
      res = await callModel(VISION_FALLBACK, base64, mimeType, organizationId)
    }
    if ('error' in res) {
      if (res.error === 'module_disabled') {
        return NextResponse.json({ error: 'Module IA désactivé pour cette organisation.' }, { status: 403 })
      }
      if (res.error === 'rate_limited') {
        return NextResponse.json({ error: 'Trop de requêtes IA pour cette organisation. Réessayez plus tard.' }, { status: 429 })
      }
      return NextResponse.json({ error: 'Impossible d\'analyser ce document. Vérifiez que l\'image est lisible.' }, { status: 500 })
    }
    return NextResponse.json(res.result)
  } catch (err) {
    console.error('[ai/scan-receipt]', err)
    return NextResponse.json({ error: 'Erreur lors de l\'analyse IA' }, { status: 500 })
  }
}
