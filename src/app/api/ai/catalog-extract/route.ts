import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { resolveCatalogContext, getCatalogAIPromptContext } from '@/lib/catalog-context'
import { AIModuleDisabledError, AIRateLimitError, callAI } from '@/lib/ai/callAI'
import { AIQuotaExceededError } from '@/lib/quota'
import { hasPermission } from '@/lib/data/queries/membership'

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
    item_type: 'material' | 'service' | 'labor' | 'transport' | 'free' | 'equipment'
    unit_price_ht?: number | null
    unit_cost_ht?: number | null
    is_internal?: boolean
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

type ExistingCatalogSnapshot = {
  materials: Array<{ name: string; unit: string | null; purchase_price: number | null; sale_price: number | null; category: string | null }>
  laborRates: Array<{ designation: string; unit: string | null; cost_rate: number | null; rate: number | null; category: string | null }>
  prestationTypes: Array<{ name: string; unit: string; base_price_ht: number; category: string | null }>
}

function buildExistingCatalogHint(snapshot: ExistingCatalogSnapshot, ctx: ReturnType<typeof getCatalogAIPromptContext>): string {
  const parts: string[] = []

  if (snapshot.materials.length > 0) {
    const lines = snapshot.materials.map(m => {
      const price = m.sale_price != null ? `vente ${m.sale_price} €/${m.unit ?? 'u'}` : m.purchase_price != null ? `achat ${m.purchase_price} €/${m.unit ?? 'u'}` : null
      return `  - ${m.name}${m.category ? ` (${m.category})` : ''}${price ? ` — ${price}` : ''}`
    })
    parts.push(`${ctx.materialLabel}s déjà dans le catalogue :\n${lines.join('\n')}`)
  }

  if (snapshot.laborRates.length > 0) {
    const lines = snapshot.laborRates.map(lr => {
      const cost = lr.cost_rate != null ? `coût ${lr.cost_rate} €/${lr.unit ?? 'h'}` : null
      const rate = lr.rate != null ? `facturable ${lr.rate} €/${lr.unit ?? 'h'}` : null
      const pricing = [cost, rate].filter(Boolean).join(', ')
      return `  - ${lr.designation}${lr.category ? ` (${lr.category})` : ''}${pricing ? ` — ${pricing}` : ''}`
    })
    parts.push(`${ctx.laborRateLabel}s déjà dans le catalogue :\n${lines.join('\n')}`)
  }

  if (snapshot.prestationTypes.length > 0) {
    const lines = snapshot.prestationTypes.map(pt => {
      const price = pt.base_price_ht > 0 ? ` — prix de base ${pt.base_price_ht} €/${pt.unit}` : ''
      return `  - ${pt.name}${pt.category ? ` (${pt.category})` : ''}${price}`
    })
    parts.push(`${ctx.bundleTemplateLabel}s déjà dans le catalogue :\n${lines.join('\n')}`)
  }

  if (parts.length === 0) return ''

  return `Catalogue actuel de cette entreprise (utilise ces prix comme référence principale pour tes estimations) :
${parts.join('\n\n')}`
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  const obj = text.match(/\{[\s\S]*\}/)
  if (obj) return obj[0]
  return text.trim()
}

function isAllCapsWord(word: string): boolean {
  const letters = word.replace(/[^\p{L}]/gu, '')
  return letters.length > 0 && letters === letters.toLocaleUpperCase('fr-FR')
}

function shouldKeepUppercaseWord(word: string): boolean {
  const letters = word.replace(/[^\p{L}]/gu, '')
  return /\d/.test(word) || (letters.length <= 4 && isAllCapsWord(word))
}

