import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { APP_NAME } from '@/lib/brand'
import { AIModuleDisabledError, AIRateLimitError, callAI } from '@/lib/ai/callAI'
import { getBusinessContext } from '@/lib/ai/business-context'

const TEXT_MODEL = 'google/gemini-2.5-flash-lite'

export type SuggestedTask = {
  title: string
  position: number
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

  if (!process.env.OPENROUTER_API_KEY) return NextResponse.json({ error: 'Clé API IA non configurée' }, { status: 500 })

  const { data: membership } = await supabase
    .from('memberships').select('organization_id').eq('user_id', user.id).single()
  const orgId = membership?.organization_id ?? user.id

  const body = await req.json()
  const items: Array<{ description: string; item_type?: string; item_kind?: string }> = body.items ?? []

  if (items.length === 0) {
    return NextResponse.json({ error: 'Aucune prestation fournie' }, { status: 400 })
  }

  const businessCtx = await getBusinessContext(orgId)

  // Enrichir chaque ligne avec sa classification pour aider l'IA à ordonner les tâches
  const itemsList = items.map((i, idx) => {
    const kind = i.item_type ?? i.item_kind ?? null
    const kindLabel = kind === 'service' ? ' [main-d\'œuvre]'
      : kind === 'article' ? ' [fourniture]'
      : kind === 'labor' ? ' [main-d\'œuvre]'
      : kind === 'material' ? ' [fourniture]'
      : ''
    return `${idx + 1}. ${i.description}${kindLabel}`
  }).join('\n')

  const messages = [
    {
      role: 'system',
      content: `Tu es un assistant expert en gestion de chantier pour une entreprise du métier : ${businessCtx.activityLabel}${businessCtx.activityDescription ? ` (${businessCtx.activityDescription})` : ''}. Tu reçois la liste des prestations d'un devis (avec leur nature : [fourniture] ou [main-d'œuvre]) et tu dois générer une liste de tâches concrètes, ordonnées et actionnables pour réaliser ce chantier, en tenant compte des spécificités de ce métier.
Règles d'ordonnancement :
- Les livraisons de fournitures précèdent toujours les tâches de pose correspondantes
- La préparation du chantier (protections, balisage, démolition) vient avant les travaux
- Les finitions (peinture, nettoyage, réception) viennent en dernier
- Chaque tâche doit être courte (5-8 mots max) et utiliser le vocabulaire propre au métier
Réponds UNIQUEMENT avec un tableau JSON, rien d'autre.`,
    },
    {
      role: 'user',
      content: `Prestations du devis :\n${itemsList}\n\nGénère les tâches de chantier en JSON :\n[{ "title": "...", "position": 1 }, ...]`,
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
          temperature: 0.2,
          max_tokens: 1024,
        },
      },
      metadata: {
        route: 'api/ai/suggest-tasks',
        app_name: APP_NAME,
      },
    })

    const raw = data.choices?.[0]?.message?.content ?? ''

    let result: SuggestedTask[]
    try {
      result = JSON.parse(extractJson(raw))
    } catch {
      console.error('[ai/suggest-tasks] JSON parse error, raw:', raw.slice(0, 300))
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
    console.error('[ai/suggest-tasks]', err)
    return NextResponse.json({ error: "Erreur lors de la génération des tâches" }, { status: 500 })
  }
}
