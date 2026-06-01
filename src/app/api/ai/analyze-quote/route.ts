import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { resolveCatalogContext, getBusinessActivityById } from '@/lib/catalog-context'
import { getInternalResourceUnitCost } from '@/lib/catalog-ui'
import { APP_NAME } from '@/lib/brand'
import { AIModuleDisabledError, AIRateLimitError, callAI } from '@/lib/ai/callAI'
import { AIQuotaExceededError } from '@/lib/quota'
import { fetchRAGContext } from '@/lib/ai/rag'
import { getCurrentMembershipContext, hasPermission } from '@/lib/data/queries/membership'

export type AIQuoteItem = {
  designation: string
  details?: string | null
  description: string
  quantity: number
  unit: string
  unit_price: number
  unit_cost_ht?: number | null  // coût interne unitaire (jamais affiché au client)
  ai_confidence?: number | null
  ai_source?: 'catalog' | 'recent_quote' | 'memory' | 'client_input' | 'ai_estimate' | 'document' | null
  ai_warnings?: string[]
  vat_rate: number
  is_estimated: boolean  // true = prix estimé par l'IA (absent du catalogue)
  is_internal?: boolean  // true = coût interne masqué du devis client
  dim_quantity?: number  // multiplicateur dimensionnel (ex: 3 pièces de 4×5m)
  length_m?: number | null
  width_m?: number | null
  height_m?: number | null
  dimension_pricing_mode?: 'none' | 'linear' | 'area' | 'volume' | null
}

export type AIQuoteSection = {
  title: string
  items: AIQuoteItem[]
}

export type AIQuoteResult = {
  title: string
  clientName?: string | null
  sections: AIQuoteSection[]
}

export type AIQuoteMultiResult = {
  quotes: AIQuoteResult[]
}

const TEXT_MODEL = 'google/gemini-2.5-flash-lite'
const VISION_MODEL = 'google/gemini-2.5-flash-lite'
const FALLBACK_MODEL = 'anthropic/claude-sonnet-4-6'
const FAST_MODEL_TIMEOUT_MS = 35_000
const FALLBACK_MODEL_TIMEOUT_MS = 45_000
const AI_CONTEXT_CACHE_MS = 5 * 60 * 1000

type QuoteAIContext = {
  context: string
  sector: string
  activityId: string | null
  activityDescription: string | null
  clientsContext: string
}

const aiContextCache = new Map<string, { expiresAt: number; value: QuoteAIContext }>()

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  // Essaie un objet, puis un tableau
  const obj = text.match(/\{[\s\S]*\}/)
  if (obj) return obj[0]
  const arr = text.match(/\[[\s\S]*\]/)
  if (arr) return arr[0]
  return text.trim()
}

