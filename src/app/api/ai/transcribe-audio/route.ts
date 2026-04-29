import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { AIRateLimitError, callAI } from '@/lib/ai/callAI'

const MISTRAL_MODEL = 'voxtral-mini-latest'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  if (!process.env.MISTRAL_API_KEY) {
    return NextResponse.json({ error: 'Transcription non configurée' }, { status: 500 })
  }

  const { data: membership } = await supabase
    .from('memberships').select('organization_id').eq('user_id', user.id).single()
  const orgId = membership?.organization_id ?? user.id

  const formData = await req.formData()
  const audio = formData.get('audio')

  if (!audio || !(audio instanceof Blob)) {
    return NextResponse.json({ error: 'Fichier audio requis' }, { status: 400 })
  }

  const mistralForm = new FormData()
  mistralForm.append('file', audio, 'recording.webm')
  mistralForm.append('model', MISTRAL_MODEL)
  mistralForm.append('language', 'fr')

  try {
    const result = await callAI<{ text: string }>({
      organizationId: orgId,
      provider: 'mistral',
      feature: 'whatsapp_transcription',
      model: MISTRAL_MODEL,
      inputKind: 'audio',
      request: { body: mistralForm, timeoutMs: 30000 },
    })

    return NextResponse.json({ text: result.data.text ?? '' })
  } catch (err: unknown) {
    if (err instanceof AIRateLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 })
    }
    const msg = err instanceof Error ? err.message : 'Erreur transcription'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
