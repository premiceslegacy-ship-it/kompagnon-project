/**
 * Supabase Edge Function — Agent WhatsApp IA Kompagnon
 *
 * GET  /whatsapp-webhook → Vérification Meta webhook challenge
 * POST /whatsapp-webhook → Traitement messages entrants (texte ou vocal)
 *
 * Flux :
 *   Message WhatsApp (texte ou vocal)
 *   → Lookup org par phone_number_id
 *   → Vérification numéro autorisé
 *   → Si vocal : Voxtral Mini STT (Mistral API)
 *   → Gemini 2.5 Flash (OpenRouter) + tool_use
 *   → Exécution outils Supabase (chantiers, pointages, notes…)
 *   → Réponse WhatsApp via Cloud API
 *
 * Variables Supabase Secrets :
 *   OPENROUTER_API_KEY
 *   MISTRAL_API_KEY
 *   RESEND_API_KEY
 *   RESEND_FROM_EMAIL
 *   APP_URL
 *   SHARED_WABA_PHONE_NUMBER_ID  (WABA mutualisée Atelier — optionnel)
 *   SHARED_WABA_ACCESS_TOKEN     (WABA mutualisée Atelier — optionnel)
 *   SUPABASE_URL (auto-injecté)
 *   SUPABASE_SERVICE_ROLE_KEY (auto-injecté)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ─── Types ────────────────────────────────────────────────────────────────────

interface WhatsAppMessage {
  from: string
  id: string
  timestamp: string
  type: 'text' | 'audio' | 'image' | 'document' | 'sticker' | 'reaction'
  text?: { body: string }
  audio?: { id: string; mime_type: string }
  image?: { id: string; mime_type: string; caption?: string }
}

interface WebhookPayload {
  object: string
  entry: Array<{
    id: string
    changes: Array<{
      value: {
        messaging_product: string
        metadata: { phone_number_id: string; display_phone_number: string }
        messages?: WhatsAppMessage[]
        statuses?: unknown[]
      }
      field: string
    }>
  }>
}

interface AuthorizedContact {
  number: string
  label: string
}

const ACTIVITY_LABELS: Record<string, string> = {
  nettoyage_bureaux: 'Nettoyage de bureaux',
  vitrerie: 'Vitrerie',
  desinfection: 'Désinfection',
  remise_en_etat: 'Remise en état',
  renovation: 'Rénovation',
  electricite: 'Électricité',
  plomberie: 'Plomberie',
  menuiserie: 'Menuiserie',
  maconnerie: 'Maçonnerie',
  peinture: 'Peinture',
  carrelage: 'Carrelage',
  facade: 'Façade',
  charpente: 'Charpente',
  depannage_multitechnique: 'Dépannage multitechnique',
  tolerie: 'Tôlerie',
  chaudronnerie: 'Chaudronnerie',
  decoupe_laser: 'Découpe laser',
  pliage: 'Pliage',
  soudure: 'Soudure',
  fabrication_atelier: 'Fabrication atelier',
}

const ACTIVITY_DESCRIPTIONS: Record<string, string> = {
  nettoyage_bureaux: 'Entretien régulier, consommables et prestations récurrentes.',
  vitrerie: 'Nettoyage de vitres, vitrines et façades vitrées.',
  desinfection: 'Traitements ponctuels ou récurrents de désinfection.',
  remise_en_etat: 'Interventions après travaux, sinistres ou états des lieux.',
  renovation: "Travaux tous corps d'état et interventions multi-lots.",
  electricite: 'Installations, dépannages et mises en conformité électriques.',
  plomberie: 'Plomberie, sanitaire, chauffage et réseaux.',
  menuiserie: 'Pose, fabrication et finitions bois, alu ou PVC.',
  maconnerie: 'Gros oeuvre, dalles, murs et ouvrages maçonnés.',
  peinture: 'Préparation, peinture et finitions intérieures ou extérieures.',
  carrelage: 'Sols, faïence, revêtements et finitions associées.',
  facade: "Ravalement, enduits et isolation par l'extérieur.",
  charpente: 'Charpente, couverture et zinguerie.',
  depannage_multitechnique: "Interventions rapides avec fournitures et main-d'oeuvre.",
  tolerie: 'Découpe, pliage et fabrication de pièces en tôle.',
  chaudronnerie: 'Assemblages, ouvrages sur mesure et fabrication métal.',
  decoupe_laser: 'Découpe de précision, séries courtes et pièces unitaires.',
  pliage: 'Pliage atelier, réglages machine et reprises.',
  soudure: 'Assemblage, soudure TIG, MIG ou MAG et finitions.',
  fabrication_atelier: 'Production, assemblage et contrôle en atelier.',
}

interface OrgConfig {
  id: string
  name: string
  phone_number_id: string
  access_token: string
  authorized_numbers: string[]
  authorized_contacts: AuthorizedContact[]
  business_activity_id: string | null
  sector: string | null
}

type UsageMetrics = {
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  providerCost: number | null
  currency: string
}

// ─── Outils ───────────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'get_resume',
    description: 'Résumé de la situation actuelle : chantiers en cours, factures impayées, devis en attente de réponse, acomptes en attente.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_chantiers',
    description: 'Liste les chantiers en cours ou planifiés. Retourne titre, statut, ville, progression tâches, contact référent.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'add_pointage',
    description: "Saisit des heures travaillées sur un chantier. Cherche le chantier par mots-clés si l'ID n'est pas connu.",
    input_schema: {
      type: 'object',
      properties: {
        chantier_search: { type: 'string', description: 'Nom ou mots-clés du chantier' },
        hours: { type: 'number', description: 'Nombre d\'heures (ex: 3.5)' },
        date: { type: 'string', description: 'Date ISO YYYY-MM-DD, défaut = aujourd\'hui' },
        description: { type: 'string', description: 'Description optionnelle du travail effectué' },
      },
      required: ['chantier_search', 'hours'],
    },
  },
  {
    name: 'add_note_chantier',
    description: 'Ajoute une note au journal de chantier.',
    input_schema: {
      type: 'object',
      properties: {
        chantier_search: { type: 'string', description: 'Nom ou mots-clés du chantier' },
        content: { type: 'string', description: 'Texte de la note' },
      },
      required: ['chantier_search', 'content'],
    },
  },
  {
    name: 'update_chantier_status',
    description: "Change le statut d'un chantier (planifie, en_cours, suspendu, termine, annule).",
    input_schema: {
      type: 'object',
      properties: {
        chantier_search: { type: 'string', description: 'Nom ou mots-clés du chantier' },
        status: {
          type: 'string',
          enum: ['planifie', 'en_cours', 'suspendu', 'termine', 'annule'],
          description: 'Nouveau statut',
        },
      },
      required: ['chantier_search', 'status'],
    },
  },
  {
    name: 'get_factures_impayees',
    description: 'Liste les factures en retard de paiement avec montant, client et nombre de jours de retard.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_planning_day',
    description: 'Planning du jour : chantiers actifs, tâches échues aujourd\'hui, heures déjà pointées.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Date ISO YYYY-MM-DD, défaut = aujourd\'hui' },
      },
      required: [],
    },
  },
  {
    name: 'update_chantier_planning',
    description: "Déplace ou reprogramme un chantier dans le planning. Permet de changer la date de début ou de fin d'un chantier. Exemple : \"déplace le chantier Dupont à jeudi\", \"repousse la rénovation Martin d'une semaine\".",
    input_schema: {
      type: 'object',
      properties: {
        chantier_search: { type: 'string', description: 'Nom ou mots-clés du chantier à déplacer' },
        new_start_date: { type: 'string', description: 'Nouvelle date de début ISO YYYY-MM-DD' },
        new_end_date: { type: 'string', description: 'Nouvelle date de fin ISO YYYY-MM-DD (optionnel, conserve la durée si omis)' },
      },
      required: ['chantier_search', 'new_start_date'],
    },
  },
  {
    name: 'get_prestation_types',
    description: 'Liste les prestations types et articles du catalogue (nom, prix HT, unité, catégorie, variantes tarifaires si disponibles). Appeler avant create_quote pour connaître les tarifs disponibles.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'create_quote',
    description: 'Crée un nouveau devis en brouillon pour un client. Chaque ligne peut être liée au catalogue via prestation_type_id. Le client est recherché par nom ou email.',
    input_schema: {
      type: 'object',
      properties: {
        client_search: { type: 'string', description: 'Nom entreprise ou email du client' },
        title: { type: 'string', description: 'Titre du projet' },
        lines: {
          type: 'array',
          description: 'Lignes du devis',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string' },
              quantity: { type: 'number' },
              unit: { type: 'string' },
              unit_price: { type: 'number' },
              vat_rate: { type: 'number', description: 'Taux TVA, défaut 20' },
              prestation_type_id: { type: 'string', description: 'ID de la prestation catalogue (optionnel, issu de get_prestation_types)' },
              variant_label: { type: 'string', description: 'Libellé de la variante tarifaire choisie (optionnel)' },
            },
            required: ['description', 'quantity', 'unit', 'unit_price'],
          },
        },
        notes: { type: 'string', description: 'Texte d\'introduction optionnel visible sur le devis' },
        validity_days: { type: 'number', description: 'Durée de validité en jours, défaut 30' },
      },
      required: ['client_search', 'title', 'lines'],
    },
  },
  {
    name: 'send_quote',
    description: 'Envoie un devis par email au client. Cherche le devis par numéro (ex: DEV-2024-001) ou mots-clés du titre.',
    input_schema: {
      type: 'object',
      properties: {
        quote_search: { type: 'string', description: 'Numéro ou mots-clés du titre du devis' },
      },
      required: ['quote_search'],
    },
  },
  {
    name: 'create_invoice_from_quote',
    description: 'Convertit un devis accepté en facture. Cherche le devis par numéro ou mots-clés du titre.',
    input_schema: {
      type: 'object',
      properties: {
        quote_search: { type: 'string', description: 'Numéro du devis ou mots-clés du titre' },
        due_days: { type: 'number', description: 'Délai de paiement en jours depuis aujourd\'hui, défaut 30' },
      },
      required: ['quote_search'],
    },
  },
  {
    name: 'send_invoice',
    description: 'Envoie une facture par email au client. Cherche par numéro (ex: FAC-2024-001) ou nom du client.',
    input_schema: {
      type: 'object',
      properties: {
        invoice_search: { type: 'string', description: 'Numéro de facture ou nom du client' },
      },
      required: ['invoice_search'],
    },
  },
  {
    name: 'get_acomptes',
    description: 'Liste les acomptes en attente ou partiellement encaissés, avec le montant, le taux, le devis associé et le client.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'create_acompte',
    description: 'Crée un acompte sur un devis existant. Peut être exprimé en montant fixe ou en pourcentage du total du devis.',
    input_schema: {
      type: 'object',
      properties: {
        quote_search: { type: 'string', description: 'Numéro du devis ou mots-clés du titre' },
        amount: { type: 'number', description: 'Montant HT de l\'acompte (prioritaire sur pct)' },
        pct: { type: 'number', description: 'Pourcentage du total HT du devis (ex: 30 pour 30%). Ignoré si amount est fourni.' },
        label: { type: 'string', description: 'Libellé de l\'acompte, ex: "Acompte à la commande"' },
        due_days: { type: 'number', description: 'Délai d\'échéance en jours depuis aujourd\'hui, défaut 0 (à réception)' },
      },
      required: ['quote_search'],
    },
  },
  {
    name: 'add_chantier_expense',
    description: 'Enregistre une dépense sur un chantier : achat de matériel, sous-traitance, location d\'engin, transport, etc. Exemple : "j\'ai acheté pour 350€ de placo chez Point P sur le chantier Dupont".',
    input_schema: {
      type: 'object',
      properties: {
        chantier_search: { type: 'string', description: 'Nom ou mots-clés du chantier' },
        category: {
          type: 'string',
          enum: ['materiel', 'sous_traitance', 'location', 'transport', 'autre'],
          description: 'Catégorie de la dépense',
        },
        label: { type: 'string', description: 'Description de la dépense (ex: "Placo BA13 - 50 plaques")' },
        amount_ht: { type: 'number', description: 'Montant HT en euros' },
        supplier_name: { type: 'string', description: 'Nom du fournisseur (optionnel)' },
        date: { type: 'string', description: 'Date ISO YYYY-MM-DD, défaut = aujourd\'hui' },
      },
      required: ['chantier_search', 'category', 'label', 'amount_ht'],
    },
  },
  {
    name: 'get_chantier_profitability',
    description: 'Affiche la rentabilité d\'un chantier : budget, coûts réels (main-d\'œuvre, matériel, sous-traitance), CA facturé et marge en € et %.',
    input_schema: {
      type: 'object',
      properties: {
        chantier_search: { type: 'string', description: 'Nom ou mots-clés du chantier' },
      },
      required: ['chantier_search'],
    },
  },
  {
    name: 'get_chantiers_at_risk',
    description: 'Liste les chantiers en alerte : ceux dont le coût dépasse 90% du budget ou dont la marge est inférieure à 10%.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
]

// ─── Handler principal ────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'GET') {
    const url = new URL(req.url)
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')

    if (mode !== 'subscribe' || !token || !challenge) {
      return new Response('Bad Request', { status: 400 })
    }

    const supabase = getAdminClient()
    const { data } = await supabase
      .from('whatsapp_configs')
      .select('id')
      .eq('verify_token', token)
      .eq('is_active', true)
      .single()

    if (!data) return new Response('Forbidden', { status: 403 })
    return new Response(challenge, { status: 200 })
  }

  if (req.method === 'POST') {
    const payload = await req.json() as WebhookPayload
    const supabase = getAdminClient()
    await processPayload(supabase, payload)
    return new Response('OK', { status: 200 })
  }

  return new Response('Method Not Allowed', { status: 405 })
})

// ─── Traitement du payload WhatsApp ──────────────────────────────────────────

async function processPayload(supabase: ReturnType<typeof getAdminClient>, payload: WebhookPayload) {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue

      const phoneNumberId = change.value.metadata.phone_number_id
      const messages = change.value.messages ?? []

      if (!messages.length) continue

      const sharedPhoneNumberId = Deno.env.get('SHARED_WABA_PHONE_NUMBER_ID')?.trim()
      const sharedAccessToken = Deno.env.get('SHARED_WABA_ACCESS_TOKEN')?.trim()
      const isSharedWaba = sharedPhoneNumberId && phoneNumberId === sharedPhoneNumberId

      let config: Record<string, unknown> | null = null

      if (isSharedWaba) {
        // Mode mutualisé : on ne connaît pas encore l'org — on résout après avoir lu from_number
        // Le routing se fait message par message dans handleMessage pour le mode mutualisé
        for (const msg of messages) {
          const fromNumber = msg.from
          const { data: sharedConfig } = await supabase
            .from('whatsapp_configs')
            .select('id, is_active, access_token, authorized_numbers, authorized_contacts, use_shared_waba, organizations(id, name, sector, business_activity_id)')
            .eq('use_shared_waba', true)
            .eq('is_active', true)
            .contains('authorized_contacts', JSON.stringify([{ number: fromNumber }]))
            .maybeSingle()

          // Fallback : chercher dans authorized_numbers si authorized_contacts ne matche pas
          let resolvedConfig = sharedConfig
          if (!resolvedConfig) {
            const { data: fallbackConfig } = await supabase
              .from('whatsapp_configs')
              .select('id, is_active, access_token, authorized_numbers, authorized_contacts, use_shared_waba, organizations(id, name, sector, business_activity_id)')
              .eq('use_shared_waba', true)
              .eq('is_active', true)
              .contains('authorized_numbers', [fromNumber])
              .maybeSingle()
            resolvedConfig = fallbackConfig
          }

          if (!resolvedConfig) continue

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const org = (resolvedConfig as any).organizations
          const contacts: AuthorizedContact[] = (resolvedConfig.authorized_contacts as AuthorizedContact[] | null) ?? []
          const orgConfig: OrgConfig = {
            id: org.id,
            name: org.name,
            phone_number_id: sharedPhoneNumberId,
            access_token: sharedAccessToken!,
            authorized_numbers: (resolvedConfig.authorized_numbers as string[] | null) ?? [],
            authorized_contacts: contacts,
            business_activity_id: org.business_activity_id ?? null,
            sector: org.sector ?? null,
          }

          await handleMessage(supabase, orgConfig, msg).catch(err => {
            console.error('[whatsapp-agent] handleMessage error:', err)
          })
        }
        continue
      }

      // Mode classique : routing par phone_number_id
      const { data: classicConfig } = await supabase
        .from('whatsapp_configs')
        .select('id, is_active, access_token, authorized_numbers, authorized_contacts, organizations(id, name, sector, business_activity_id)')
        .eq('phone_number_id', phoneNumberId)
        .single()

      config = classicConfig as Record<string, unknown> | null

      if (!config || !config.is_active) continue

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const org = (config as any).organizations
      const contacts: AuthorizedContact[] = (config.authorized_contacts as AuthorizedContact[] | null) ?? []
      const orgConfig: OrgConfig = {
        id: org.id,
        name: org.name,
        phone_number_id: phoneNumberId,
        access_token: config.access_token as string,
        authorized_numbers: (config.authorized_numbers as string[] | null) ?? [],
        authorized_contacts: contacts,
        business_activity_id: org.business_activity_id ?? null,
        sector: org.sector ?? null,
      }

      for (const msg of messages) {
        await handleMessage(supabase, orgConfig, msg).catch(err => {
          console.error('[whatsapp-agent] handleMessage error:', err)
        })
      }
    }
  }
}

// ─── Traitement d'un message ──────────────────────────────────────────────────

async function handleMessage(
  supabase: ReturnType<typeof getAdminClient>,
  orgConfig: OrgConfig,
  msg: WhatsAppMessage,
) {
  const fromNumber = msg.from

  if (!(await isWhatsAppModuleEnabled(supabase, orgConfig.id))) {
    await sendWhatsAppText(orgConfig, fromNumber,
      "L'agent WhatsApp n'est pas activé pour cette instance.")
    return
  }

  // Vérification autorisation : cherche dans authorized_contacts (nouveau) puis authorized_numbers (rétrocompat)
  const authorizedNums = [
    ...orgConfig.authorized_contacts.map(c => c.number),
    ...orgConfig.authorized_numbers,
  ]
  const hasRestriction = authorizedNums.length > 0
  if (hasRestriction && !authorizedNums.includes(fromNumber)) {
    await sendWhatsAppText(orgConfig, fromNumber,
      "Désolé, ce numéro n'est pas autorisé à utiliser l'assistant.")
    return
  }

  let userText: string | null = null
  let transcription: string | null = null
  let messageType = msg.type

  if (msg.type === 'audio' && msg.audio?.id) {
    try {
      const audioBuffer = await downloadWhatsAppMedia(orgConfig.access_token, msg.audio.id)
      transcription = await transcribeWithVoxtral(supabase, orgConfig.id, audioBuffer, msg.audio.mime_type)
      userText = transcription
    } catch (err) {
      console.error('[whatsapp-agent] STT error:', err)
      await sendWhatsAppText(orgConfig, fromNumber,
        "Je n'ai pas pu transcrire votre message vocal. Essayez en texte ?")
      return
    }
  } else if (msg.type === 'text' && msg.text?.body) {
    userText = msg.text.body
  } else if (msg.type === 'image' && msg.image?.caption) {
    userText = msg.image.caption
    messageType = 'image'
  } else {
    await sendWhatsAppText(orgConfig, fromNumber,
      "Je gère les messages texte et vocaux. Envoyez-moi votre demande en texte ou par vocal !")
    return
  }

  if (!userText?.trim()) return

  await supabase.from('whatsapp_messages').insert({
    organization_id: orgConfig.id,
    wamid: msg.id,
    direction: 'inbound',
    from_number: fromNumber,
    to_number: orgConfig.phone_number_id,
    message_type: messageType,
    transcription,
    content: userText,
  })

  const { reply, toolCalls } = await callGemini(supabase, orgConfig, userText)

  await supabase.from('whatsapp_messages').insert({
    organization_id: orgConfig.id,
    direction: 'outbound',
    from_number: orgConfig.phone_number_id,
    to_number: fromNumber,
    message_type: 'text',
    content: reply,
    tool_calls: toolCalls.length ? toolCalls : null,
  })

  await sendWhatsAppText(orgConfig, fromNumber, reply)
}

// ─── Gemini 2.5 Flash via OpenRouter + tool_use ───────────────────────────────

async function callGemini(
  supabase: ReturnType<typeof getAdminClient>,
  orgConfig: OrgConfig,
  userText: string,
): Promise<{ reply: string; toolCalls: unknown[] }> {
  const openrouterKey = Deno.env.get('OPENROUTER_API_KEY')!
  const appUrl = Deno.env.get('APP_URL') ?? ''
  const today = new Date().toISOString().split('T')[0]

  const activityId = orgConfig.business_activity_id ?? ''
  const activityLabel = ACTIVITY_LABELS[activityId] ?? orgConfig.sector ?? 'artisan'
  const activityDesc = ACTIVITY_DESCRIPTIONS[activityId]

  const systemPrompt = `Tu es l'assistant IA de ${orgConfig.name}, entreprise spécialisée en ${activityLabel}.${activityDesc ? `\nSpécificité métier : ${activityDesc}` : ''}
Tu réponds en français, de façon concise (WhatsApp = messages courts).
Tu connais les subtilités et le vocabulaire propre à ce métier : utilise-les dans tes réponses.
Tu peux consulter les données de l'application et agir dessus via les outils disponibles.
Date d'aujourd'hui : ${today}.
Sois direct et pratique, l'utilisateur est souvent sur le terrain.
Tu peux enregistrer des dépenses chantier (add_chantier_expense), consulter la rentabilité d'un chantier (get_chantier_profitability) et lister les chantiers en alerte budget ou marge faible (get_chantiers_at_risk).
Si la marge d'un chantier est < 10% ou le budget utilisé > 90%, mentionne-le explicitement dans ta réponse.
Règles de style : aucun emoji, aucun tiret cadratin (—), français soigné et professionnel.`

  const messages = [{ role: 'user', content: userText }]
  const allToolCalls: unknown[] = []

  for (let turn = 0; turn < 5; turn++) {
    const requestBody = {
      model: 'google/gemini-2.5-flash',
      max_tokens: 1024,
      system: systemPrompt,
      messages,
      tools: TOOLS.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })),
      tool_choice: 'auto',
      user: orgConfig.id,
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let json: any
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openrouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': appUrl,
          'X-Title': 'Kompagnon',
        },
        body: JSON.stringify(requestBody),
      })

      if (!res.ok) {
        const errorText = await res.text()
        await logProviderUsage(supabase, {
          organizationId: orgConfig.id,
          provider: 'openrouter',
          feature: 'whatsapp_reply',
          model: 'google/gemini-2.5-flash',
          inputKind: 'text',
          status: 'error',
          usage: emptyUsageMetrics(),
          externalRequestId: null,
          metadata: {
            turn,
            error: errorText,
          },
        })
        throw new Error(`OpenRouter ${res.status}: ${errorText}`)
      }

      json = await res.json()
      await logProviderUsage(supabase, {
        organizationId: orgConfig.id,
        provider: 'openrouter',
        feature: 'whatsapp_reply',
        model: 'google/gemini-2.5-flash',
        inputKind: 'text',
        status: 'success',
        usage: buildUsageMetrics(json.usage as Record<string, unknown> | undefined),
        externalRequestId: typeof json.id === 'string' ? json.id : null,
        metadata: {
          turn,
          tool_count: Array.isArray(json.choices?.[0]?.message?.tool_calls)
            ? (json.choices?.[0]?.message?.tool_calls?.length ?? 0)
            : 0,
        },
      })
    } catch (error) {
      throw error
    }

    const choice = json.choices?.[0]

    if (!choice) throw new Error('No choice from OpenRouter')

    if (choice.finish_reason === 'stop' || choice.finish_reason === 'length') {
      return { reply: choice.message?.content ?? '', toolCalls: allToolCalls }
    }

    if (choice.finish_reason === 'tool_calls' && choice.message?.tool_calls?.length) {
      const toolResults = []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const tc of choice.message.tool_calls as any[]) {
        const toolName = tc.function?.name
        const toolInput = JSON.parse(tc.function?.arguments ?? '{}')
        allToolCalls.push({ tool: toolName, input: toolInput })

        const result = await executeTool(supabase, orgConfig, toolName, toolInput)
        toolResults.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        })
      }

      messages.push(choice.message)
      messages.push(...toolResults)
      continue
    }

    break
  }

  return { reply: "J'ai traité votre demande.", toolCalls: allToolCalls }
}

// ─── Exécution des outils ─────────────────────────────────────────────────────

async function executeTool(
  supabase: ReturnType<typeof getAdminClient>,
  orgConfig: OrgConfig,
  toolName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: Record<string, any>,
): Promise<unknown> {
  const orgId = orgConfig.id
  const today = new Date().toISOString().split('T')[0]

  switch (toolName) {
    case 'get_resume': {
      const [{ data: chantiers }, { data: invoices }, { data: quotes }, { data: acomptes }] = await Promise.all([
        supabase.from('chantiers').select('title, status, city').eq('organization_id', orgId).in('status', ['en_cours', 'planifie']).limit(5),
        supabase.from('invoices').select('number, total_ttc, currency, due_date, client:clients(company_name)').eq('organization_id', orgId).eq('status', 'sent').lt('due_date', today).limit(5),
        supabase.from('quotes').select('number, total_ttc, currency, status').eq('organization_id', orgId).in('status', ['sent', 'viewed']).limit(5),
        supabase.from('acomptes').select('amount_ht, label, due_date, status, quote:quotes(number, title, client:clients(company_name))').eq('organization_id', orgId).in('status', ['pending', 'partial']).limit(5),
      ])
      return {
        chantiers_en_cours: chantiers ?? [],
        factures_impayees: invoices ?? [],
        devis_en_attente: quotes ?? [],
        acomptes_en_attente: acomptes ?? [],
      }
    }

    case 'get_chantiers': {
      const { data } = await supabase
        .from('chantiers')
        .select('id, title, status, city, estimated_end_date, contact_name, contact_phone')
        .eq('organization_id', orgId)
        .in('status', ['en_cours', 'planifie', 'suspendu'])
        .order('created_at', { ascending: false })
        .limit(10)
      return data ?? []
    }

    case 'add_pointage': {
      const chantier = await findChantierBySearch(supabase, orgId, input.chantier_search)
      if (!chantier) return { error: `Chantier introuvable pour "${input.chantier_search}"` }

      const { data: membership } = await supabase
        .from('memberships')
        .select('user_id')
        .eq('organization_id', orgId)
        .eq('is_owner', true)
        .single()

      if (!membership) return { error: "Impossible de déterminer l'utilisateur" }

      const { error } = await supabase.from('chantier_pointages').insert({
        chantier_id: chantier.id,
        user_id: membership.user_id,
        date: input.date ?? today,
        hours: input.hours,
        description: input.description ?? null,
      })

      if (error) return { error: error.message }
      return { success: true, chantier: chantier.title, hours: input.hours, date: input.date ?? today }
    }

    case 'add_note_chantier': {
      const chantier = await findChantierBySearch(supabase, orgId, input.chantier_search)
      if (!chantier) return { error: `Chantier introuvable pour "${input.chantier_search}"` }

      const { data: membership } = await supabase
        .from('memberships')
        .select('user_id')
        .eq('organization_id', orgId)
        .eq('is_owner', true)
        .single()

      if (!membership) return { error: "Impossible de déterminer l'utilisateur" }

      const { error } = await supabase.from('chantier_notes').insert({
        chantier_id: chantier.id,
        author_id: membership.user_id,
        content: input.content,
      })

      if (error) return { error: error.message }
      return { success: true, chantier: chantier.title }
    }

    case 'update_chantier_status': {
      const chantier = await findChantierBySearch(supabase, orgId, input.chantier_search)
      if (!chantier) return { error: `Chantier introuvable pour "${input.chantier_search}"` }

      const updateData: Record<string, unknown> = { status: input.status }
      if (input.status === 'termine') updateData.end_date = today

      const { error } = await supabase.from('chantiers').update(updateData).eq('id', chantier.id)
      if (error) return { error: error.message }
      return { success: true, chantier: chantier.title, new_status: input.status }
    }

    case 'get_factures_impayees': {
      const { data } = await supabase
        .from('invoices')
        .select('number, total_ttc, currency, due_date, client:clients(company_name)')
        .eq('organization_id', orgId)
        .eq('status', 'sent')
        .lt('due_date', today)
        .order('due_date', { ascending: true })
        .limit(10)

      // Enrichir avec le nombre de jours de retard
      const enriched = (data ?? []).map((inv: Record<string, unknown>) => {
        const daysLate = Math.floor((Date.now() - new Date(inv.due_date as string).getTime()) / 86400000)
        return { ...inv, jours_retard: daysLate }
      })
      return enriched
    }

    case 'get_planning_day': {
      const date = input.date ?? today
      const { data: chantiers } = await supabase
        .from('chantiers')
        .select('id, title, status, city, estimated_end_date')
        .eq('organization_id', orgId)
        .in('status', ['en_cours', 'planifie'])
        .order('created_at', { ascending: false })
        .limit(10)

      const chantierIds = (chantiers ?? []).map((c: { id: string }) => c.id)

      const [tachesRes, pointagesRes] = await Promise.all([
        chantierIds.length > 0
          ? supabase.from('chantier_taches')
              .select('title, status, due_date, chantier_id')
              .in('chantier_id', chantierIds)
              .eq('due_date', date)
              .neq('status', 'termine')
          : { data: [] },
        chantierIds.length > 0
          ? supabase.from('chantier_pointages')
              .select('hours, description, chantier_id')
              .in('chantier_id', chantierIds)
              .eq('date', date)
          : { data: [] },
      ])

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const totalHeures = (pointagesRes.data ?? []).reduce((s: number, p: any) => s + (p.hours ?? 0), 0)
      return {
        date,
        chantiers_actifs: chantiers ?? [],
        taches_du_jour: tachesRes.data ?? [],
        pointages_du_jour: pointagesRes.data ?? [],
        total_heures_pointees: totalHeures,
      }
    }

    case 'get_prestation_types': {
      const { data: prestations } = await supabase
        .from('prestation_types')
        .select('id, name, category, unit, base_price_ht, base_cost_ht, base_margin_pct, vat_rate, item_type')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('category', { ascending: true })
        .order('name', { ascending: true })

      if (!prestations?.length) return []

      // Récupérer les variantes tarifaires pour chaque prestation
      const ids = prestations.map((p: { id: string }) => p.id)
      const { data: variants } = await supabase
        .from('material_price_variants')
        .select('material_id, id, label, unit_price_ht, unit')
        .in('material_id', ids)
        .order('label', { ascending: true })

      const variantsByPrestation: Record<string, unknown[]> = {}
      for (const v of (variants ?? [])) {
        const vid = (v as Record<string, unknown>).material_id as string
        if (!variantsByPrestation[vid]) variantsByPrestation[vid] = []
        variantsByPrestation[vid].push(v)
      }

      return prestations.map((p: Record<string, unknown>) => ({
        ...p,
        variantes: variantsByPrestation[p.id as string] ?? [],
      }))
    }

    case 'create_quote': {
      const client = await findClientBySearch(supabase, orgId, input.client_search)
      if (!client) return { error: `Client introuvable pour "${input.client_search}"` }

      const { data: numberData } = await supabase.rpc('generate_quote_number', { p_org_id: orgId })
      const { data: quote, error: qErr } = await supabase
        .from('quotes')
        .insert({
          organization_id: orgId,
          client_id: client.id,
          title: input.title,
          number: numberData,
          status: 'draft',
          validity_days: input.validity_days ?? 30,
          notes_client: input.notes ?? null,
        })
        .select('id, number')
        .single()

      if (qErr || !quote) return { error: qErr?.message ?? 'Erreur création devis' }

      const { data: section } = await supabase
        .from('quote_sections')
        .insert({ quote_id: quote.id, title: 'Prestations', position: 1 })
        .select('id')
        .single()

      if (!section) return { error: 'Erreur création section' }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items = (input.lines as any[]).map((l: any, idx: number) => ({
        quote_id: quote.id,
        section_id: section.id,
        type: 'custom',
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        unit_price: l.unit_price,
        vat_rate: l.vat_rate ?? 20,
        position: idx + 1,
        // Lien catalogue si fourni
        ...(l.prestation_type_id ? { material_id: l.prestation_type_id } : {}),
        ...(l.variant_label ? { variant_label: l.variant_label } : {}),
      }))

      const { error: itemsErr } = await supabase.from('quote_items').insert(items)
      if (itemsErr) return { error: itemsErr.message }

      const appUrl = Deno.env.get('APP_URL') ?? ''
      return {
        success: true,
        quote_number: quote.number,
        client: client.company_name || client.email,
        title: input.title,
        lines: items.length,
        url: `${appUrl}/finances/quote-editor?id=${quote.id}`,
      }
    }

    case 'send_quote': {
      const quote = await findQuoteBySearch(supabase, orgId, input.quote_search)
      if (!quote) return { error: `Devis introuvable pour "${input.quote_search}"` }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clientEmail = (quote as any).client?.email
      if (!clientEmail) return { error: "Pas d'adresse email pour ce client" }

      await supabase
        .from('quotes')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', quote.id)

      const appUrl = Deno.env.get('APP_URL') ?? ''
      await sendResendEmail({
        to: clientEmail,
        subject: `Votre devis ${quote.number}`,
        html: `<p>Bonjour,</p><p>Veuillez trouver ci-dessous votre devis <strong>${quote.number}</strong>.</p><p><a href="${appUrl}/api/pdf/quote/${quote.id}" style="background:#22c55e;color:#000;padding:12px 24px;border-radius:24px;text-decoration:none;font-weight:bold;">Voir le devis PDF</a></p><p>Cordialement</p>`,
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { success: true, quote_number: quote.number, sent_to: clientEmail, title: (quote as any).title }
    }

    case 'create_invoice_from_quote': {
      const quote = await findQuoteBySearch(supabase, orgId, input.quote_search)
      if (!quote) return { error: `Devis introuvable pour "${input.quote_search}"` }
      if (quote.status === 'converted') return { error: 'Ce devis a déjà été converti en facture' }

      const { data: quoteItems } = await supabase
        .from('quote_items')
        .select('description, quantity, unit, unit_price, vat_rate, position, material_id, variant_label')
        .eq('quote_id', quote.id)
        .order('position', { ascending: true })

      const { data: numberData } = await supabase.rpc('generate_invoice_number', { p_org_id: orgId })
      const dueDays = input.due_days ?? 30
      const dueDate = new Date(Date.now() + dueDays * 86400000).toISOString().split('T')[0]

      const { data: invoice, error: invErr } = await supabase
        .from('invoices')
        .insert({
          organization_id: orgId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          client_id: (quote as any).client?.id ?? null,
          quote_id: quote.id,
          number: numberData,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          title: (quote as any).title,
          status: 'draft',
          issue_date: today,
          due_date: dueDate,
          payment_terms_days: dueDays,
        })
        .select('id, number')
        .single()

      if (invErr || !invoice) return { error: invErr?.message ?? 'Erreur création facture' }

      if (quoteItems && quoteItems.length > 0) {
        const invItems = quoteItems.map((qi: Record<string, unknown>, idx: number) => ({
          invoice_id: invoice.id,
          description: qi.description,
          quantity: qi.quantity,
          unit: qi.unit,
          unit_price: qi.unit_price,
          vat_rate: qi.vat_rate,
          position: qi.position ?? idx + 1,
          // Conserver le lien catalogue depuis le devis
          ...(qi.material_id ? { material_id: qi.material_id } : {}),
          ...(qi.variant_label ? { variant_label: qi.variant_label } : {}),
        }))
        await supabase.from('invoice_items').insert(invItems)
      }

      await supabase
        .from('quotes')
        .update({ status: 'converted', converted_at: new Date().toISOString(), invoice_id: invoice.id })
        .eq('id', quote.id)

      const appUrl = Deno.env.get('APP_URL') ?? ''
      return {
        success: true,
        invoice_number: invoice.number,
        quote_number: quote.number,
        due_date: dueDate,
        url: `${appUrl}/finances/invoice-editor?id=${invoice.id}`,
      }
    }

    case 'send_invoice': {
      const invoice = await findInvoiceBySearch(supabase, orgId, input.invoice_search)
      if (!invoice) return { error: `Facture introuvable pour "${input.invoice_search}"` }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clientEmail = (invoice as any).client?.email
      if (!clientEmail) return { error: "Pas d'adresse email pour ce client" }

      await supabase
        .from('invoices')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', invoice.id)

      const appUrl = Deno.env.get('APP_URL') ?? ''
      await sendResendEmail({
        to: clientEmail,
        subject: `Votre facture ${invoice.number}`,
        html: `<p>Bonjour,</p><p>Veuillez trouver ci-dessous votre facture <strong>${invoice.number}</strong>.</p><p><a href="${appUrl}/api/pdf/invoice/${invoice.id}" style="background:#22c55e;color:#000;padding:12px 24px;border-radius:24px;text-decoration:none;font-weight:bold;">Voir la facture PDF</a></p><p>Cordialement</p>`,
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { success: true, invoice_number: invoice.number, sent_to: clientEmail }
    }

    case 'get_acomptes': {
      const { data } = await supabase
        .from('acomptes')
        .select('id, label, amount_ht, pct, due_date, status, quote:quotes(number, title, client:clients(company_name))')
        .eq('organization_id', orgId)
        .in('status', ['pending', 'partial'])
        .order('due_date', { ascending: true })
        .limit(10)
      return data ?? []
    }

    case 'create_acompte': {
      const quote = await findQuoteBySearch(supabase, orgId, input.quote_search)
      if (!quote) return { error: `Devis introuvable pour "${input.quote_search}"` }

      let amountHt = input.amount ?? null
      let pct = input.pct ?? null

      // Calculer le montant depuis le pourcentage si amount non fourni
      if (!amountHt && pct) {
        const { data: quoteData } = await supabase
          .from('quotes')
          .select('total_ht')
          .eq('id', quote.id)
          .single()
        if (quoteData?.total_ht) {
          amountHt = Math.round((quoteData.total_ht * pct) / 100 * 100) / 100
        }
      }

      if (!amountHt) return { error: 'Précisez un montant ou un pourcentage pour l\'acompte' }

      const dueDays = input.due_days ?? 0
      const dueDate = dueDays > 0
        ? new Date(Date.now() + dueDays * 86400000).toISOString().split('T')[0]
        : today

      const { data: acompte, error: aErr } = await supabase
        .from('acomptes')
        .insert({
          organization_id: orgId,
          quote_id: quote.id,
          label: input.label ?? 'Acompte',
          amount_ht: amountHt,
          pct: pct ?? null,
          due_date: dueDate,
          status: 'pending',
        })
        .select('id, label, amount_ht, due_date')
        .single()

      if (aErr || !acompte) return { error: aErr?.message ?? 'Erreur création acompte' }

      return {
        success: true,
        label: acompte.label,
        amount_ht: acompte.amount_ht,
        due_date: acompte.due_date,
        quote_number: quote.number,
      }
    }

    case 'update_chantier_planning': {
      const chantier = await findChantierBySearch(supabase, orgId, input.chantier_search)
      if (!chantier) return { error: `Chantier introuvable pour "${input.chantier_search}"` }

      const updateData: Record<string, unknown> = { start_date: input.new_start_date }
      if (input.new_end_date) updateData.end_date = input.new_end_date

      const { error } = await supabase
        .from('chantiers')
        .update(updateData)
        .eq('id', chantier.id)
        .eq('organization_id', orgId)

      if (error) return { error: error.message }
      return {
        success: true,
        chantier: chantier.title,
        new_start_date: input.new_start_date,
        ...(input.new_end_date ? { new_end_date: input.new_end_date } : {}),
      }
    }

    case 'add_chantier_expense': {
      const chantier = await findChantierBySearch(supabase, orgId, input.chantier_search)
      if (!chantier) return { error: `Chantier introuvable pour "${input.chantier_search}"` }

      const { data: membership } = await supabase
        .from('memberships')
        .select('user_id')
        .eq('organization_id', orgId)
        .eq('is_owner', true)
        .single()

      if (!membership) return { error: "Impossible de déterminer l'utilisateur" }

      const { error } = await supabase.from('chantier_expenses').insert({
        organization_id: orgId,
        chantier_id: chantier.id,
        category: input.category,
        label: input.label,
        amount_ht: input.amount_ht,
        vat_rate: 20,
        expense_date: input.date ?? today,
        supplier_name: input.supplier_name ?? null,
        created_by: membership.user_id,
      })

      if (error) return { error: error.message }
      return {
        success: true,
        chantier: chantier.title,
        label: input.label,
        amount_ht: input.amount_ht,
        category: input.category,
        date: input.date ?? today,
      }
    }

    case 'get_chantier_profitability': {
      const chantier = await findChantierBySearch(supabase, orgId, input.chantier_search)
      if (!chantier) return { error: `Chantier introuvable pour "${input.chantier_search}"` }

      // Taux horaire org
      const { data: org } = await supabase
        .from('organizations')
        .select('default_labor_cost_per_hour, default_hourly_rate')
        .eq('id', orgId)
        .single()

      const laborRate = org?.default_labor_cost_per_hour
        ?? (org?.default_hourly_rate ? org.default_hourly_rate * 0.5 : 35)

      // Heures pointées
      const { data: pointages } = await supabase
        .from('chantier_pointages')
        .select('hours')
        .eq('chantier_id', chantier.id)

      const hoursLogged = (pointages ?? []).reduce((s: number, p: { hours: number }) => s + (p.hours ?? 0), 0)
      const costLabor = hoursLogged * laborRate

      // Dépenses
      const { data: expenses } = await supabase
        .from('chantier_expenses')
        .select('category, amount_ht')
        .eq('chantier_id', chantier.id)

      const costMaterial = (expenses ?? []).filter((e: { category: string }) => e.category === 'materiel').reduce((s: number, e: { amount_ht: number }) => s + e.amount_ht, 0)
      const costSubcontract = (expenses ?? []).filter((e: { category: string }) => e.category === 'sous_traitance').reduce((s: number, e: { amount_ht: number }) => s + e.amount_ht, 0)
      const costOther = (expenses ?? []).filter((e: { category: string }) => ['location', 'transport', 'autre'].includes(e.category)).reduce((s: number, e: { amount_ht: number }) => s + e.amount_ht, 0)
      const costTotal = costMaterial + costLabor + costSubcontract + costOther

      // Budget
      const { data: chantierData } = await supabase
        .from('chantiers')
        .select('budget_ht, quote_id')
        .eq('id', chantier.id)
        .single()

      // CA facturé
      let revenueHt = 0
      if (chantierData?.quote_id) {
        const { data: invoices } = await supabase
          .from('invoices')
          .select('total_ht, invoice_type')
          .eq('quote_id', chantierData.quote_id)
          .eq('organization_id', orgId)
          .neq('status', 'cancelled')

        revenueHt = (invoices ?? [])
          .filter((inv: { invoice_type: string }) => inv.invoice_type !== 'avoir')
          .reduce((s: number, inv: { total_ht: number }) => s + (inv.total_ht ?? 0), 0)
      }

      const marginEur = revenueHt - costTotal
      const marginPct = revenueHt > 0 ? Math.round((marginEur / revenueHt) * 100) : null

      return {
        chantier: chantier.title,
        budget_ht: chantierData?.budget_ht ?? 0,
        ca_facture_ht: Math.round(revenueHt),
        cout_main_oeuvre: Math.round(costLabor),
        cout_materiel: Math.round(costMaterial),
        cout_sous_traitance: Math.round(costSubcontract),
        cout_autre: Math.round(costOther),
        cout_total: Math.round(costTotal),
        marge_eur: Math.round(marginEur),
        marge_pct: marginPct,
        heures_pointees: hoursLogged,
        taux_horaire: laborRate,
      }
    }

    case 'get_chantiers_at_risk': {
      const { data: chantiersList } = await supabase
        .from('chantiers')
        .select('id, title, budget_ht, quote_id')
        .eq('organization_id', orgId)
        .in('status', ['en_cours', 'planifie'])
        .eq('is_archived', false)

      if (!chantiersList?.length) return { chantiers_at_risk: [] }

      const { data: org } = await supabase
        .from('organizations')
        .select('default_labor_cost_per_hour, default_hourly_rate')
        .eq('id', orgId)
        .single()

      const laborRate = org?.default_labor_cost_per_hour
        ?? (org?.default_hourly_rate ? org.default_hourly_rate * 0.5 : 35)

      const atRisk: unknown[] = []

      for (const c of chantiersList.slice(0, 8)) {
        const [{ data: pointages }, { data: expenses }] = await Promise.all([
          supabase.from('chantier_pointages').select('hours').eq('chantier_id', c.id),
          supabase.from('chantier_expenses').select('amount_ht').eq('chantier_id', c.id),
        ])

        const costLabor = (pointages ?? []).reduce((s: number, p: { hours: number }) => s + p.hours, 0) * laborRate
        const costExpenses = (expenses ?? []).reduce((s: number, e: { amount_ht: number }) => s + e.amount_ht, 0)
        const costTotal = costLabor + costExpenses
        const budgetHt = c.budget_ht ?? 0
        const budgetUsagePct = budgetHt > 0 ? costTotal / budgetHt : 0

        // CA pour calculer marge
        let revenueHt = 0
        if (c.quote_id) {
          const { data: invoices } = await supabase
            .from('invoices').select('total_ht, invoice_type')
            .eq('quote_id', c.quote_id).eq('organization_id', orgId).neq('status', 'cancelled')
          revenueHt = (invoices ?? []).filter((inv: { invoice_type: string }) => inv.invoice_type !== 'avoir').reduce((s: number, inv: { total_ht: number }) => s + (inv.total_ht ?? 0), 0)
        }

        const marginPct = revenueHt > 0 ? ((revenueHt - costTotal) / revenueHt) * 100 : null

        const isBudgetAlert = budgetHt > 0 && budgetUsagePct > 0.9
        const isMarginAlert = marginPct !== null && marginPct < 10

        if (isBudgetAlert || isMarginAlert) {
          atRisk.push({
            chantier: c.title,
            budget_ht: budgetHt,
            cout_total: Math.round(costTotal),
            budget_usage_pct: Math.round(budgetUsagePct * 100),
            marge_pct: marginPct !== null ? Math.round(marginPct) : null,
            alerte: [
              isBudgetAlert ? `budget utilisé à ${Math.round(budgetUsagePct * 100)}%` : null,
              isMarginAlert ? `marge faible (${Math.round(marginPct!)}%)` : null,
            ].filter(Boolean).join(', '),
          })
        }
      }

      return { chantiers_at_risk: atRisk }
    }

    default:
      return { error: `Outil inconnu: ${toolName}` }
  }
}

// ─── Helpers recherche ────────────────────────────────────────────────────────

async function findChantierBySearch(
  supabase: ReturnType<typeof getAdminClient>,
  orgId: string,
  search: string,
): Promise<{ id: string; title: string } | null> {
  const { data } = await supabase
    .from('chantiers')
    .select('id, title')
    .eq('organization_id', orgId)
    .ilike('title', `%${search}%`)
    .not('status', 'eq', 'annule')
    .order('created_at', { ascending: false })
    .limit(1)
  return data?.[0] ?? null
}

async function findClientBySearch(
  supabase: ReturnType<typeof getAdminClient>,
  orgId: string,
  search: string,
): Promise<{ id: string; company_name: string | null; email: string | null } | null> {
  const { data } = await supabase
    .from('clients')
    .select('id, company_name, first_name, last_name, email')
    .eq('organization_id', orgId)
    .or(`company_name.ilike.%${search}%,email.ilike.%${search}%,last_name.ilike.%${search}%`)
    .order('created_at', { ascending: false })
    .limit(1)
  return data?.[0] ?? null
}

async function findQuoteBySearch(
  supabase: ReturnType<typeof getAdminClient>,
  orgId: string,
  search: string,
): Promise<{ id: string; number: string | null; title: string | null; status: string; client: { id: string; email: string | null } | null } | null> {
  const { data } = await supabase
    .from('quotes')
    .select('id, number, title, status, client:clients(id, company_name, email)')
    .eq('organization_id', orgId)
    .or(`number.ilike.%${search}%,title.ilike.%${search}%`)
    .order('created_at', { ascending: false })
    .limit(1)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data?.[0] as any) ?? null
}

async function findInvoiceBySearch(
  supabase: ReturnType<typeof getAdminClient>,
  orgId: string,
  search: string,
): Promise<{ id: string; number: string | null; status: string; client: { id: string; email: string | null } | null } | null> {
  const { data } = await supabase
    .from('invoices')
    .select('id, number, status, client:clients(id, company_name, email)')
    .eq('organization_id', orgId)
    .ilike('number', `%${search}%`)
    .order('created_at', { ascending: false })
    .limit(1)

  if (data?.[0]) return data[0] as any // eslint-disable-line @typescript-eslint/no-explicit-any

  const { data: all } = await supabase
    .from('invoices')
    .select('id, number, status, client:clients(id, company_name, email)')
    .eq('organization_id', orgId)
    .not('status', 'eq', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(20)

  return (all ?? []).find((inv: any) => // eslint-disable-line @typescript-eslint/no-explicit-any
    (inv.client?.company_name ?? '').toLowerCase().includes(search.toLowerCase())
  ) ?? null
}

// ─── Voxtral STT (Mistral API) ────────────────────────────────────────────────

async function transcribeWithVoxtral(
  supabase: ReturnType<typeof getAdminClient>,
  orgId: string,
  audioBuffer: ArrayBuffer,
  mimeType: string,
): Promise<string> {
  const mistralKey = Deno.env.get('MISTRAL_API_KEY')!
  const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mpeg') ? 'mp3' : 'ogg'

  const formData = new FormData()
  formData.append('model', 'voxtral-mini-latest')
  formData.append('file', new Blob([audioBuffer], { type: mimeType }), `audio.${ext}`)

  const res = await fetch('https://api.mistral.ai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${mistralKey}` },
    body: formData,
  })

  if (!res.ok) {
    const errorText = await res.text()
    await logProviderUsage(supabase, {
      organizationId: orgId,
      provider: 'mistral',
      feature: 'whatsapp_transcription',
      model: 'voxtral-mini-latest',
      inputKind: 'audio',
      status: 'error',
      usage: emptyUsageMetrics(),
      externalRequestId: null,
      metadata: {
        error: errorText,
        mime_type: mimeType,
      },
    })
    throw new Error(`Voxtral ${res.status}: ${errorText}`)
  }

  const json = await res.json()
  await logProviderUsage(supabase, {
    organizationId: orgId,
    provider: 'mistral',
    feature: 'whatsapp_transcription',
    model: 'voxtral-mini-latest',
    inputKind: 'audio',
    status: 'success',
    usage: buildUsageMetrics(json.usage),
    externalRequestId: typeof json.id === 'string' ? json.id : null,
    metadata: {
      mime_type: mimeType,
    },
  })
  return json.text ?? ''
}

// ─── Téléchargement média WhatsApp ────────────────────────────────────────────

async function downloadWhatsAppMedia(accessToken: string, mediaId: string): Promise<ArrayBuffer> {
  const urlRes = await fetch(`https://graph.facebook.com/v19.0/${mediaId}`, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  })
  if (!urlRes.ok) throw new Error(`WhatsApp media URL ${urlRes.status}`)
  const { url } = await urlRes.json()

  const fileRes = await fetch(url, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  })
  if (!fileRes.ok) throw new Error(`WhatsApp media download ${fileRes.status}`)
  return fileRes.arrayBuffer()
}

// ─── Envoi message WhatsApp ───────────────────────────────────────────────────

async function sendWhatsAppText(orgConfig: OrgConfig, to: string, text: string): Promise<void> {
  const res = await fetch(
    `https://graph.facebook.com/v19.0/${orgConfig.phone_number_id}/messages`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${orgConfig.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { preview_url: false, body: text },
      }),
    }
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`WhatsApp send ${res.status}: ${body}`)
  }
}

// ─── Envoi email via Resend ───────────────────────────────────────────────────

async function sendResendEmail({ to, subject, html }: { to: string; subject: string; html: string }): Promise<void> {
  const resendKey = Deno.env.get('RESEND_API_KEY')
  const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') ?? 'noreply@kompagnon.app'
  if (!resendKey) return

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: fromEmail, to: [to], subject, html }),
  })
}

// ─── Client Supabase admin ────────────────────────────────────────────────────

function getAdminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )
}

function emptyUsageMetrics(): UsageMetrics {
  return {
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
    providerCost: null,
    currency: 'USD',
  }
}

function buildUsageMetrics(rawUsage?: Record<string, unknown>): UsageMetrics {
  return {
    promptTokens: typeof rawUsage?.prompt_tokens === 'number' ? rawUsage.prompt_tokens : null,
    completionTokens: typeof rawUsage?.completion_tokens === 'number' ? rawUsage.completion_tokens : null,
    totalTokens: typeof rawUsage?.total_tokens === 'number' ? rawUsage.total_tokens : null,
    providerCost: typeof rawUsage?.cost === 'number' ? rawUsage.cost : null,
    currency: 'USD',
  }
}

async function isWhatsAppModuleEnabled(
  supabase: ReturnType<typeof getAdminClient>,
  organizationId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('organization_modules')
    .select('modules')
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (error) {
    console.error('[whatsapp-agent.modules]', error)
    return false
  }

  return data?.modules?.whatsapp_agent === true
}

async function logProviderUsage(
  supabase: ReturnType<typeof getAdminClient>,
  params: {
    organizationId: string
    provider: 'openrouter' | 'mistral'
    feature: 'whatsapp_reply' | 'whatsapp_transcription'
    model: string
    inputKind: 'text' | 'audio'
    status: 'success' | 'error'
    usage: UsageMetrics
    externalRequestId: string | null
    metadata?: Record<string, unknown>
  },
) {
  const { data, error } = await supabase
    .from('usage_logs')
    .insert({
      organization_id: params.organizationId,
      provider: params.provider,
      feature: params.feature,
      model: params.model,
      input_kind: params.inputKind,
      status: params.status,
      prompt_tokens: params.usage.promptTokens,
      completion_tokens: params.usage.completionTokens,
      total_tokens: params.usage.totalTokens,
      provider_cost: params.usage.providerCost,
      currency: params.usage.currency,
      external_request_id: params.externalRequestId,
      metadata: params.metadata ?? null,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[whatsapp-agent.usage_logs.insert]', error)
    return
  }

  const logId = data?.id as string | undefined
  if (!logId) return

  await syncUsageLogToOperator(supabase, logId, {
    source_instance: getOperatorSourceInstance(),
    organization_id: params.organizationId,
    occurred_at: new Date().toISOString(),
    provider: params.provider,
    feature: params.feature,
    model: params.model,
    provider_cost: params.usage.providerCost,
    currency: params.usage.currency,
    total_tokens: params.usage.totalTokens,
    status: params.status,
    local_usage_log_id: logId,
    metadata: params.metadata ?? null,
  })
}

function getOperatorSourceInstance(): string {
  const explicit = Deno.env.get('OPERATOR_SOURCE_INSTANCE')?.trim()
  if (explicit) return explicit

  const appUrl = Deno.env.get('APP_URL')?.trim()
  if (!appUrl) return 'unknown-instance'

  try {
    return new URL(appUrl).host
  } catch {
    return appUrl
  }
}

function hexEncode(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function signOperatorPayload(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return hexEncode(signature)
}

async function syncUsageLogToOperator(
  supabase: ReturnType<typeof getAdminClient>,
  logId: string,
  payload: {
    source_instance: string
    organization_id: string
    occurred_at: string
    provider: string
    feature: string
    model: string
    provider_cost: number | null
    currency: string
    total_tokens: number | null
    status: string
    local_usage_log_id: string
    metadata?: Record<string, unknown> | null
  },
) {
  const url = Deno.env.get('OPERATOR_INGEST_URL')?.trim()
  const secret = Deno.env.get('OPERATOR_INGEST_SECRET')?.trim()

  if (!url || !secret) {
    await supabase
      .from('usage_logs')
      .update({ operator_sync_status: 'skipped', operator_sync_error: null, operator_synced_at: null })
      .eq('id', logId)
    return
  }

  const body = JSON.stringify(payload)

  try {
    const signature = await signOperatorPayload(secret, body)
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-operator-signature': signature,
      },
      body,
    })

    if (!res.ok) {
      throw new Error(`Operator ingest ${res.status}: ${await res.text()}`)
    }

    await supabase
      .from('usage_logs')
      .update({
        operator_sync_status: 'synced',
        operator_sync_error: null,
        operator_synced_at: new Date().toISOString(),
      })
      .eq('id', logId)
  } catch (error) {
    await supabase
      .from('usage_logs')
      .update({
        operator_sync_status: 'failed',
        operator_sync_error: error instanceof Error ? error.message : 'Operator ingest failed',
        operator_synced_at: null,
      })
      .eq('id', logId)
  }
}