function looksInternalLine(sectionTitle: string | null | undefined, description: string | null | undefined): boolean {
  const haystack = `${sectionTitle ?? ''} ${description ?? ''}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')

  return [
    'main d oeuvre',
    'main-d oeuvre',
    'main doeuvre',
    'mo interne',
    'ressource interne',
    'ressources internes',
    'cout interne',
    'cout de revient',
    'deplacement',
    'transport',
    'carburant',
    'frais de route',
    'coordination interne',
    'preparation interne',
  ].some(token => haystack.includes(token))
}

function quoteTotals(quote: AIQuoteResult): { visibleHt: number; internalHt: number } {
  return quote.sections.reduce(
    (totals, section) => {
      for (const item of section.items) {
        const amount = Math.max(0, Number(item.quantity) || 0) * Math.max(0, Number(item.unit_price) || 0)
        if (item.is_internal) totals.internalHt += amount
        else totals.visibleHt += amount
      }
      return totals
    },
    { visibleHt: 0, internalHt: 0 },
  )
}

function appendIncludedDetails(description: string, details: string[]): string {
  const cleanDetails = details
    .map(detail => detail.trim())
    .filter(Boolean)

  if (cleanDetails.length === 0) return description

  const prefix = description.trim()
  const includedBlock = `\n\nComprend :\n${cleanDetails.map(detail => `- ${detail}`).join('\n')}`
  const nextDescription = `${prefix}${includedBlock}`

  // L'UI et la validation gardent les descriptions de lignes à 500 caractères.
  return nextDescription.length <= 500
    ? nextDescription
    : `${nextDescription.slice(0, 497).trimEnd()}...`
}

function splitStructuredDescription(value: string | null | undefined): { designation: string; details: string | null } {
  const raw = value?.replace(/\r\n/g, '\n').trim()
  if (!raw) return { designation: '', details: null }
  const parts = raw.split(/\n\n?Comprend\s*:\s*/i)
  return {
    designation: parts[0]?.trim() ?? '',
    details: parts.length > 1 ? parts.slice(1).join('\nComprend : ').trim() : null,
  }
}

function composeStructuredDescription(designation: string | null | undefined, details: string | null | undefined, fallback?: string | null): string {
  const fallbackParts = splitStructuredDescription(fallback)
  const cleanDesignation = designation?.trim() || fallbackParts.designation
  const cleanDetails = details?.trim() || fallbackParts.details
  return cleanDetails ? `${cleanDesignation}\n\nComprend :\n${cleanDetails}` : cleanDesignation
}

function clampConfidence(value: unknown): number | null {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(1, Math.round(n * 100) / 100))
}

function compactIncludedZeroPriceItems(quote: AIQuoteResult): AIQuoteResult {
  return {
    ...quote,
    sections: quote.sections.map(section => {
      const items: AIQuoteItem[] = []
      let pendingIncludedDetails: string[] = []
      let lastVisibleBillableIndex: number | null = null

      for (const item of section.items) {
        const amount = Math.max(0, Number(item.quantity) || 0) * Math.max(0, Number(item.unit_price) || 0)
        const isVisibleZeroLine = item.is_internal !== true && amount === 0 && item.description?.trim()

        if (isVisibleZeroLine) {
          if (lastVisibleBillableIndex !== null) {
            const billableItem = items[lastVisibleBillableIndex]
            items[lastVisibleBillableIndex] = {
              ...billableItem,
              description: appendIncludedDetails(billableItem.description, [item.description]),
            }
          } else {
            pendingIncludedDetails.push(item.description)
          }
          continue
        }

        const isVisibleBillableLine = item.is_internal !== true && amount > 0
        const nextItem = isVisibleBillableLine && pendingIncludedDetails.length > 0
          ? {
              ...item,
              description: appendIncludedDetails(item.description, pendingIncludedDetails),
            }
          : item

        items.push(nextItem)
        pendingIncludedDetails = []

        if (isVisibleBillableLine) {
          lastVisibleBillableIndex = items.length - 1
        }
      }

      if (pendingIncludedDetails.length > 0 && lastVisibleBillableIndex !== null) {
        const billableItem = items[lastVisibleBillableIndex]
        items[lastVisibleBillableIndex] = {
          ...billableItem,
          description: appendIncludedDetails(billableItem.description, pendingIncludedDetails),
        }
      }

      return { ...section, items }
    }).filter(section => section.items.length > 0),
  }
}

function enforceNonDeficitMargin(quote: AIQuoteResult): AIQuoteResult {
  const { visibleHt, internalHt } = quoteTotals(quote)
  if (internalHt <= 0 || visibleHt <= 0) return quote

  // Minimum 20% de marge brute sur les coûts internes estimés.
  const minimumVisibleHt = Math.ceil(internalHt * 1.2 * 100) / 100
  if (visibleHt >= minimumVisibleHt) return quote

  const upliftFactor = minimumVisibleHt / visibleHt

  return {
    ...quote,
    sections: quote.sections.map(section => ({
      ...section,
      items: section.items.map(item => {
        if (item.is_internal) return item
        return {
          ...item,
          unit_price: Math.ceil((Number(item.unit_price) || 0) * upliftFactor * 100) / 100,
          is_estimated: item.is_estimated || upliftFactor > 1.01,
        }
      }),
    })),
  }
}

function isAllCapsWord(word: string): boolean {
  const letters = word.replace(/[^\p{L}]/gu, '')
  return letters.length > 0 && letters === letters.toLocaleUpperCase('fr-FR')
}

function shouldKeepUppercaseWord(word: string): boolean {
  const letters = word.replace(/[^\p{L}]/gu, '')
  return /\d/.test(word) || (letters.length <= 4 && isAllCapsWord(word))
}

function normalizeFrenchSentenceCase(value: string | null | undefined): string {
  const compact = value?.replace(/\s+/g, ' ').trim()
  if (!compact) return ''

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

function normalizeAIQuote(quote: AIQuoteResult): AIQuoteResult {
  const normalized = {
    ...quote,
    title: normalizeFrenchSentenceCase(quote.title) || quote.title,
    clientName: typeof quote.clientName === 'string' && quote.clientName.trim() ? quote.clientName.trim() : null,
    sections: quote.sections.map(section => ({
      ...section,
      title: normalizeFrenchSentenceCase(section.title) || section.title,
      items: section.items.map(item => {
        const designation = normalizeFrenchSentenceCase(item.designation) || normalizeFrenchSentenceCase(splitStructuredDescription(item.description).designation) || item.designation || item.description
        const details = item.details?.trim() || splitStructuredDescription(item.description).details
        const description = composeStructuredDescription(designation, details, item.description)
        return {
          ...item,
          designation,
          details,
          description,
          ai_confidence: clampConfidence(item.ai_confidence),
          ai_source: item.ai_source ?? (item.is_estimated ? 'ai_estimate' : 'client_input'),
          ai_warnings: Array.isArray(item.ai_warnings) ? item.ai_warnings.filter(Boolean).slice(0, 5) : [],
          is_internal: item.is_internal === true || looksInternalLine(section.title, description),
        }
      }),
    })),
  }

  return enforceNonDeficitMargin(compactIncludedZeroPriceItems(normalized))
}

// Charge le catalogue, les postes récents et les infos de l'org pour enrichir le contexte IA
async function loadCatalogContext(orgId: string): Promise<{ context: string; sector: string; activityId: string | null; activityDescription: string | null }> {
  const supabase = await createClient()

  const [
    { data: org },
    { data: materials },
    { data: laborRates },
    { data: recentItems },
  ] = await Promise.all([
    supabase
      .from('organizations')
      .select('sector, name, business_profile, business_activity_id')
      .eq('id', orgId)
      .single(),
    supabase
      .from('materials')
      .select('id, name, unit, sale_price, item_kind, dimension_pricing_enabled')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .order('name')
      .limit(150),
    supabase
      .from('labor_rates')
      .select('designation, unit, rate, cost_rate')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .order('designation')
      .limit(100),
    supabase
      .from('quote_items')
      .select('description, unit, unit_price')
      .eq('organization_id', orgId)
      .not('unit_price', 'eq', 0)
      .order('created_at', { ascending: false })
      .limit(80),
  ])

  // Variantes tarifaires pour les articles/services qui en ont
  const materialIds = (materials ?? []).map((m: { id: string }) => m.id)
  const { data: variants } = materialIds.length > 0
    ? await supabase
        .from('material_price_variants')
        .select('material_id, label, unit_price_ht, unit')
        .in('material_id', materialIds)
        .order('label')
    : { data: [] }

  const variantsByMaterial: Record<string, Array<{ label: string; unit_price_ht: number; unit: string | null }>> = {}
  for (const v of (variants ?? [])) {
    const vid = (v as { material_id: string }).material_id
    if (!variantsByMaterial[vid]) variantsByMaterial[vid] = []
    variantsByMaterial[vid].push(v as { label: string; unit_price_ht: number; unit: string | null })
  }

  const catalogContextConfig = resolveCatalogContext({
    sector: org?.sector,
    business_profile: org?.business_profile,
    business_activity_id: org?.business_activity_id,
  })
  const sector = catalogContextConfig.sectorFallback
  const activityHint = sector ? ` - métier : ${sector}` : ''
  const lines: string[] = []

  if (materials && materials.length > 0) {
    lines.push(`## Catalogue articles et services${activityHint} (utilise ces prix en priorité si la description correspond) :`)
    for (const m of materials as Array<{ id: string; name: string; unit: string | null; sale_price: number | null; item_kind: string | null; dimension_pricing_enabled: boolean }>) {
      const kindLabel = m.item_kind === 'service' ? '[service]' : '[article]'
      const dimLabel = m.dimension_pricing_enabled ? ' [prix dimensionnel]' : ''
      const mvariants = variantsByMaterial[m.id] ?? []
      if (mvariants.length > 0) {
        lines.push(`- ${m.name} ${kindLabel}${dimLabel} | variantes :`)
        for (const v of mvariants) {
          lines.push(`    • ${v.label} | ${v.unit ?? m.unit ?? 'u'} | ${v.unit_price_ht} € HT`)
        }
      } else {
        lines.push(`- ${m.name} ${kindLabel}${dimLabel} | ${m.unit ?? 'u'} | ${m.sale_price ?? 0} € HT`)
      }
    }
  }

  if (laborRates && laborRates.length > 0) {
    lines.push('\n## Ressources internes (utilise ces couts en priorité pour estimer la main-d\'oeuvre interne) :')
    for (const l of laborRates) {
      lines.push(`- ${l.designation} | ${l.unit ?? 'h'} | ${getInternalResourceUnitCost(l as { cost_rate: number | null; rate: number | null })} € HT`)
    }
  }

  // Déduplique les postes récents par description normalisée
  if (recentItems && recentItems.length > 0) {
    const seen = new Set<string>()
    const unique = recentItems.filter(i => {
      const key = (i.description ?? '').toLowerCase().trim().slice(0, 60)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    if (unique.length > 0) {
      lines.push('\n## Postes de devis récents (prix déjà utilisés par cette entreprise) :')
      for (const i of unique) {
        lines.push(`- ${i.description} | ${i.unit ?? 'u'} | ${i.unit_price} € HT`)
      }
    }
  }

  const activity = getBusinessActivityById(org?.business_activity_id ?? null)
  const activityDescription = activity?.description ?? null

  return { context: lines.join('\n'), sector, activityId: org?.business_activity_id ?? null, activityDescription }
}

async function loadClientsContext(orgId: string): Promise<string> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('clients')
    .select('company_name, contact_name, first_name, last_name, email, phone, status, source, city')
    .eq('organization_id', orgId)
    .eq('is_archived', false)
    .in('status', ['active', 'prospect', 'lead_hot', 'lead_cold'])
    .order('created_at', { ascending: false })
    .limit(120)

  if (!data?.length) return ''

  const lines = data.map(client => {
    const fullName = [client.first_name, client.last_name].filter(Boolean).join(' ')
    const label = client.company_name || client.contact_name || fullName || client.email || 'Client sans nom'
    const contact = [client.contact_name, fullName !== label ? fullName : null, client.email, client.phone].filter(Boolean).join(' | ')
    return `- ${label} | statut: ${client.status ?? 'non renseigne'}${client.city ? ` | ville: ${client.city}` : ''}${contact ? ` | contact: ${contact}` : ''}${client.source ? ` | source: ${client.source}` : ''}`
  })

  return lines.join('\n')
}

