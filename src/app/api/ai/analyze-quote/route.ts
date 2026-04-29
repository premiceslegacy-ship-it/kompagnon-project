import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { resolveCatalogContext, getBusinessActivityById } from '@/lib/catalog-context'
import { getInternalResourceUnitCost } from '@/lib/catalog-ui'
import { APP_NAME } from '@/lib/brand'
import { AIModuleDisabledError, AIRateLimitError, callAI } from '@/lib/ai/callAI'
import { fetchRAGContext } from '@/lib/ai/rag'

export type AIQuoteItem = {
  description: string
  quantity: number
  unit: string
  unit_price: number
  vat_rate: number
  is_estimated: boolean  // true = prix estimé par l'IA (absent du catalogue)
  is_internal?: boolean  // true = coût interne masqué du devis client
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

function normalizeAIQuote(quote: AIQuoteResult): AIQuoteResult {
  const normalized = {
    ...quote,
    clientName: typeof quote.clientName === 'string' && quote.clientName.trim() ? quote.clientName.trim() : null,
    sections: quote.sections.map(section => ({
      ...section,
      items: section.items.map(item => ({
        ...item,
        is_internal: item.is_internal === true || looksInternalLine(section.title, item.description),
      })),
    })),
  }

  return enforceNonDeficitMargin(normalized)
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
  const activityHint = sector ? ` — métier : ${sector}` : ''
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

function buildSystemPrompt(catalogContext: string, sector: string, ragContext: string, activityDescription: string | null): string {
  const hasCatalog = catalogContext.trim().length > 0
  const activityContext = activityDescription ? `\nSpécificité métier : ${activityDescription}` : ''

  return `Tu es un assistant IA expert en devis pour une entreprise française du métier : **${sector}**.${activityContext} À partir d'une description de travaux, tu dois extraire et structurer les postes de travaux en sections et lignes de devis, ET estimer la main-d'œuvre nécessaire.
${hasCatalog ? `
${catalogContext}

## Instructions de pricing et catalogue (priorité absolue)
1. **Correspondance catalogue** : si la désignation correspond EXACTEMENT ou TRÈS ÉTROITEMENT à un élément du catalogue ci-dessus → utilise son prix et son unité. Si l'article a des variantes (ex: couleur, dimensions, matière), choisis la variante la plus pertinente et note-la dans la description. Mets \`is_estimated: false\`.
2. **Correspondance devis récents** : si le poste correspond à un poste déjà facturé → utilise ce prix. Mets \`is_estimated: false\`.
3. **Estimation IA** : si aucune correspondance → estime un prix réaliste pour le secteur **${sector}** et le corps de métier concerné. Mets \`is_estimated: true\`. Arrondis toujours à la dizaine supérieure (ex: 47 → 50, 123 → 130).
- Les articles marqués **[prix dimensionnel]** ont un prix calculé selon les dimensions (m², ml, m³) : utilise la surface ou longueur mentionnée dans la description comme quantité.
- Les éléments marqués **[service]** sont des prestations de main-d'œuvre ou services : inclus-les dans la section "Main-d'œuvre" ou dans la section concernée selon le contexte.
- Ne jamais laisser unit_price à 0.
- Ne crée jamais un devis déficitaire : les coûts internes doivent être répercutés dans les lignes visibles par le client, par exemple en ajustant les quantités, forfaits ou prix visibles.
- Si tu utilises des prix catalogue visibles mais que les coûts internes rendent le devis déficitaire, ajoute une marge de sécurité dans les lignes visibles tout en gardant les coûts internes masqués.
` : `
- Si le prix n'est pas mentionné dans la description, estime un prix réaliste pour le secteur **${sector}** et mets \`is_estimated: true\`. Arrondis toujours à la dizaine supérieure.
- Ne crée jamais un devis déficitaire : répercute les coûts internes dans les lignes visibles par le client.
`}
## Détection de plusieurs devis
Si la description contient plusieurs projets ou chantiers **clairement distincts et séparés** (ex: "chantier A : ... / chantier B : ...", ou plusieurs adresses, ou plusieurs clients), génère un devis séparé pour chacun.
Si c'est un seul projet (même s'il a plusieurs corps de métier), génère un seul devis.

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
              "description": "Description précise du poste de travaux",
              "quantity": 1,
              "unit": "u",
              "unit_price": 0,
              "vat_rate": 20,
              "is_estimated": false,
              "is_internal": false
            }
          ]
        }
      ]
    }
  ]
}
Le tableau "quotes" contient toujours au moins 1 élément.

## Main-d'œuvre — règle importante :
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
- Regroupe les postes par corps de métier ou par zone (ex: Cuisine, Salle de bain)
- TVA : 10% pour rénovation logement existant, 20% par défaut (neuf, travaux neufs)
- Unités courantes : u (unité), m2 (mètre carré), ml (mètre linéaire), h (heure), forfait
- Si des quantités sont mentionnées dans la description, extrais-les ; sinon mets 1
- Sois précis dans les descriptions pour que l'artisan comprenne le travail attendu
- Ne génère pas de sections vides
- Minimum 1 section avec au moins 1 ligne`
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
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

  // Catalogue + RAG en parallèle
  const [{ context: catalogContext, sector, activityId, activityDescription }, ragContext_] = await Promise.all([
    orgId ? loadCatalogContext(orgId) : Promise.resolve({ context: '', sector: 'BTP', activityId: null, activityDescription: null }),
    orgId ? fetchRAGContext(orgId, queryText) : Promise.resolve(''),
  ])
  // Re-fetch RAG avec le filtre activityId maintenant qu'on l'a (best-effort, pas bloquant)
  const ragContext = activityId && orgId
    ? await fetchRAGContext(orgId, queryText, { activityId })
    : ragContext_
  const systemPrompt = buildSystemPrompt(catalogContext, sector, ragContext, activityDescription)

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
    const { data } = await callAI<any>({
      organizationId: orgId ?? user.id,
      provider: 'openrouter',
      feature: 'quote_analysis',
      model,
      inputKind: contentType.includes('multipart/form-data') ? 'mixed' : 'text',
      request: {
        body: {
          messages,
          temperature: 0.2,
          max_tokens: 4096,
        },
      },
      metadata: {
        route: 'api/ai/analyze-quote',
        app_name: APP_NAME,
      },
    })

    const raw = data.choices?.[0]?.message?.content ?? ''

    let parsed: unknown
    try {
      parsed = JSON.parse(extractJson(raw))
    } catch {
      console.error('[ai/analyze-quote] JSON parse error, raw:', raw.slice(0, 300))
      return NextResponse.json({ error: 'Réponse IA invalide, veuillez réessayer' }, { status: 500 })
    }

    // Normalise : accepte { quotes: [...] } ou { title, sections } (rétrocompat) ou [{...}, ...]
    let quotes: AIQuoteResult[]
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>
      if (Array.isArray(obj.quotes)) {
        quotes = obj.quotes as AIQuoteResult[]
      } else if (Array.isArray(obj.sections)) {
        // Ancien format mono-devis
        quotes = [parsed as AIQuoteResult]
      } else {
        return NextResponse.json({ error: 'Structure IA invalide' }, { status: 500 })
      }
    } else if (Array.isArray(parsed)) {
      quotes = parsed as AIQuoteResult[]
    } else {
      return NextResponse.json({ error: 'Structure IA invalide' }, { status: 500 })
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
