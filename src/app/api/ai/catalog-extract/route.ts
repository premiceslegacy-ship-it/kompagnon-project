import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { resolveCatalogContext, getCatalogAIPromptContext } from '@/lib/catalog-context'
import { AIModuleDisabledError, AIRateLimitError, callAI } from '@/lib/ai/callAI'

const TEXT_MODEL = 'google/gemini-2.5-flash'
const VISION_MODEL = 'google/gemini-2.5-flash'

export type CatalogDraftConfidence = Record<string, 'high' | 'low'>

export type CatalogDraftMaterial = {
  kind: 'material' | 'service'
  name: string
  reference?: string | null
  unit: string
  purchase_price?: number | null
  sale_price?: number | null
  margin_rate?: number | null
  vat_rate: number
  category?: string | null
  supplier_name?: string | null
  description?: string | null
  dimension_pricing_mode?: 'none' | 'linear' | 'area' | 'volume'
  base_length_m?: number | null
  base_width_m?: number | null
  base_height_m?: number | null
  confidence: CatalogDraftConfidence
}

export type CatalogDraftLaborRate = {
  kind: 'labor_rate'
  designation: string
  unit: string
  cost_rate?: number | null
  rate?: number | null
  vat_rate: number
  category?: string | null
  type: 'human' | 'machine' | 'equipment' | 'subcontractor' | 'other'
  description?: string | null
  confidence: CatalogDraftConfidence
}

export type CatalogDraftPrestationType = {
  kind: 'prestation_type'
  name: string
  description?: string | null
  unit: string
  category?: string | null
  base_price_ht?: number | null
  base_cost_ht?: number | null
  vat_rate: number
  lines?: Array<{
    designation: string
    quantity: number
    unit: string
    item_type: 'material' | 'service' | 'labor' | 'transport' | 'free'
    unit_price_ht?: number | null
  }>
  confidence: CatalogDraftConfidence
}

export type CatalogDraftSupplier = {
  kind: 'supplier'
  name: string
  contact_name?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  siret?: string | null
  payment_terms?: string | null
  confidence: CatalogDraftConfidence
}

export type CatalogDraftItem =
  | CatalogDraftMaterial
  | CatalogDraftLaborRate
  | CatalogDraftPrestationType
  | CatalogDraftSupplier

export type CatalogExtractResult = {
  items: CatalogDraftItem[]
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  const obj = text.match(/\{[\s\S]*\}/)
  if (obj) return obj[0]
  return text.trim()
}