async function loadQuoteAIContext(orgId: string): Promise<QuoteAIContext> {
  const cached = aiContextCache.get(orgId)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const [catalog, clientsContext] = await Promise.all([
    loadCatalogContext(orgId),
    loadClientsContext(orgId),
  ])

  const value: QuoteAIContext = { ...catalog, clientsContext }
  aiContextCache.set(orgId, { expiresAt: Date.now() + AI_CONTEXT_CACHE_MS, value })
  return value
}

function buildSystemPrompt(catalogContext: string, sector: string, ragContext: string, activityDescription: string | null, clientsContext: string): string {
  const hasCatalog = catalogContext.trim().length > 0
  const activityContext = activityDescription ? `\nSpécificité métier : ${activityDescription}` : ''
  const clientContextBlock = clientsContext.trim()
    ? `\n## Clients, prospects et leads connus\nUtilise cette liste uniquement pour associer \`clientName\` quand la correspondance est forte (nom, société, email ou téléphone très proche). En cas d'ambiguïté, garde le nom détecté mais ajoute un warning sur les lignes concernées ou au devis.\n${clientsContext}\n`
    : ''

  return `Tu t'appelles Sarah. Tu es chiffreuse et experte devis chez ATELIER by Orsayn. Tu travailles pour une entreprise française du métier : **${sector}**.${activityContext} À partir d'une description de travaux, tu extrais et structures les postes en sections et lignes de devis, et tu estimes la main-d'oeuvre nécessaire.

Tu parles comme un pro du terrain : direct, précis, sans jargon inutile. Tu connais ton métier sur le bout des doigts.
${clientContextBlock}
${hasCatalog ? `
${catalogContext}

## Instructions de pricing et catalogue (priorité absolue)
1. **Correspondance catalogue** : si la désignation correspond EXACTEMENT ou TRÈS ÉTROITEMENT à un élément du catalogue ci-dessus → utilise son prix et son unité. Si l'article a des variantes (ex: couleur, dimensions, matière), choisis la variante la plus pertinente et note-la dans la description. Mets \`is_estimated: false\`. Pour les articles (pas les services), renseigne aussi \`unit_cost_ht\` avec le coût d'achat catalogue si connu, sinon estime-le.
2. **Correspondance devis récents** : si le poste correspond à un poste déjà facturé → utilise ce prix. Mets \`is_estimated: false\`.
3. **Estimation IA** : si aucune correspondance → estime un prix réaliste pour le secteur **${sector}** et le corps de métier concerné. Mets \`is_estimated: true\`. Arrondis toujours à la dizaine supérieure (ex: 47 → 50, 123 → 130).
4. **Coût interne \`unit_cost_ht\`** : pour toute ligne visible (is_internal: false), estime le coût interne unitaire (coût d'achat matière, coût de sous-traitance, coût de revient). Ce champ n'est jamais affiché au client, il sert uniquement au calcul de marge en interne. Arrondis à la dizaine inférieure pour être conservateur. Si tu ne peux pas estimer, laisse null.
- Les articles marqués **[prix dimensionnel]** ont un prix calculé selon les dimensions (m², ml, m³) : utilise la surface ou longueur mentionnée dans la description comme quantité.
- Les éléments marqués **[service]** sont des prestations de main-d'œuvre ou services : inclus-les dans la section "Main-d'œuvre" ou dans la section concernée selon le contexte.
- Ne jamais laisser unit_price à 0.
- Ne crée jamais un devis déficitaire : les coûts internes doivent être répercutés dans les lignes visibles par le client, par exemple en ajustant les quantités, forfaits ou prix visibles.
- Si tu utilises des prix catalogue visibles mais que les coûts internes rendent le devis déficitaire, ajoute une marge de sécurité dans les lignes visibles tout en gardant les coûts internes masqués.
` : `
- Si le prix n'est pas mentionné dans la description, estime un prix réaliste pour le secteur **${sector}** et mets \`is_estimated: true\`. Arrondis toujours à la dizaine supérieure.
- Pour toute ligne visible (is_internal: false), renseigne \`unit_cost_ht\` avec le coût interne unitaire estimé quand c'est possible (achat, sous-traitance, coût de revient). Laisse null uniquement si tu ne peux vraiment pas l'estimer.
- Ne crée jamais un devis déficitaire : répercute les coûts internes dans les lignes visibles par le client.
`}
## Détection de plusieurs devis
Si la description contient plusieurs projets ou chantiers **clairement distincts et séparés** (ex: "chantier A : ... / chantier B : ...", ou plusieurs adresses, ou plusieurs clients), génère un devis séparé pour chacun.
Si c'est un seul projet (même s'il a plusieurs corps de métier), génère un seul devis.

