import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { APP_NAME } from '@/lib/brand'
import { AIModuleDisabledError, AIProviderCreditError, AIRateLimitError, callAI } from '@/lib/ai/callAI'
import { AIQuotaExceededError } from '@/lib/quota'
import { getBusinessContext, formatBusinessContextForPrompt } from '@/lib/ai/business-context'
import { hasPermission } from '@/lib/data/queries/membership'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'

export const dynamic = 'force-dynamic'

const MODEL = 'google/gemini-2.5-flash-lite'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    if (!await hasPermission('reminders.send_manual')) {
      return NextResponse.json({ error: 'permission_denied', code: 'permission_denied' }, { status: 403 })
    }

    if (!process.env.OPENROUTER_API_KEY) {
      return NextResponse.json({ error: 'Clé API IA non configurée' }, { status: 500 })
    }

    const orgId = await getCurrentOrganizationId()
    if (!orgId) return NextResponse.json({ error: 'Organisation introuvable' }, { status: 401 })

    const body = await req.json()
    const {
      recipients,    // ex: "tous les clients actifs" ou liste de noms
      subject,       // ex: "Application de la TVA à partir du 1er juillet"
      tone,          // 'professionnel' | 'chaleureux' | 'neutre'
      context,       // informations supplémentaires libres
      orgEmail,      // email expéditeur (pour que Sarah puisse le mentionner)
      orgName,
    } = body as {
      recipients?: string
      subject?: string
      tone?: string
      context?: string
      orgEmail?: string
      orgName?: string
    }

    if (!subject?.trim()) {
      return NextResponse.json({ error: 'Le sujet est requis.' }, { status: 400 })
    }

    const businessCtx = await getBusinessContext(orgId)
    const businessPrompt = formatBusinessContextForPrompt(businessCtx)

    const systemPrompt = `Tu es Sarah, la secrétaire de l'application Atelier. Tu aides un artisan ou chef d'entreprise du bâtiment à rédiger des emails professionnels à destination de ses clients.

Contexte métier :
${businessPrompt}

Ton rôle ici : rédiger le corps d'un email client soigné, sans HTML, directement utilisable. Pas de ligne d'objet dans ta réponse — seulement le corps du message.

Règles de rédaction :
- Jamais d'emojis.
- Jamais de tiret cadratin (—).
- Vouvoie le destinataire.
- Ton professionnel et humain, adapté au secteur du bâtiment.
- Commence TOUJOURS par "Bonjour [Prénom]," sur sa propre ligne, exactement ainsi, sans modifier ce texte. Il sera automatiquement remplacé par le vrai prénom, le contact référent ou le nom d'équipe de chaque destinataire à l'envoi.
- Ne rédige PAS de formule de signature ni de bloc de coordonnées en fin de mail : la signature de l'organisation est ajoutée automatiquement après ton texte.
- Termine uniquement par une formule de politesse (ex : "Cordialement,") sans ajouter de nom ni d'adresse après.
- Corps du message : 3 à 6 phrases maximum, sauf si le contexte exige plus.
- La réponse doit être uniquement le texte du mail, rien d'autre (pas de commentaires, pas d'explication).`

    const userContent = [
      `Rédige un email pour : ${recipients || 'les clients de l\'organisation'}`,
      `Sujet : ${subject.trim()}`,
      tone ? `Ton souhaité : ${tone}` : null,
      context ? `Contexte supplémentaire : ${context.trim()}` : null,
      orgName ? `Nom de l'organisation : ${orgName}` : null,
    ].filter(Boolean).join('\n')

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ]

    const { data } = await callAI<any>({
      organizationId: orgId,
      provider: 'openrouter',
      feature: 'email_draft',
      model: MODEL,
      inputKind: 'text',
      request: {
        body: {
          messages,
          temperature: 0.4,
          max_tokens: 800,
        },
      },
      metadata: { route: 'api/ai/email-draft', app_name: APP_NAME },
    })

    const draft = data.choices?.[0]?.message?.content?.trim() ?? ''
    if (!draft) {
      return NextResponse.json({ error: 'Réponse IA vide, veuillez réessayer.' }, { status: 500 })
    }

    return NextResponse.json({ draft })
  } catch (err: unknown) {
    if (err instanceof AIQuotaExceededError) {
      return NextResponse.json({ error: 'Quota mensuel IA atteint.' }, { status: 402 })
    }
    if (err instanceof AIModuleDisabledError) {
      return NextResponse.json({ error: 'Module IA désactivé.' }, { status: 403 })
    }
    if (err instanceof AIRateLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 })
    }
    if (err instanceof AIProviderCreditError && err.aiBillingMode === 'client_owned') {
      return NextResponse.json({ error: 'Rechargez vos crédits OpenRouter.' }, { status: 402 })
    }
    console.error('[ai/email-draft]', err)
    return NextResponse.json({ error: 'Erreur lors de la génération du brouillon.' }, { status: 500 })
  }
}
