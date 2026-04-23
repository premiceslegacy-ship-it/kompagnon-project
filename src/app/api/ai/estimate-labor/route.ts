import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { APP_NAME } from '@/lib/brand'
import { AIModuleDisabledError, callAI } from '@/lib/ai/callAI'

const TEXT_MODEL = 'google/gemini-2.5-flash-lite'

export type LaborProfile = {
  labor_rate_id: string | null
  designation: string
  rate: number
  unit: string
}

export type LaborEstimateItem = {
  labor_rate_id: string | null
  designation: string
  quantity: number
  unit: string
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
  const description: string = body.description ?? ''
  const profiles: LaborProfile[] = body.profiles ?? []

  if (!description.trim() || profiles.length === 0) {
    return NextResponse.json({ error: 'Description et profils requis' }, { status: 400 })
  }

  const profileList = profiles
    .map(p => `- ${p.designation} | ${p.rate}€/${p.unit}`)
    .join('\n')

  const messages = [
    {
      role: 'system',
      content: `Tu es un assistant expert en estimation pour artisan BTP. Tu reçois la description d'un chantier et une liste de profils de main d'œuvre. Estime le nombre d'unités nécessaires pour chaque profil (heures, jours, etc. selon l'unité). Sois réaliste et légèrement conservateur. Réponds UNIQUEMENT avec un tableau JSON valide, rien d'autre.`,
    },
    {
      role: 'user',
      content: `Description du chantier :\n${description.trim()}\n\nProfils disponibles :\n${profileList}\n\nRéponds uniquement en JSON :\n[{ "labor_rate_id": "id ou null", "designation": "...", "quantity": nombre, "unit": "h|j|..." }]`,
    },
  ]

  try {
    const { data } = await callAI<any>({
      organizationId: orgId,
      provider: 'openrouter',
      feature: 'labor_estimate',
      model: TEXT_MODEL,
      inputKind: 'text',
      request: {
        body: {
          messages,
          temperature: 0.1,
          max_tokens: 1024,
        },
      },
      metadata: {
        route: 'api/ai/estimate-labor',
        app_name: APP_NAME,
      },
    })

    const raw = data.choices?.[0]?.message?.content ?? ''

    let result: LaborEstimateItem[]
    try {
      result = JSON.parse(extractJson(raw))
    } catch {
      console.error('[ai/estimate-labor] JSON parse error, raw:', raw.slice(0, 300))
      return NextResponse.json({ error: 'Réponse IA invalide, veuillez réessayer' }, { status: 500 })
    }

    if (!Array.isArray(result)) {
      return NextResponse.json({ error: 'Structure IA invalide' }, { status: 500 })
    }

    return NextResponse.json(result)
  } catch (err: unknown) {
    if (err instanceof AIModuleDisabledError) {
      return NextResponse.json({ error: 'Module IA devis désactivé pour cette organisation.' }, { status: 403 })
    }
    console.error('[ai/estimate-labor]', err)
    return NextResponse.json({ error: "Erreur lors de l'estimation IA" }, { status: 500 })
  }
}