## Présentation commerciale des forfaits et contrats récurrents
- Si le client demande un forfait mensuel, un abonnement, un contrat d'entretien, une prestation récurrente ou un lot global, crée une ligne facturable principale avec le prix du forfait.
- Les tâches incluses dans ce forfait ne doivent PAS devenir des lignes séparées à 0 €. Ajoute-les dans la description de la ligne principale sous forme courte, par exemple : "Comprend : nettoyage des sols, dépoussiérage des rampes, entretien du local poubelles, contrôle visuel".
- Crée une ligne séparée uniquement pour une prestation réellement vendue séparément ou optionnelle avec son propre prix (ex: vitrerie mensuelle, remise en état initiale, désinfection ponctuelle).
- N'utilise jamais de ligne visible à 0 € pour détailler le contenu d'une offre. Une ligne visible doit correspondre à ce que le client achète et doit avoir un prix HT.
- Exemple attendu : 1 ligne "Forfait mensuel entretien parties communes" avec quantité 1, unité "mois" ou "forfait", prix HT, et la liste des tâches incluses dans la description. Puis éventuellement 1 ligne "Vitrerie mensuelle des halls" et 1 ligne optionnelle "Remise en état initiale".

Retourne UNIQUEMENT un objet JSON valide avec cette structure exacte :
{
  "quotes": [
    {
      "clientName": "Nom du client mentionné, ou null si aucun client clair",
      "title": "Titre court du projet (5-8 mots, professionnel, ex: Réfection toiture bâtiment nord)",
      "sections": [
        {
          "title": "Nom de la section (ex: Maçonnerie, Électricité, Plomberie...)",
          "items": [
            {
              "designation": "Désignation courte du produit, service ou poste",
              "details": "Précisions utiles, inclusions, contraintes techniques ou null",
              "description": "Fallback lisible : designation + détails inclus",
              "quantity": 20,
              "unit": "m²",
              "unit_price": 100,
              "unit_cost_ht": 60,
              "ai_confidence": 0.86,
              "ai_source": "catalog",
              "ai_warnings": [],
              "vat_rate": 20,
              "is_estimated": false,
              "is_internal": false,
              "dimension_pricing_mode": "area",
              "length_m": 4,
              "width_m": 5,
              "dim_quantity": 1
            }
          ]
        }
      ]
    }
  ]
}
Le tableau "quotes" contient toujours au moins 1 élément.

