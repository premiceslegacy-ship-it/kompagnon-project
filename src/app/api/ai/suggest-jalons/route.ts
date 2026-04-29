import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { APP_NAME } from '@/lib/brand'
import { AIModuleDisabledError, AIRateLimitError, callAI } from '@/lib/ai/callAI'
import { getBusinessContext } from '@/lib/ai/business-context'

const TEXT_MODEL = 'google/gemini-2.5-flash-lite'

export type SuggestedJalon = {
  title: string
  acompte_pct: number
  description: string
  tasks: Array<{ title: string }>
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  const arr = text.match(/\[[\s\S]*\]/)
  if (arr) return arr[0]
  return text.trim()
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json({ error: 'Clé API IA non configurée' }, { status: 500 })
  }

  const { data: membership } = await supabase
    .from('memberships').select('organization_id').eq('user_id', user.id).single()
  const orgId = membership?.organization_id ?? user.id

  const body = await req.json()
  const { chantierId } = body as { chantierId: string }

  if (!chantierId) {
    return NextResponse.json({ error: 'chantierId requis' }, { status: 400 })
  }

  const businessCtx = await getBusinessContext(orgId)

  // Charger les infos du chantier + devis si dispo + tâches existantes
  const { data: chantier } = await supabase
    .from('chantiers')
    .select('title, description, budget_ht, quote_id')
    .eq('id', chantierId)
    .single()

  if (!chantier) return NextResponse.json({ error: 'Chantier introuvable' }, { status: 404 })

  const { data: taches } = await supabase
    .from('chantier_taches')
    .select('title, status')
    .eq('chantier_id', chantierId)
    .order('position', { ascending: true })

  let quoteContext = ''
  if (chantier.quote_id) {
    const { data: quote } = await supabase
      .from('quotes')
      .select('title, total_ht, items:quote_items(description)')
      .eq('id', chantier.quote_id)
      .single()
    if (quote) {
      const items = (quote.items ?? []).slice(0, 20).map((i: any) => `- ${i.description}`).join('\n')
      quoteContext = `\nDevis lié : "${quote.title}" — ${quote.total_ht}€ HT\nPrestations :\n${items}`
    }
  }

  const tachesContext = taches?.length
    ? `\nTâches existantes :\n${taches.map((t: any) => `- [${t.status}] ${t.title}`).join('\n')}`
    : ''

  const userContent = `Chantier : "${chantier.title}"${chantier.description ? `\nDescription : ${chantier.description}` : ''}
Budget : ${chantier.budget_ht ?? 0}€ HT${quoteContext}${tachesContext}

Propose un découpage en 3 à 5 jalons d'acompte pour ce chantier. Chaque jalon doit :
- Avoir un titre clair (ex : "Préparation et gros œuvre")
- Un pourcentage d'acompte (la somme doit faire 100%)
- Une courte description de ce qui est couvert
- Une liste de 2 à 5 tâches concrètes à réaliser dans ce jalon

Réponds UNIQUEMENT avec un tableau JSON, rien d'autre.`

  const messages = [
    {
      role: 'system',
      content: `Tu es un expert en gestion de chantier pour une entreprise du métier : ${businessCtx.activityLabel}${businessCtx.activityDescription ? ` (${businessCtx.activityDescription})` : ''}. Tu aides à structurer la facturation par jalons d'avancement en tenant compte des phases et pratiques propres à ce métier. Réponds toujours en JSON valide avec le format demandé.`,
    },
    {
      role: 'user',
      content: `${userContent}

Format attendu :
[
  {
    "title": "Titre du jalon",
    "acompte_pct": 30,
    "description": "Description courte du périmètre",
    "tasks": [{ "title": "Tâche concrète 1" }, { "title": "Tâche concrète 2" }]
  }
]`,
    },
  ]

  try {
    const { data } = await callAI<any>({
      organizationId: orgId,
      provider: 'openrouter',
      feature: 'task_suggestion',
      model: TEXT_MODEL,
      inputKind: 'text',
      request: {
        body: {
          messages,
          temperature: 0.3,
          max_tokens: 2048,
        },
      },
      metadata: {
        route: 'api/ai/suggest-jalons',
        app_name: APP_NAME,
        chantier_id: chantierId,
      },
    })

    const raw = data.choices?.[0]?.message?.content ?? ''

    let result: SuggestedJalon[]
    try {
      result = JSON.parse(extractJson(raw))
    } catch {
      console.error('[ai/suggest-jalons] JSON parse error, raw:', raw.slice(0, 300))
      return NextResponse.json({ error: 'Réponse IA invalide, veuillez réessayer' }, { status: 500 })
    }

    if (!Array.isArray(result)) {
      return NextResponse.json({ error: 'Structure IA invalide' }, { status: 500 })
    }

    return NextResponse.json(result)
  } catch (err: unknown) {
    if (err instanceof AIModuleDisabledError) {
      return NextResponse.json({ error: 'Module IA planning désactivé pour cette organisation.' }, { status: 403 })
    }
    if (err instanceof AIRateLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 })
    }
    console.error('[ai/suggest-jalons]', err)
    return NextResponse.json({ error: 'Erreur lors de la génération des jalons' }, { status: 500 })
  }
}