function normalizeFrenchSentenceCase(value: string | null | undefined): string | null {
  const compact = value?.replace(/\s+/g, ' ').trim()
  if (!compact) return null

  const words = compact.match(/[\p{L}\p{N}'’.-]+/gu) ?? []
  const titleCaseWords = words.filter((word) => {
    const first = word.match(/\p{L}/u)?.[0]
    return first ? first === first.toLocaleUpperCase('fr-FR') : false
  })

  if (words.length < 2 || titleCaseWords.length / words.length <= 0.75) return compact

  let seenWord = false
  return compact.replace(/[\p{L}\p{N}'’.-]+/gu, (word) => {
    if (shouldKeepUppercaseWord(word)) return word
    const normalized = word.toLocaleLowerCase('fr-FR')
    if (!seenWord) {
      seenWord = true
      return normalized.charAt(0).toLocaleUpperCase('fr-FR') + normalized.slice(1)
    }
    return normalized
  })
}

const PRESTATION_LINE_TYPES = ['material', 'service', 'labor', 'transport', 'free', 'equipment'] as const
type PrestationDraftLineType = typeof PRESTATION_LINE_TYPES[number]
const INTERNAL_PRESTATION_LINE_TYPES = new Set(['labor', 'transport', 'equipment'])

function normalizePrestationItemType(value: unknown): PrestationDraftLineType {
  return PRESTATION_LINE_TYPES.includes(value as PrestationDraftLineType) ? value as PrestationDraftLineType : 'free'
}

function ensurePrestationMargin(item: CatalogDraftPrestationType): CatalogDraftPrestationType {
  const rawLines = item.lines ?? []
  let lines = rawLines.map((line) => {
    const itemType = normalizePrestationItemType(line.item_type)
    const quantity = toFiniteNumber(line.quantity) ?? 1
    const unitPrice = toFiniteNumber(line.unit_price_ht) ?? 0
    const isInternal = line.is_internal ?? INTERNAL_PRESTATION_LINE_TYPES.has(itemType)
    const fallbackCost = isInternal ? unitPrice : itemType === 'material' || itemType === 'service' ? Number((unitPrice * 0.7).toFixed(2)) : 0
    const unitCost = toFiniteNumber(line.unit_cost_ht) ?? fallbackCost

    return {
      ...line,
      designation: normalizeFrenchSentenceCase(line.designation) ?? line.designation,
      item_type: itemType,
      quantity,
      unit: line.unit || (itemType === 'labor' ? 'h' : itemType === 'transport' ? 'L' : 'u'),
      unit_price_ht: isInternal ? 0 : unitPrice,
      unit_cost_ht: unitCost,
      is_internal: isInternal,
    }
  })

  const visibleTotal = () => lines.reduce((sum, line) => line.is_internal ? sum : sum + line.quantity * (line.unit_price_ht ?? 0), 0)
  const costTotal = () => lines.reduce((sum, line) => sum + line.quantity * (line.unit_cost_ht ?? 0), 0)
  const cost = costTotal()
  const minVisible = cost > 0 ? Math.ceil(cost * 1.2 * 100) / 100 : 0
  const visible = visibleTotal()

  if (cost > 0 && visible > 0 && visible < minVisible) {
    const factor = minVisible / visible
    lines = lines.map((line) => line.is_internal
      ? line
      : { ...line, unit_price_ht: Math.ceil((line.unit_price_ht ?? 0) * factor * 100) / 100 })
  } else if (cost > 0 && visible === 0) {
    lines.unshift({
      designation: `Forfait ${normalizeFrenchSentenceCase(item.name)?.toLocaleLowerCase('fr-FR') ?? 'intervention'}`,
      quantity: 1,
      unit: item.unit || 'forfait',
      item_type: 'service',
      unit_price_ht: minVisible,
      unit_cost_ht: 0,
      is_internal: false,
    })
  }

  return {
    ...item,
    name: normalizeFrenchSentenceCase(item.name) ?? item.name,
    description: normalizeFrenchSentenceCase(item.description) ?? item.description,
    lines,
    base_price_ht: lines.length > 0 ? Number(visibleTotal().toFixed(2)) : item.base_price_ht,
    base_cost_ht: lines.length > 0 ? Number(costTotal().toFixed(2)) : item.base_cost_ht,
  }
}

function buildMarketPriceHints(ctx: ReturnType<typeof getCatalogAIPromptContext>): string {
  // Sources : Travaux.com, France-clean.fr, Galognese, Neatikai, Vitrissimo (2025-2026)
  //           CAPEB grille jan. 2024, FFB, Obat.fr, Helloartisan, Batiprix 2025
  //           Tolery.io, 247TailorSteel, Jactio, Fert Metal, soudeurs.com (2024-2025)
  switch (ctx.businessProfile) {
    case 'cleaning':
      return `Références de prix marché France métropolitaine HT (sources : Travaux.com, France-clean.fr, Galognese, Neatikai, Vitrissimo — 2025-2026) :
Tarifs de vente :
- Entretien courant bureaux : 1,50–3,00 €/m²/passage (hebdo) ou 2,00–5,00 €/m² (mensuel/ponctuel)
- Nettoyage approfondi haute exigence : 4,00–12,00 €/m²
- Vitrerie extérieure : 3,00–8,00 €/m² de vitre ; intérieure : 2,00–4,00 €/m²
- Désinfection (biocide, monobrosse) : 3,00–4,00 €/m²
- Remise en état après travaux / fin de bail : 2,00–3,50 €/m²
- Taux horaire affiché équipe (MO + produits + marge) : 20–35 €/h (province), 35–60 €/h (spécialisé ou IDF)
Coûts internes :
- Coût chargé opérateur convention collective propreté (branche ASP) : 18–28 €/h
- Consommables : coefficient de revente x1,5 à x2,5 sur prix d'achat (marge brute 30–50 %)`

    case 'btp':
      return `Références de prix marché France métropolitaine HT (sources : CAPEB grille 2024, Obat.fr, Helloartisan, Batiprix 2025, Habitatpresto — 2025-2026) :
Taux horaires de vente (fournitures exclues) :
- Électricien : 40–65 €/h (province), 60–100 €/h (IDF)
- Plombier : 40–70 €/h (province), 70–140 €/h (IDF)
- Maçon / carreleur : 35–55 €/h (province), 50–80 €/h (IDF)
- Peintre bâtiment : 20–45 €/h (province), 35–65 €/h (IDF)
- Menuisier poseur : 35–60 €/h (province), 55–90 €/h (IDF)
- Dépannage urgence : majoration ×1,3 à ×1,5 sur le taux horaire normal
Coûts internes (coût chargé compagnon, convention CAPEB/FFB 2025) :
- Ouvrier débutant : 28–32 €/h ; qualifié : 30–36 €/h ; confirmé : 34–42 €/h
Prix de vente prestations courantes (MO + fourniture) :
- Peinture intérieure : 25–50 €/m² ; plafond : 25–45 €/m²
- Peinture façade + ravalement : 50–150 €/m² ; avec ITE : 110–270 €/m²
- Carrelage sol posé + fourni : 50–100 €/m² ; pose seule : 20–45 €/m²
- Tableau électrique fourni + posé : 500–1 100 € ; prise/point : 60–120 €/point
- Rénovation salle de bain complète : 1 300–2 000 €/m² surface SdB
Prix d'achat artisan (marge de revente habituelle 20–40 %) :
- Carrelage standard 60×60 : 8–25 €/m² ; haut de gamme : 25–80 €/m²
- Peinture pro acrylique intérieure : 3–8 €/L
- Tableau électrique équipé (disjoncteurs + diffs) : 200–600 €`

    case 'industry':
      return `Références de prix marché France métropolitaine HT (sources : Tolery.io, 247TailorSteel, Jactio, Fert Metal, soudeurs.com, usinages.com — 2024-2025) :
Prix matière (achat négoce PME, +15–30 % sur cours grande série) :
- Acier S235/S355 laminé à chaud : 0,60–1,00 €/kg (620–700 €/tonne)
- Acier galvanisé : 0,80–1,30 €/kg
- Acier inoxydable 304 : 2,50–4,00 €/kg ; inox 316L : 3,50–6,00 €/kg
- Aluminium 1050/5052 : 3,00–7,00 €/kg
Tarifs horaires de vente (MO + machine + frais fixes) :
- Atelier général (tôlerie, chaudronnerie) : 45–90 €/h
- Machine laser fibre (amortissement inclus) : 60–120 €/h
- Poste à souder MIG/MAG : 40–80 €/h ; TIG (inox, alu) : 60–100 €/h
Coûts internes (convention collective métallurgie UIMM 2025) :
- Coût chargé opérateur débutant : 18–28 €/h ; confirmé (5–10 ans) : 28–45 €/h
Prix opérations courantes :
- Découpe laser acier 1–3 mm (série) : 1,50–4,00 €/ml ; acier 5–12 mm : 4,00–12,00 €/ml
- Découpe laser inox 1–3 mm : 3,00–8,00 €/ml
- Pliage : 0,80–3,00 €/pli selon épaisseur et série
- Soudure MIG/MAG (cordon) : 8–25 €/ml ; TIG (inox/alu) : 20–60 €/ml
- Thermolaquage (sous-traitance) : 15–40 €/m²
Note : majoration 10–25 % pour pièces unitaires/prototypes vs série.`

    default:
      return ''
  }
}

function buildSystemPrompt(ctx: ReturnType<typeof getCatalogAIPromptContext>, snapshot?: ExistingCatalogSnapshot): string {
  const activityLine = ctx.activityDescription
    ? `Secteur : "${ctx.activityLabel}" — ${ctx.activityDescription}`
    : `Secteur : "${ctx.activityLabel}"`

  const catalogHint = snapshot ? buildExistingCatalogHint(snapshot, ctx) : ''
  const marketHints = buildMarketPriceHints(ctx)

  return `Tu t'appelles Lea. Tu es assistante catalogue chez ATELIER by Orsayn, experte du secteur "${ctx.activityLabel}" (profil: ${ctx.businessProfile}). Tu connais les nomenclatures, les prix du marche et les bonnes pratiques de catalogage pour ce metier. Tu es precise, rigoureuse, et tu classes les choses au bon endroit du premier coup.
${activityLine}

Vocabulaire métier de cette entreprise :
- ${ctx.materialLabel} : fourniture, produit ou matière achetée et revendue
- ${ctx.serviceLabel} : prestation ou opération vendue au client
- ${ctx.laborRateLabel} : ressource interne (main-d'œuvre, machine, équipement, sous-traitant)
- ${ctx.bundleTemplateLabel} : modèle réutilisable avec plusieurs lignes détaillées

Unités disponibles par type :
- ${ctx.materialLabel} : ${ctx.unitsByKind.material.join(', ')}
- ${ctx.serviceLabel} : ${ctx.unitsByKind.service.join(', ')}
- ${ctx.laborRateLabel} : ${ctx.unitsByKind.laborRate.join(', ')}

Catégories habituelles :
- ${ctx.materialLabel} : ${ctx.defaultCategories.material.join(', ')}
- ${ctx.serviceLabel} : ${ctx.defaultCategories.service.join(', ')}
- ${ctx.laborRateLabel} : ${ctx.defaultCategories.laborRate.join(', ')}
- ${ctx.bundleTemplateLabel} : ${ctx.defaultCategories.bundleTemplate.join(', ')}

Taux de TVA légaux : ${ctx.vatRates.join(', ')}%
Modes de tarification dimensionnelle : ${ctx.dimensionModes.join(', ')} (none=forfait/unité, linear=ml, area=m², volume=m³)

${catalogHint ? catalogHint + '\n\n' : ''}${marketHints ? marketHints + '\n\n' : ''}Ta tâche : extraire tous les éléments de catalogue mentionnés dans le texte et les classifier en :
- "material" : ${ctx.materialLabel.toLowerCase()} (achetée et revendue)
- "service" : ${ctx.serviceLabel.toLowerCase()} (vendue au client)
- "labor_rate" : ${ctx.laborRateLabel.toLowerCase()} (humain, machine, équipement, sous-traitant)
- "prestation_type" : ${ctx.bundleTemplateLabel.toLowerCase()} réutilisable avec lignes détaillées
- "supplier" : fournisseur

Règles de classification :
- Un taux horaire humain → labor_rate type "human"
- Une machine ou équipement interne → labor_rate type "machine" ou "equipment"
- Un sous-traitant → labor_rate type "subcontractor"
- Un article/${ctx.materialLabel.toLowerCase()} avec prix d'achat → material
- Une ${ctx.serviceLabel.toLowerCase()} vendue au client → service
- Un ${ctx.bundleTemplateLabel.toLowerCase()} avec plusieurs lignes → prestation_type
- Une entreprise fournisseur → supplier

RÈGLE CRITIQUE pour labor_rate — deux champs distincts, ne pas les confondre :
- "cost_rate" = ce que la ressource COÛTE à l'entreprise (salaire chargé, amortissement machine…). Si l'utilisateur dit "ça me coûte X€" ou "coût interne X€" → cost_rate = X.
- "rate" = ce que l'entreprise FACTURE au client pour cette ressource (toujours > cost_rate car inclut la marge). Si seul le coût est mentionné et pas le prix de vente, laisse "rate" à null ou estime-le en appliquant ~30% de marge minimum.
- Exemple : "mon maçon me coûte 28€/h" → cost_rate=28, rate=null. "je facture 45€/h, coût interne 28€/h" → cost_rate=28, rate=45.
- Ne jamais mettre la même valeur dans cost_rate ET rate sauf si explicitement indiqué.
- Ne jamais mettre le coût dans rate uniquement.

Pour les prix non mentionnés explicitement, utilise les fourchettes marché ci-dessus comme référence et indique confidence "low".
Pour chaque champ, indique confidence: "high" si tu es sûr de la valeur fournie, "low" si tu as dû inférer ou estimer.
Propose dimension_pricing_mode "area" pour les produits/matières au m², "linear" pour ceux au ml, "volume" pour m³, "none" sinon.
Respecte la typographie française : pas de Title Case / majuscule à chaque mot. Utilise la casse phrase ("Pose de tableau électrique", pas "Pose De Tableau Électrique"). Garde les majuscules uniquement pour les noms propres, marques, acronymes et références techniques (PVC, TIG, S235).

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

function buildUserPrompt(text: string, ctx: ReturnType<typeof getCatalogAIPromptContext>): string {
  return `Extrais tous les éléments de catalogue présents dans ce texte. Utilise le vocabulaire métier "${ctx.activityLabel}" : ${ctx.materialLabel.toLowerCase()}s, ${ctx.serviceLabel.toLowerCase()}s, ${ctx.laborRateLabel.toLowerCase()}s, ${ctx.bundleTemplateLabel.toLowerCase()}s.\n\n${text}`
}

function buildPresetsSystemPrompt(ctx: ReturnType<typeof getCatalogAIPromptContext>, snapshot?: ExistingCatalogSnapshot): string {
  const activityLine = ctx.activityDescription
    ? `Secteur : "${ctx.activityLabel}" — ${ctx.activityDescription}`
    : `Secteur : "${ctx.activityLabel}"`

  const catalogHint = snapshot ? buildExistingCatalogHint(snapshot, ctx) : ''
  const marketHints = buildMarketPriceHints(ctx)
  const allUnits = [...ctx.unitsByKind.service, ...ctx.unitsByKind.material].filter((v, i, a) => a.indexOf(v) === i)

  return `Tu t'appelles Lea. Tu es assistante catalogue chez ATELIER by Orsayn, experte en chiffrage et organisation commerciale pour les entreprises du secteur "${ctx.activityLabel}" (profil: ${ctx.businessProfile}).
${activityLine}

Vocabulaire métier :
- ${ctx.bundleTemplateLabel} : modèle de devis réutilisable avec lignes détaillées
- ${ctx.materialLabel} : fourniture, produit ou matière achetée et revendue
- ${ctx.serviceLabel} : prestation ou opération vendue au client
- ${ctx.laborRateLabel} : ressource interne (main-d'œuvre, machine, équipement)

Catégories habituelles pour les ${ctx.bundleTemplateLabel.toLowerCase()}s : ${ctx.defaultCategories.bundleTemplate.join(', ')}
Unités disponibles : ${allUnits.join(', ')}
Taux de TVA légaux : ${ctx.vatRates.join(', ')}%

${catalogHint ? catalogHint + '\n\n' : ''}${marketHints ? marketHints + '\n\n' : ''}Ta tâche : générer entre 5 et 8 ${ctx.bundleTemplateLabel.toLowerCase()}s réalistes, représentatifs du métier "${ctx.activityLabel}" et cohérents avec la description fournie par l'utilisateur.

Chaque ${ctx.bundleTemplateLabel.toLowerCase()} doit :
- Avoir un nom professionnel et précis, fidèle au vocabulaire du secteur, en casse phrase française
- Avoir une description courte adaptée à l'activité : ce que le modèle couvre, le contexte d'usage, et ce qui est inclus
- Inclure 2 à 6 lignes détaillées typiques (item_type: "material", "service", "labor", "transport", "equipment" ou "free")
- Avoir des prix cohérents avec les fourchettes marché ci-dessus (base_price_ht et base_cost_ht estimés)
- Être calibré comme l'onglet devis : base_price_ht = total HT présenté au client, base_cost_ht = coût interne total, marge positive. Les lignes internes (labor, transport, equipment) ont is_internal=true, unit_price_ht=0 et unit_cost_ht renseigné. Les lignes visibles ont un prix client et, si possible, leur coût interne.
- Utiliser les bonnes unités et catégories du secteur
- Respecter le taux de TVA applicable (10% pour travaux rénovation, 20% sinon)
- Respecter la typographie française : pas de majuscule à chaque mot dans les noms, descriptions et lignes. Garde les majuscules seulement pour noms propres, marques, acronymes et références techniques (PVC, TIG, S235).

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
        { "designation": "Libellé ligne", "quantity": 1, "unit": "forfait", "item_type": "service", "unit_price_ht": 0, "unit_cost_ht": 0, "is_internal": false }
      ],
      "confidence": { "name": "high", "unit": "high", "base_price_ht": "low" }
    }
  ]
}`
}

function buildPresetsUserPrompt(ctx: ReturnType<typeof getCatalogAIPromptContext>, description: string): string {
  const base = `Génère des ${ctx.bundleTemplateLabel.toLowerCase()}s types pour une entreprise de ${ctx.activityLabel}.`
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
    if (item.kind === 'prestation_type') {
      return ensurePrestationMargin(item as CatalogDraftPrestationType)
    }

    if (item.kind === 'labor_rate') {
      return {
        ...item,
        designation: normalizeFrenchSentenceCase((item as CatalogDraftLaborRate).designation) ?? (item as CatalogDraftLaborRate).designation,
        description: normalizeFrenchSentenceCase((item as CatalogDraftLaborRate).description) ?? (item as CatalogDraftLaborRate).description,
      } as CatalogDraftLaborRate
    }

    if (item.kind !== 'material' && item.kind !== 'service') return item

    const material = { ...item } as CatalogDraftMaterial
    material.name = normalizeFrenchSentenceCase(material.name) ?? material.name
    material.description = normalizeFrenchSentenceCase(material.description) ?? material.description
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

    if (!await hasPermission('catalog.edit')) {
      return NextResponse.json({ error: 'Action non autorisée.' }, { status: 403 })
    }

    const orgId = await getCurrentOrganizationId()
    if (!orgId) return NextResponse.json({ error: 'Organisation introuvable.' }, { status: 400 })

    const { data: org } = await supabase
      .from('organizations')
      .select('sector, business_profile, business_activity_id')
      .eq('id', orgId)
      .single()

    const catalogCtx = resolveCatalogContext(org ?? undefined)
    const promptCtx = getCatalogAIPromptContext(catalogCtx)

    const [materialsRes, laborRatesRes, prestationTypesRes] = await Promise.all([
      supabase
        .from('materials')
        .select('name, unit, purchase_price, sale_price, category, item_kind')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(15),
      supabase
        .from('labor_rates')
        .select('designation, unit, cost_rate, rate, category')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(10),
      supabase
        .from('prestation_types')
        .select('name, unit, sale_price_ht, category')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(10),
    ])

    const existingSnapshot: ExistingCatalogSnapshot | undefined =
      (materialsRes.data?.length || laborRatesRes.data?.length || prestationTypesRes.data?.length)
        ? {
            materials: (materialsRes.data ?? []).map((m: any) => ({
              name: m.name,
              unit: m.unit,
              purchase_price: m.purchase_price,
              sale_price: m.sale_price,
              category: m.category,
            })),
            laborRates: (laborRatesRes.data ?? []).map((lr: any) => ({
              designation: lr.designation,
              unit: lr.unit,
              cost_rate: lr.cost_rate,
              rate: lr.rate,
              category: lr.category,
            })),
            prestationTypes: (prestationTypesRes.data ?? []).map((pt: any) => ({
              name: pt.name,
              unit: pt.unit,
              base_price_ht: pt.sale_price_ht ?? 0,
              category: pt.category,
            })),
          }
        : undefined

    const systemPrompt = buildSystemPrompt(promptCtx, existingSnapshot)

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
      ? buildPresetsSystemPrompt(promptCtx, existingSnapshot)
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
            text: `Extrais tous les éléments de catalogue présents dans ce document. Utilise le vocabulaire métier "${promptCtx.activityLabel}" : ${promptCtx.materialLabel.toLowerCase()}s, ${promptCtx.serviceLabel.toLowerCase()}s, ${promptCtx.laborRateLabel.toLowerCase()}s, ${promptCtx.bundleTemplateLabel.toLowerCase()}s.`,
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
        content: buildUserPrompt(userText, promptCtx),
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
    if (err instanceof AIQuotaExceededError) {
      return NextResponse.json({ error: "Quota mensuel d'extractions catalogue atteint." }, { status: 402 })
    }
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
