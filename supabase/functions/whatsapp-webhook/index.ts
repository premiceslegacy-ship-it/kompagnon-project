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
 *   → Claude Sonnet 4.6 (OpenRouter) + tool_use
 *   → Exécution outils Supabase (chantiers, pointages, notes…)
 *   → Réponse WhatsApp via Cloud API
 *
 * Variables Supabase Secrets :
 *   OPENROUTER_API_KEY
 *   MISTRAL_API_KEY
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

interface OrgConfig {
  id: string
  name: string
  phone_number_id: string
  access_token: string
  authorized_numbers: string[]
}

// ─── Outils Claude ────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'get_resume',
    description: 'Résumé de la situation actuelle : chantiers en cours, factures impayées, devis en attente, tâches urgentes.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_chantiers',
    description: 'Liste les chantiers en cours ou planifiés. Retourne titre, statut, ville, progression tâches.',
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
    description: 'Liste les factures en retard de paiement avec montant et client.',
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
    name: 'get_prestation_types',
    description: 'Liste les prestations types du catalogue (nom, prix HT, unité, catégorie). À appeler avant create_quote pour connaître les tarifs disponibles.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'create_quote',
    description: 'Crée un nouveau devis en brouillon pour un client avec des lignes. Le client est recherché par nom ou email.',
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
    description: 'Convertit un devis en facture. Cherche le devis par numéro ou mots-clés du titre.',
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
]