## Main-d'œuvre - règle importante :
Dans un cahier des charges, le client décrit rarement la main-d'œuvre à déployer, c'est l'entreprise qui en décide. Si la MO n'est PAS mentionnée dans le document, tu dois estimer et inclure les postes de main-d'œuvre nécessaires pour réaliser les travaux :
- Cherche d'abord dans les "Ressources internes" ci-dessus. Si tu trouves une désignation correspondante → utilise ce cout de reference, mets \`is_estimated: false\`.
- Si aucune correspondance dans le catalogue MO → estime un taux horaire ou forfaitaire réaliste pour le secteur **${sector}** et le type de poste. Mets \`is_estimated: true\`. Arrondis à la dizaine supérieure.
- Si la MO est déjà explicitement mentionnée dans le document (nombre de personnes, heures, équipes…) → extrais-la telle quelle et n'en rajoute pas d'autre.
- Regroupe les postes MO dans une section dédiée "Main-d'œuvre" ou intègre-les dans les sections pertinentes selon le contexte.
- Estime des quantités d'heures réalistes en fonction de l'ampleur des travaux décrits.
- Toutes les lignes de main-d'œuvre, déplacement, transport, carburant, frais de route, marge interne, préparation interne, coordination interne ou coût de revient doivent avoir \`is_internal: true\`.
- Ces lignes internes servent au calcul de marge de l'entreprise et ne doivent pas être visibles sur le devis client.
- Après avoir ajouté ces coûts internes, vérifie la marge : le total HT visible client doit toujours couvrir les coûts internes avec une marge positive. Si ce n'est pas le cas, augmente les quantités, forfaits ou prix des lignes visibles, jamais les lignes internes.

${ragContext ? `\n## Mémoire de l'entreprise (devis et tarifs de référence issus de projets passés) :\n${ragContext}\n\n` : ''}Règles générales :
- Si un nom de client, entreprise, particulier, adresse email ou contact est mentionné, renseigne \`clientName\` avec la chaîne la plus précise. Pour plusieurs devis avec plusieurs clients, renseigne le bon \`clientName\` sur chaque devis.
- Le champ \`title\` doit synthétiser le projet en un titre court et professionnel. Si un titre ou nom de chantier est explicitement mentionné dans le document, utilise-le. Sinon, forge un titre clair (ex: "Bardage acier façade entrepôt B", "Rénovation cuisine appartement 3e étage").
- Typographie française obligatoire : pas de Title Case / majuscule à chaque mot dans les titres, sections et descriptions. Utilise la casse phrase ("Pose de tableau électrique", pas "Pose De Tableau Électrique"). Garde les majuscules uniquement pour les noms propres, marques, acronymes et références techniques (PVC, TIG, S235).
- Chaque ligne doit distinguer \`designation\` et \`details\` : la designation est courte et commerciale ("Pose de carrelage mural"), details contient les précisions ("Comprend préparation support, colle, joints, nettoyage"). Ne mets pas toute la ligne dans \`details\`.
- \`description\` doit rester un fallback compatible : reprends la designation, puis si details existe ajoute "Comprend :" et les détails.
- \`ai_confidence\` vaut 0 à 1. Baisse la confiance si quantité absente, plan peu lisible, prix estimé, client ambigu ou document incomplet.
- \`ai_source\` vaut exactement "catalog", "recent_quote", "memory", "client_input", "ai_estimate" ou "document".
- \`ai_warnings\` contient des messages courts uniquement si une vérification humaine est utile.
- Regroupe les postes par corps de métier ou par zone (ex: Cuisine, Salle de bain)
- TVA : 10% pour rénovation logement existant, 20% par défaut (neuf, travaux neufs)
- Unités courantes : u (unité), m² (mètre carré), ml (mètre linéaire), m³ (mètre cube), h (heure), forfait
- Si des quantités sont mentionnées dans la description, extrais-les ; sinon mets 1
- **Tarification dimensionnelle** : si un poste a des dimensions explicites (ex: "3 pièces de 4×5m", "cloison de 2,5m × 12m", "2 longueurs de 8ml"), utilise les champs \`dimension_pricing_mode\`, \`length_m\`, \`width_m\`, \`height_m\` et \`dim_quantity\` (multiplicateur d'unités). La \`quantity\` finale = dim_quantity × (L × l ou L ou L × l × H). Si le poste n'a pas de dimensions explicites, laisse \`dimension_pricing_mode\` à null ou "none".
  - mode "linear" : longueur seule en mètres → unité = ml
  - mode "area" : longueur × largeur en mètres → unité = m²
  - mode "volume" : longueur × largeur × hauteur en mètres → unité = m³
  - dim_quantity = nombre d'unités identiques (ex: 3 pièces identiques → dim_quantity = 3)
- Sois précis dans les descriptions pour que l'artisan comprenne le travail attendu
- Ne génère pas de sections vides
- Minimum 1 section avec au moins 1 ligne`
}