function buildSystemPrompt(ctx: ReturnType<typeof getCatalogAIPromptContext>): string {
  return `Tu es un assistant de saisie de catalogue pour une entreprise du secteur "${ctx.activityLabel}" (profil: ${ctx.businessProfile}).

Vocabulaire métier de cette entreprise :
- Produit/matière = "${ctx.materialLabel}"
- Service/prestation vendue = "${ctx.serviceLabel}"
- Ressource interne (main d'œuvre, machine) = "${ctx.laborRateLabel}"
- Modèle de devis = "${ctx.bundleTemplateLabel}"

Unités disponibles par type :
- ${ctx.materialLabel} : ${ctx.unitsByKind.material.join(', ')}
- ${ctx.serviceLabel} : ${ctx.unitsByKind.service.join(', ')}
- ${ctx.laborRateLabel} : ${ctx.unitsByKind.laborRate.join(', ')}

Catégories habituelles :
- ${ctx.materialLabel} : ${ctx.defaultCategories.material.join(', ')}
- ${ctx.serviceLabel} : ${ctx.defaultCategories.service.join(', ')}
- ${ctx.laborRateLabel} : ${ctx.defaultCategories.laborRate.join(', ')}
- Modèles de devis : ${ctx.defaultCategories.bundleTemplate.join(', ')}

Taux de TVA légaux : ${ctx.vatRates.join(', ')}%
Modes de tarification dimensionnelle : ${ctx.dimensionModes.join(', ')} (none=forfait/unité, linear=ml, area=m², volume=m³)

Ta tâche : extraire tous les éléments de catalogue mentionnés dans le texte et les classifier en :
- "material" : fourniture/produit/matière achetée et revendue
- "service" : prestation vendue au client
- "labor_rate" : ressource interne (humain, machine, équipement, sous-traitant)
- "prestation_type" : modèle de devis réutilisable avec lignes détaillées
- "supplier" : fournisseur

Règles de classification :
- Un taux horaire humain → labor_rate type "human"
- Une machine ou équipement interne → labor_rate type "machine" ou "equipment"
- Un sous-traitant → labor_rate type "subcontractor"
- Un article/matière avec prix d'achat → material
- Une opération vendue au client → service
- Un modèle de devis avec plusieurs lignes → prestation_type
- Une entreprise fournisseur → supplier

RÈGLE CRITIQUE pour labor_rate — deux champs distincts, ne pas les confondre :
- "cost_rate" = ce que la ressource COÛTE à l'entreprise (salaire chargé, amortissement machine…). Si l'utilisateur dit "ça me coûte X€" ou "coût interne X€" → cost_rate = X.
- "rate" = ce que l'entreprise FACTURE au client pour cette ressource (toujours > cost_rate car inclut la marge). Si seul le coût est mentionné et pas le prix de vente, laisse "rate" à null ou estime-le en appliquant ~30% de marge minimum.
- Exemple : "mon maçon me coûte 28€/h" → cost_rate=28, rate=null (inconnu). "je facture la main-d'œuvre 45€/h, coût interne 28€/h" → cost_rate=28, rate=45.
- Ne jamais mettre la même valeur dans cost_rate ET rate sauf si explicitement indiqué.
- Ne jamais mettre le coût dans rate uniquement.

Pour chaque champ, indique confidence: "high" si tu es sûr, "low" si tu as dû inférer ou estimer.
Propose dimension_pricing_mode "area" pour les produits/matières au m², "linear" pour ceux au ml, "volume" pour m³, "none" sinon.

Retourne UNIQUEMENT un JSON valide avec ce format exact (tous les champs optionnels peuvent être null) :
{
  "items": [
    {
      "kind": "material",
      "name": "Carrelage grès cérame 60x60",
      "reference": null,
      "unit": "m²",
      "purchase_price": 18.50,
      "sale_price": null,
      "margin_rate": 35,
      "vat_rate": 20,
      "category": "Carrelage",
      "supplier_name": null,
      "dimension_pricing_mode": "area",
      "base_length_m": 0.60,
      "base_width_m": 0.60,
      "base_height_m": null,
      "confidence": { "name": "high", "unit": "high", "purchase_price": "high", "margin_rate": "low", "vat_rate": "low", "dimension_pricing_mode": "high" }
    },
    {
      "kind": "labor_rate",
      "designation": "Manœuvre",
      "unit": "h",
      "cost_rate": 28,
      "rate": null,
      "vat_rate": 20,
      "category": "Taux chantier",
      "type": "human",
      "confidence": { "designation": "high", "cost_rate": "high", "rate": "low" }
    }
  ]
}

Règles sur les dimensions (base_length_m, base_width_m, base_height_m) :
- Renseigne-les uniquement si les dimensions sont mentionnées dans le texte (ex: "dalle 60×60 cm" → base_length_m=0.60, base_width_m=0.60).
- Convertis toujours en mètres (cm → divise par 100, mm → divise par 1000).
- Si dimension_pricing_mode est "none", laisse ces champs à null.`
}

function buildUserPrompt(text: string): string {
  return `Extrais tous les éléments de catalogue présents dans ce texte :\n\n${text}`
}