// ─── Handler principal ────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  // GET : vérification du webhook Meta
  if (req.method === 'GET') {
    const url = new URL(req.url)
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')

    if (mode !== 'subscribe' || !token || !challenge) {
      return new Response('Bad Request', { status: 400 })
    }

    // Chercher une org avec ce verify_token
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

  // POST : messages entrants
  if (req.method === 'POST') {
    const payload = await req.json() as WebhookPayload

    // Toujours ACK immédiatement (Meta exige < 5s)
    // On traite en arrière-plan via waitUntil équivalent (Edge Function timeout = 150s)
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

      // Lookup org
      const { data: config } = await supabase
        .from('whatsapp_configs')
        .select('id, is_active, access_token, authorized_numbers, organizations(id, name)')
        .eq('phone_number_id', phoneNumberId)
        .single()

      if (!config || !config.is_active) continue

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const org = (config as any).organizations
      const orgConfig: OrgConfig = {
        id: org.id,
        name: org.name,
        phone_number_id: phoneNumberId,
        access_token: config.access_token,
        authorized_numbers: config.authorized_numbers ?? [],
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

  // Vérification numéro autorisé
  if (orgConfig.authorized_numbers.length > 0 && !orgConfig.authorized_numbers.includes(fromNumber)) {
    await sendWhatsAppText(orgConfig, fromNumber,
      "Désolé, ce numéro n'est pas autorisé à utiliser l'assistant Kompagnon.")
    return
  }

  let userText: string | null = null
  let transcription: string | null = null
  let messageType = msg.type

  // Transcription vocale
  if (msg.type === 'audio' && msg.audio?.id) {
    try {
      const audioBuffer = await downloadWhatsAppMedia(orgConfig.access_token, msg.audio.id)
      transcription = await transcribeWithVoxtral(audioBuffer, msg.audio.mime_type)
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
    // Type non supporté
    await sendWhatsAppText(orgConfig, fromNumber,
      "Je gère les messages texte et vocaux. Envoyez-moi votre demande en texte ou par vocal !")
    return
  }

  if (!userText?.trim()) return

  // Log message entrant
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

  // Claude Sonnet avec outils
  const { reply, toolCalls } = await callClaude(supabase, orgConfig, userText, fromNumber)

  // Log message sortant
  await supabase.from('whatsapp_messages').insert({
    organization_id: orgConfig.id,
    direction: 'outbound',
    from_number: orgConfig.phone_number_id,
    to_number: fromNumber,
    message_type: 'text',
    content: reply,
    tool_calls: toolCalls.length ? toolCalls : null,
  })

  // Envoi réponse
  await sendWhatsAppText(orgConfig, fromNumber, reply)
}

// ─── Claude Sonnet + tool_use ─────────────────────────────────────────────────

async function callClaude(
  supabase: ReturnType<typeof getAdminClient>,
  orgConfig: OrgConfig,
  userText: string,
  _fromNumber: string,
): Promise<{ reply: string; toolCalls: unknown[] }> {
  const openrouterKey = Deno.env.get('OPENROUTER_API_KEY')!
  const appUrl = Deno.env.get('APP_URL') ?? ''
  const today = new Date().toISOString().split('T')[0]

  const systemPrompt = `Tu es l'assistant IA de ${orgConfig.name}, un artisan BTP.
Tu réponds en français, de façon concise (WhatsApp = messages courts).
Tu peux consulter les données de l'application et agir dessus via les outils disponibles.
Date d'aujourd'hui : ${today}.
Sois direct et pratique — l'artisan est souvent sur le terrain.`

  const messages = [{ role: 'user', content: userText }]
  const allToolCalls: unknown[] = []

  // Boucle agentic (jusqu'à 5 tours d'outils max)
  for (let turn = 0; turn < 5; turn++) {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openrouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': appUrl,
        'X-Title': 'Kompagnon',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        max_tokens: 1024,
        system: systemPrompt,
        messages,
        tools: TOOLS.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })),
        tool_choice: 'auto',
        user: orgConfig.id,
      }),
    })

    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`)
    const json = await res.json()
    const choice = json.choices?.[0]

    if (!choice) throw new Error('No choice from Claude')

    // Réponse finale (pas d'appel outil)
    if (choice.finish_reason === 'stop' || choice.finish_reason === 'length') {
      const text = choice.message?.content ?? ''
      return { reply: text, toolCalls: allToolCalls }
    }

    // Traitement tool_calls
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

      // Ajouter assistant + tool results pour le prochain tour
      messages.push(choice.message)
      messages.push(...toolResults)
      continue
    }

    // Cas inattendu
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
      const [{ data: chantiers }, { data: invoices }, { data: quotes }] = await Promise.all([
        supabase.from('chantiers').select('title, status, city').eq('organization_id', orgId).in('status', ['en_cours', 'planifie']).limit(5),
        supabase.from('invoices').select('number, total_ttc, currency, due_date, client:clients(company_name)').eq('organization_id', orgId).eq('status', 'sent').lt('due_date', today).limit(5),
        supabase.from('quotes').select('number, total_ttc, currency, status').eq('organization_id', orgId).in('status', ['sent', 'viewed']).limit(5),
      ])
      return { chantiers_en_cours: chantiers ?? [], factures_impayees: invoices ?? [], devis_en_attente: quotes ?? [] }
    }

    case 'get_chantiers': {
      const { data } = await supabase
        .from('chantiers')
        .select('id, title, status, city, estimated_end_date')
        .eq('organization_id', orgId)
        .in('status', ['en_cours', 'planifie', 'suspendu'])
        .order('created_at', { ascending: false })
        .limit(10)
      return data ?? []
    }

    case 'add_pointage': {
      const chantier = await findChantierBySearch(supabase, orgId, input.chantier_search)
      if (!chantier) return { error: `Chantier introuvable pour "${input.chantier_search}"` }

      // Trouver le user_id via le profil owner (simplification MVP)
      const { data: membership } = await supabase
        .from('memberships')
        .select('user_id')
        .eq('organization_id', orgId)
        .eq('is_owner', true)
        .single()

      if (!membership) return { error: 'Impossible de déterminer l\'utilisateur' }

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

      if (!membership) return { error: 'Impossible de déterminer l\'utilisateur' }

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
      return data ?? []
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
      const { data } = await supabase
        .from('prestation_types')
        .select('id, name, category, unit, base_price_ht, base_cost_ht, base_margin_pct, vat_rate')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('category', { ascending: true })
        .order('name', { ascending: true })
      return data ?? []
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
      if (!clientEmail) return { error: 'Pas d\'adresse email pour ce client' }

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
      if (quote.status === 'converted') return { error: `Ce devis a déjà été converti en facture` }

      // Charger les lignes du devis
      const { data: quoteItems } = await supabase
        .from('quote_items')
        .select('description, quantity, unit, unit_price, vat_rate, position')
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
        }))
        await supabase.from('invoice_items').insert(invItems)
      }

      // Marquer le devis comme converti
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
      if (!clientEmail) return { error: 'Pas d\'adresse email pour ce client' }

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

    default:
      return { error: `Outil inconnu: ${toolName}` }
  }
}

// ─── Helper : recherche chantier par mots-clés ───────────────────────────────

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

// ─── Voxtral STT (Mistral API) ────────────────────────────────────────────────

async function transcribeWithVoxtral(audioBuffer: ArrayBuffer, mimeType: string): Promise<string> {
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

  if (!res.ok) throw new Error(`Voxtral ${res.status}: ${await res.text()}`)
  const json = await res.json()
  return json.text ?? ''
}

// ─── Téléchargement média WhatsApp ────────────────────────────────────────────

async function downloadWhatsAppMedia(accessToken: string, mediaId: string): Promise<ArrayBuffer> {
  // 1. Obtenir l'URL de téléchargement
  const urlRes = await fetch(`https://graph.facebook.com/v19.0/${mediaId}`, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  })
  if (!urlRes.ok) throw new Error(`WhatsApp media URL ${urlRes.status}`)
  const { url } = await urlRes.json()

  // 2. Télécharger le fichier
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

// ─── Helper : recherche client ───────────────────────────────────────────────

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

// ─── Helper : recherche devis ────────────────────────────────────────────────

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

// ─── Helper : recherche facture ──────────────────────────────────────────────

async function findInvoiceBySearch(
  supabase: ReturnType<typeof getAdminClient>,
  orgId: string,
  search: string,
): Promise<{ id: string; number: string | null; status: string; client: { id: string; email: string | null } | null } | null> {
  // Cherche d'abord par numéro
  const { data } = await supabase
    .from('invoices')
    .select('id, number, status, client:clients(id, company_name, email)')
    .eq('organization_id', orgId)
    .ilike('number', `%${search}%`)
    .order('created_at', { ascending: false })
    .limit(1)

  if (data?.[0]) return data[0] as any // eslint-disable-line @typescript-eslint/no-explicit-any

  // Fallback : cherche par nom client
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

// ─── Helper : envoi email via Resend ─────────────────────────────────────────

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