function parseQuotesFromAIRaw(raw: string): AIQuoteResult[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(extractJson(raw))
  } catch {
    console.error('[ai/analyze-quote] JSON parse error', { responseLength: raw.length })
    return null
  }

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>
    if (Array.isArray(obj.quotes)) return obj.quotes as AIQuoteResult[]
    if (Array.isArray(obj.sections)) return [parsed as AIQuoteResult]
    return null
  }
  if (Array.isArray(parsed)) return parsed as AIQuoteResult[]
  return null
}

function quoteNeedsFallback(quotes: AIQuoteResult[]): boolean {
  if (quotes.length === 0) return true
  const items = quotes.flatMap(quote => quote.sections?.flatMap(section => section.items ?? []) ?? [])
  if (items.length === 0) return true
  const missingStructuredFields = items.filter(item => !item.designation?.trim()).length
  const lowConfidence = items.filter(item => typeof item.ai_confidence === 'number' && item.ai_confidence < 0.55).length
  return missingStructuredFields > Math.max(1, items.length * 0.25) || lowConfidence > Math.max(2, items.length * 0.4)
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  }
  const userId = user.id

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

  const orgId = await getCurrentOrganizationId()
  const contentType = req.headers.get('content-type') ?? ''
  let model: string
  let messages: { role: string; content: any }[]

  // Extraire la description tôt pour l'embedding RAG, avant le chargement catalogue
  let formDataCache: FormData | null = null
  let bodyCache: { text?: string } | null = null
  let queryText = 'devis chantier BTP'

  if (contentType.includes('multipart/form-data')) {
    formDataCache = await req.formData()
    const desc = (formDataCache.get('description') as string | null)?.trim()
    if (desc) queryText = desc
  } else {
    bodyCache = await req.json()
    if (bodyCache?.text?.trim()) queryText = bodyCache.text.trim()
  }

  const context = orgId
    ? await loadQuoteAIContext(orgId)
    : { context: '', sector: 'BTP', activityId: null, activityDescription: null, clientsContext: '' }
  const ragContext = orgId
    ? await fetchRAGContext(orgId, queryText, { activityId: context.activityId })
    : ''
  const systemPrompt = buildSystemPrompt(context.context, context.sector, ragContext, context.activityDescription, context.clientsContext)

  if (contentType.includes('multipart/form-data')) {
    const formData = formDataCache!
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 })
    if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: 'Fichier trop volumineux (max 10 Mo)' }, { status: 400 })

    const userDescription = (formData.get('description') as string | null)?.trim() || null

    const arrayBuffer = await file.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString('base64')
    const mimeType = file.type || 'application/pdf'

    const userPrompt = userDescription
      ? `Analyse ce document et structure les travaux en sections et lignes de devis.\n\nPrécisions de l'utilisateur : ${userDescription}\n\nRetourne uniquement le JSON.`
      : 'Analyse ce document et structure les travaux en sections et lignes de devis. Retourne uniquement le JSON.'

    model = VISION_MODEL
    messages = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
          { type: 'text', text: userPrompt },
        ],
      },
    ]
  } else {
    const text: string = bodyCache?.text ?? ''
    if (!text || text.trim().length < 5) {
      return NextResponse.json({ error: 'Texte trop court' }, { status: 400 })
    }
    model = TEXT_MODEL
    messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Description des travaux :\n${text.trim()}\n\nRetourne uniquement le JSON.` },
    ]
  }

  try {
    async function callQuoteModel(modelName: string, timeoutMs: number): Promise<AIQuoteResult[] | null> {
      const { data } = await callAI<any>({
        organizationId: orgId ?? userId,
        provider: 'openrouter',
        feature: 'quote_analysis',
        model: modelName,
        inputKind: contentType.includes('multipart/form-data') ? 'mixed' : 'text',
        request: {
          body: {
            messages,
            temperature: modelName === FALLBACK_MODEL ? 0.1 : 0.2,
            max_tokens: 4096,
          },
          timeoutMs,
        },
        metadata: {
          route: 'api/ai/analyze-quote',
          app_name: APP_NAME,
          fallback: modelName === FALLBACK_MODEL,
        },
      })

      return parseQuotesFromAIRaw(data.choices?.[0]?.message?.content ?? '')
    }

    let quotes: AIQuoteResult[] | null = null
    try {
      quotes = await callQuoteModel(model, FAST_MODEL_TIMEOUT_MS)
    } catch (fastErr) {
      if (fastErr instanceof AIQuotaExceededError || fastErr instanceof AIModuleDisabledError || fastErr instanceof AIRateLimitError) {
        throw fastErr
      }
      console.warn('[ai/analyze-quote] fast model error, trying fallback', fastErr instanceof Error ? fastErr.message : fastErr)
    }
    if (!quotes || quoteNeedsFallback(quotes)) {
      console.warn('[ai/analyze-quote] fast model insufficient, trying fallback')
      quotes = await callQuoteModel(FALLBACK_MODEL, FALLBACK_MODEL_TIMEOUT_MS)
    }

    if (!quotes) {
      return NextResponse.json({ error: 'Réponse IA invalide, veuillez réessayer' }, { status: 500 })
    }

    quotes = quotes
      .filter(q => Array.isArray(q.sections) && q.sections.length > 0)
      .map(normalizeAIQuote)
    if (quotes.length === 0) {
      return NextResponse.json({ error: 'Structure IA invalide' }, { status: 500 })
    }

    const result: AIQuoteMultiResult = { quotes }

    return NextResponse.json(result)
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
    console.error('[ai/analyze-quote]', err)
    return NextResponse.json({ error: 'Erreur lors de l\'analyse IA' }, { status: 500 })
  }
}