function buildPresetsSystemPrompt(ctx: ReturnType<typeof getCatalogAIPromptContext>): string {
  return `Tu es un expert en chiffrage et organisation commerciale pour les entreprises du secteur "${ctx.activityLabel}" (profil: ${ctx.businessProfile}).

Vocabulaire métier :
- Modèle de devis = "${ctx.bundleTemplateLabel}"
- Fourniture/matière = "${ctx.materialLabel}"
- Prestation vendue = "${ctx.serviceLabel}"
- Ressource interne = "${ctx.laborRateLabel}"

Catégories habituelles pour les modèles de devis : ${ctx.defaultCategories.bundleTemplate.join(', ')}
Unités disponibles : ${[...ctx.unitsByKind.service, ...ctx.unitsByKind.material].filter((v, i, a) => a.indexOf(v) === i).join(', ')}
Taux de TVA légaux : ${ctx.vatRates.join(', ')}%

Ta tâche : générer entre 5 et 8 modèles de devis types (prestation_type) réalistes, adaptés au métier et à la description fournie par l'utilisateur.

Chaque modèle doit :
- Avoir un nom clair et professionnel
- Inclure 2 à 6 lignes détaillées typiques (item_type: "material", "service", "labor", "transport" ou "free")
- Avoir des prix cohérents avec le marché (base_price_ht et base_cost_ht estimés si possible, sinon 0)
- Utiliser les bonnes unités et catégories du secteur

Retourne UNIQUEMENT un JSON valide avec ce format :
{
  "items": [
    {
      "kind": "prestation_type",
      "name": "Nom du modèle",
      "description": "Description courte",
      "unit": "forfait",
      "category": "Catégorie",
      "base_price_ht": 0,
      "base_cost_ht": 0,
      "vat_rate": 20,
      "lines": [
        { "designation": "Libellé ligne", "quantity": 1, "unit": "forfait", "item_type": "service", "unit_price_ht": null }
      ],
      "confidence": { "name": "high", "unit": "high", "base_price_ht": "low" }
    }
  ]
}`
}

