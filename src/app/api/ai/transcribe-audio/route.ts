import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { AIRateLimitError, callAI } from '@/lib/ai/callAI'
import { AIQuotaExceededError } from '@/lib/quota'
import { getCurrentMembershipContext, hasPermission } from '@/lib/data/queries/membership'

const TRANSCRIPTION_MODEL = 'mistralai/voxtral-mini-transcribe'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  // Utilisée à la fois par la dictée du générateur de devis (ai.terrain) et par le
  // micro du chat Sarah (ai.sarah) : accepter l'une ou l'autre plutôt que de restreindre
  // à owner/admin, qui excluait les employés ayant pourtant accès à ces fonctionnalités.
  const [terrainAllowed, sarahAllowed] = await Promise.all([
    hasPermission('ai.terrain'),
    hasPermission('ai.sarah'),
  ])
  if (!terrainAllowed && !sarahAllowed) {
    return NextResponse.json({ error: 'permission_denied', code: 'permission_denied' }, { status: 403 })
  }

  const currentMembership = await getCurrentMembershipContext()

  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json({ error: 'Transcription non configurée' }, { status: 500 })
  }

  const orgId = currentMembership?.organizationId
  if (!orgId) {
    return NextResponse.json({ error: 'Organisation introuvable.' }, { status: 403 })
  }

  const formData = await req.formData()
  const audio = formData.get('audio')

  if (!audio || !(audio instanceof Blob)) {
    return NextResponse.json({ error: 'Fichier audio requis' }, { status: 400 })
  }

  const transcriptionForm = new FormData()
  transcriptionForm.append('file', audio, 'recording.webm')
  transcriptionForm.append('model', TRANSCRIPTION_MODEL)
  transcriptionForm.append('language', 'fr')

  try {
    const result = await callAI<{ text: string }>({
      organizationId: orgId,
      provider: 'openrouter',
      feature: 'voice_transcription',
      model: TRANSCRIPTION_MODEL,
      inputKind: 'audio',
      request: { body: transcriptionForm, timeoutMs: 30000 },
    })

    return NextResponse.json({ text: result.data.text ?? '' })
  } catch (err: unknown) {
    if (err instanceof AIRateLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 })
    }
    if (err instanceof AIQuotaExceededError) {
      return NextResponse.json({ error: 'Quota mensuel de saisie vocale atteint.' }, { status: 402 })
    }
    const msg = err instanceof Error ? err.message : 'Erreur transcription'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