function buildPresetsUserPrompt(ctx: ReturnType<typeof getCatalogAIPromptContext>, description: string): string {
  const base = `Génère des modèles de devis types pour une entreprise de ${ctx.activityLabel}.`
  if (description.trim()) {
    return `${base}\n\nPrécision apportée par l'utilisateur : ${description.trim()}`
  }
  return base
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const normalized = value.trim().replace(',', '.')
  if (!normalized) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeCatalogDrafts(items: CatalogDraftItem[]): CatalogDraftItem[] {
  return items.map((item) => {
    if (item.kind !== 'material' && item.kind !== 'service') return item

    const material = { ...item } as CatalogDraftMaterial
    const purchasePrice = toFiniteNumber(material.purchase_price)
    const salePrice = toFiniteNumber(material.sale_price)
    const marginRate = toFiniteNumber(material.margin_rate)

    if (purchasePrice == null && salePrice != null && marginRate != null && marginRate > -100) {
      const inferredPurchasePrice = salePrice / (1 + marginRate / 100)
      material.purchase_price = Number(inferredPurchasePrice.toFixed(2))
      material.confidence = {
        ...(material.confidence ?? {}),
        purchase_price: material.confidence?.purchase_price ?? 'low',
      }
    } else {
      material.purchase_price = purchasePrice
    }

    if (salePrice == null && material.purchase_price != null && marginRate != null) {
      material.sale_price = Number((material.purchase_price * (1 + marginRate / 100)).toFixed(2))
      material.confidence = {
        ...(material.confidence ?? {}),
        sale_price: material.confidence?.sale_price ?? 'low',
      }
    } else {
      material.sale_price = salePrice
    }

    material.margin_rate = marginRate
    return material
  })
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })

    const orgId = await getCurrentOrganizationId()
    if (!orgId) return NextResponse.json({ error: 'Organisation introuvable.' }, { status: 400 })

    const { data: org } = await supabase
      .from('organizations')
      .select('sector, business_profile, business_activity_id')
      .eq('id', orgId)
      .single()

    const catalogCtx = resolveCatalogContext(org ?? undefined)
    const promptCtx = getCatalogAIPromptContext(catalogCtx)
    const systemPrompt = buildSystemPrompt(promptCtx)

    const contentType = req.headers.get('content-type') ?? ''
    let userText = ''
    let isVision = false
    let imageBase64: string | null = null
    let imageMime = 'image/jpeg'
    let isPresetsMode = false
    let presetsDescription = ''

    if (contentType.includes('application/json')) {
      const body = await req.json()
      if (body.mode === 'presets') {
        isPresetsMode = true
        presetsDescription = body.description ?? ''
      } else {
        userText = body.text ?? ''
      }
    } else {
      // FormData : audio ou PDF/image
      const formData = await req.formData()
      const file = formData.get('file') as File | null
      const text = formData.get('text') as string | null

      if (text) {
        userText = text
      } else if (file) {
        const mime = file.type
        if (mime === 'application/pdf' || mime.startsWith('image/')) {
          isVision = true
          imageMime = mime
          const buffer = Buffer.from(await file.arrayBuffer())
          imageBase64 = buffer.toString('base64')
        }
      }
    }

    if (!userText && !isVision && !isPresetsMode) {
      return NextResponse.json({ error: 'Texte ou fichier requis.' }, { status: 400 })
    }

    type OpenRouterMessage = {
      role: 'system' | 'user'
      content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>
    }

    const activeSystemPrompt = isPresetsMode
      ? buildPresetsSystemPrompt(promptCtx)
      : systemPrompt

    const messages: OpenRouterMessage[] = [
      { role: 'system', content: activeSystemPrompt },
    ]

    if (isPresetsMode) {
      messages.push({
        role: 'user',
        content: buildPresetsUserPrompt(promptCtx, presetsDescription),
      })
    } else if (isVision && imageBase64) {
      messages.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text: "Extrais tous les éléments de catalogue présents dans ce document (PDF ou image) :",
          },
          {
            type: 'image_url',
            image_url: { url: `data:${imageMime};base64,${imageBase64}` },
          },
        ],
      })
    } else {
      messages.push({
        role: 'user',
        content: buildUserPrompt(userText),
      })
    }

    const result = await callAI<{ choices: Array<{ message: { content: string } }> }>({
      organizationId: orgId,
      provider: 'openrouter',
      feature: 'catalog_extract',
      model: isVision ? VISION_MODEL : TEXT_MODEL,
      inputKind: isVision ? (imageMime.startsWith('image/') ? 'image' : 'mixed') : 'text',
      request: {
        body: {
          messages,
          temperature: isPresetsMode ? 0.4 : 0.1,
          response_format: { type: 'json_object' },
        },
        timeoutMs: 30000,
      },
      metadata: { orgId, mode: isPresetsMode ? 'presets' : isVision ? 'vision' : 'text' },
    })

    const raw = result.data.choices?.[0]?.message?.content ?? ''
    let parsed: CatalogExtractResult

    try {
      parsed = JSON.parse(extractJson(raw)) as CatalogExtractResult
      if (!Array.isArray(parsed.items)) parsed = { items: [] }
      parsed = { items: normalizeCatalogDrafts(parsed.items) }
    } catch {
      return NextResponse.json({ error: "L'IA n'a pas retourné un JSON valide.", raw }, { status: 422 })
    }

    return NextResponse.json(parsed)
  } catch (err) {
    if (err instanceof AIModuleDisabledError) {
      return NextResponse.json({ error: "Le module IA catalogue n'est pas activé pour votre organisation." }, { status: 403 })
    }
    if (err instanceof AIRateLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 })
    }
    console.error('[catalog-extract]', err)
    return NextResponse.json({ error: "Erreur lors de l'analyse IA." }, { status: 500 })
  }
}
