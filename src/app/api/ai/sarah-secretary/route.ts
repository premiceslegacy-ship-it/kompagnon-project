import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { getBusinessContext, formatBusinessContextForPrompt } from '@/lib/ai/business-context'
import { AIModuleDisabledError, AIProviderCreditError, AIRateLimitError, callAI } from '@/lib/ai/callAI'
import { AIQuotaExceededError } from '@/lib/quota'
import { dateParis, todayParis } from '@/lib/utils'
import { fetchRAGContext } from '@/lib/ai/rag'
import { generateEmbedding } from '@/lib/ai/embeddings'
import { hasPermission } from '@/lib/data/queries/membership'
import { deepLinkForSarahAction, proposeSarahAction } from '@/lib/sarah/actions'

export const dynamic = 'force-dynamic'

const MODEL = 'google/gemini-2.5-flash'

// ─── Tool definitions ─────────────────────────────────────────────────────────

const SARAH_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'save_memory',
      description: 'Mémoriser une information importante sur l\'entreprise, un client, une préférence ou une habitude. À appeler quand l\'utilisateur dit "rappelle-toi", "note bien", "retiens que", ou quand une info est clairement utile à long terme. Pas plus d\'une fois par conversation.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Le fait à mémoriser, formulé de façon claire et autonome (ex: "Le client Dupont paie systématiquement en retard de 30 jours").' },
          type: {
            type: 'string',
            enum: ['client_info', 'preference', 'process', 'habit', 'note'],
            description: 'Catégorie du souvenir.',
          },
        },
        required: ['content', 'type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_client',
      description: 'Rechercher un client par nom, société ou email quand il n\'est pas dans les 10 clients récents du contexte. Utiliser quand l\'utilisateur mentionne un client spécifique introuvable dans la liste.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Nom, société ou email du client à rechercher.' },
        },
        required: ['query'],
      },
    },
  },
]

// ─── Tool execution ───────────────────────────────────────────────────────────

async function executeSarahTool(
  name: string,
  args: Record<string, unknown>,
  orgId: string,
  memorySavedThisConversation: { done: boolean },
  conversationId: string | null,
): Promise<string> {
  if (name === 'save_memory') {
    if (memorySavedThisConversation.done) {
      return 'Mémoire déjà sauvegardée dans cette conversation. Je retiens l\'information pour la suite.'
    }

    const content = (args.content as string | undefined)?.trim()
    const type = (args.type as string | undefined) ?? 'note'

    if (!content || content.length < 10) {
      return 'Contenu trop court pour être mémorisé.'
    }

    // Vérifier doublon simple avant d'écrire (ilike sur content)
    const admin = createAdminClient()
    if (conversationId) {
      const { data: alreadySavedInConversation } = await admin
        .from('company_memory')
        .select('id')
        .eq('organization_id', orgId)
        .eq('type', 'sarah_memory')
        .eq('metadata->>sarah_conversation_id', conversationId)
        .eq('is_active', true)
        .limit(1)

      if (alreadySavedInConversation?.length) {
        memorySavedThisConversation.done = true
        return 'Mémoire déjà sauvegardée dans cette conversation. Je retiens l\'information pour la suite.'
      }
    }

    const { data: existing } = await admin
      .from('company_memory')
      .select('id')
      .eq('organization_id', orgId)
      .in('type', ['sarah_memory', type])
      .ilike('content', `%${content.slice(0, 40)}%`)
      .eq('is_active', true)
      .limit(1)

    if (existing && existing.length > 0) {
      return 'Cette information est déjà dans ma mémoire.'
    }

    const { error } = await admin.from('company_memory').insert({
      organization_id: orgId,
      type: 'sarah_memory',
      content,
      source: 'ai_extracted',
      confidence: 0.9,
      is_active: true,
      metadata: {
        memory_type: type,
        sarah_conversation_id: conversationId,
      },
      embedding: null, // Le cron embeddings vectorisera
    })

    if (error) return 'Impossible de sauvegarder ce souvenir pour le moment.'

    // Tenter de générer l'embedding inline si la ligne est courte (< 500 chars)
    if (content.length <= 500) {
      const embedding = await generateEmbedding(content)
      if (embedding) {
        const { data: inserted } = await admin
          .from('company_memory')
          .select('id')
          .eq('organization_id', orgId)
          .eq('type', 'sarah_memory')
          .eq('source', 'ai_extracted')
          .ilike('content', `%${content.slice(0, 40)}%`)
          .order('created_at', { ascending: false })
          .limit(1)
        if (inserted?.[0]?.id) {
          await admin.from('company_memory').update({ embedding }).eq('id', inserted[0].id)
        }
      }
    }

    memorySavedThisConversation.done = true
    return `Mémorisé : "${content}"`
  }

  if (name === 'search_client') {
    const query = (args.query as string | undefined)?.trim()
    if (!query) return 'Requête vide.'
    if (query.length < 2) return 'Requête trop courte.'
    if (query.length > 80) return 'Requête trop longue.'

    const supabase = await createClient()
    const pattern = `%${query.replace(/[%_]/g, '\\$&')}%`
    const columns = ['company_name', 'contact_name', 'email', 'first_name', 'last_name'] as const
    const results = await Promise.all(columns.map(column =>
      supabase
        .from('clients')
        .select('id, company_name, contact_name, first_name, last_name, email')
        .eq('organization_id', orgId)
        .ilike(column, pattern)
        .limit(5),
    ))
    const clients = Array.from(
      new Map(
        results
          .flatMap(result => result.data ?? [])
          .map(client => [client.id, client]),
      ).values(),
    ).slice(0, 5)

    if (!clients || clients.length === 0) {
      return `Aucun client trouvé pour "${query}".`
    }

    const lines = clients.map(c => {
      const name = c.company_name ?? [c.first_name, c.last_name].filter(Boolean).join(' ') ?? c.contact_name ?? c.email ?? '?'
      return `[${c.id}] ${name}${c.email ? ` — ${c.email}` : ''}`
    })
    return `Clients trouvés :\n${lines.join('\n')}`
  }

  return `Outil "${name}" non reconnu.`
}

// ─── Écriture d'un brief inter-assistant en base ──────────────────────────────

async function saveAIBrief(
  orgId: string,
  targetAssistant: 'chloe' | 'nora' | 'marco',
  payload: Record<string, unknown>,
): Promise<void> {
  const supabase = await createClient()
  await supabase.from('ai_briefs').insert({
    organization_id: orgId,
    source_assistant: 'sarah',
    target_assistant: targetAssistant,
    payload,
    status: 'pending',
  })
}

// ─── Persistance des briefs inter-assistants selon le type d'action ──────────
// - brief_chloe  → Chloé (devis)
// - brief_nora   → Nora (planning)
// - planning_*   → Nora (planning) avec description de l'action effectuée
// - brief_marco  → Marco (chantier)

async function persistActionBriefs(orgId: string, action: unknown): Promise<void> {
  if (!action || typeof action !== 'object') return
  const act = action as Record<string, unknown>
  const type = act.type as string | undefined
  const payload = (act.payload ?? {}) as Record<string, unknown>

  if (type === 'brief_chloe') {
    await saveAIBrief(orgId, 'chloe', payload).catch(() => {})
    return
  }

  if (type === 'brief_nora') {
    await saveAIBrief(orgId, 'nora', payload).catch(() => {})
    return
  }

  if (type === 'brief_marco') {
    await saveAIBrief(orgId, 'marco', payload).catch(() => {})
    return
  }

  // Actions planning → informer Nora avec un résumé de ce qui a été fait
  if (type === 'planning_create' || type === 'planning_update' || type === 'planning_delete') {
    const label = (act.label as string | undefined) ?? (payload.label as string | undefined) ?? 'Créneau'
    const chantierTitle = (payload.chantierTitle as string | undefined) ?? (payload.slotLabel as string | undefined) ?? ''
    const date = (payload.plannedDate as string | undefined) ?? ''
    const actionLabel = type === 'planning_create' ? 'Créneau créé' : type === 'planning_update' ? 'Créneau modifié' : 'Créneau supprimé'
    const description = `${actionLabel} par Sarah : "${label ?? chantierTitle}"${date ? ` le ${date}` : ''}. Vérifier et ajuster si besoin.`
    await saveAIBrief(orgId, 'nora', {
      description,
      chantier_title: chantierTitle,
      action_type: type,
      original_payload: payload,
    }).catch(() => {})
  }
}

// ─────────────────────────────────────────────────────────────────────────────

async function attachPersistentProposal(
  orgId: string,
  userId: string | null,
  conversationId: string | null,
  action: unknown,
): Promise<unknown> {
  if (!action || typeof action !== 'object') return action
  const act = action as Record<string, unknown>
  const type = typeof act.type === 'string' ? act.type : null
  if (!type) return action

  const payload = (act.payload && typeof act.payload === 'object' ? act.payload : {}) as Record<string, unknown>
  const label = typeof act.label === 'string' && act.label.trim() ? act.label.trim() : 'Action Sarah'
  const description = typeof act.description === 'string' && act.description.trim() ? act.description.trim() : label
  const risk = act.risk === 'high' || act.risk === 'medium' || act.risk === 'low' ? act.risk : 'low'
  const deepLink = deepLinkForSarahAction(type, payload)
  const dedupeKey = conversationId
    ? `chat:${conversationId}:${type}:${label}:${description.slice(0, 48)}`
    : null

  const proposal = await proposeSarahAction({
    organizationId: orgId,
    userId,
    type,
    risk,
    title: label,
    description,
    payload,
    deepLink,
    dedupeKey,
  })

  if (!proposal) return action

  return {
    ...act,
    proposalId: proposal.id,
    deepLink: proposal.deep_link,
    payload: {
      ...payload,
      deep_link: proposal.deep_link,
    },
  }
}

const SYSTEM_PROMPT = `Tu es Sarah, la secrétaire de l'application Atelier. Tu travailles aux côtés d'un artisan ou d'un chef d'entreprise du bâtiment au quotidien.

Ton rôle : l'aider à piloter son activité, répondre à ses questions, préparer son travail administratif et opérationnel, et lui proposer des actions concrètes quand c'est utile.

Ton ton :
- Chaleureux, humain, professionnel. Comme une vraie secrétaire de confiance.
- Phrases naturelles, bien construites. Pas de style télégraphique.
- Jamais de tiret cadratin (—). Jamais de majuscules en milieu de phrase pour "mettre en valeur". Pas d'emojis.
- Tu vouvois l'utilisateur.
- Tu vas droit au but, sans introduire inutilement ce que tu vas faire.

Ce que tu peux faire :
- Répondre sur l'état de l'activité : chantiers en cours, tâches en retard, planning du jour, factures impayées, devis en attente.
- Rédiger des relances clients, résumés de chantier, notes internes, emails professionnels.
- Préparer un brief devis pour Chloé : si l'utilisateur veut créer un devis, collecte le client, la prestation, les quantités et conditions souhaitées, puis génère un bloc "brief_chloe" structuré pour que Chloé puisse démarrer directement.
- Créer un brouillon simple de devis ou facture depuis le catalogue quand les lignes sont claires : prestations types, produits/services, main d'œuvre, quantités et prix connus.
- Transmettre à Chloé quand le devis est technique, mixte, incomplet ou demande des lignes non triviales : l'utilisateur doit sentir la collaboration entre agents, avec transmission visible puis redirection rapide.
- Préparer un planning complet avec Nora : pour une semaine multi-chantiers, plusieurs personnes, tournées ou entretiens, génère un bloc "brief_nora" structuré et redirige vers le planning global.
- Proposer des actions concrètes : tu joins une carte d'action au message, et l'utilisateur valide en un seul clic sur cette carte. La carte est la validation, ne demande pas de "oui" en plus.
- Signaler des anomalies ou urgences détectées dans les données.
- Résumer la journée ou la semaine à la demande.
- Mémoriser des informations importantes via save_memory (préférences client, habitudes, notes durables).
- Rechercher un client précis via search_client si son nom n'est pas dans les clients récents du contexte.

Ce que tu ne fais PAS (c'est le rôle de Chloé, l'assistante devis) :
- Générer des lignes de devis techniques détaillées, lots complexes, quantitatifs incertains ou prix unitaires estimés.
- Analyser des PDF de cahier des charges.
- Créer le devis technique complet.
Quand l'utilisateur demande "crée/fais/prépare un devis" et que les lignes sont clairement des éléments du catalogue ou des lignes simples avec quantité/prix, propose obligatoirement "draft_quote". N'utilise "brief_chloe" que si le devis est technique, incomplet, incertain, ou nécessite une vraie construction métier.

Niveaux de risque des actions :
- faible : lire, résumer, chercher, créer une note, rédiger un brouillon.
- moyen : préparer une relance, modifier un planning, créer un brouillon de devis.
- fort : envoyer au client, créer une facture, modifier un montant, supprimer.

Format de réponse — JSON strict uniquement :
{
  "reply": "Ta réponse en français naturel",
  "action": null
}

Ou si tu proposes une action à valider :
{
  "reply": "Ton message expliquant ce que tu proposes",
  "action": {
    "type": "type_action",
    "label": "Libellé court",
    "description": "Ce qui sera fait concrètement",
    "risk": "low" | "medium" | "high",
    "payload": {}
  }
}

Types d'actions disponibles :
- "task_complete" : marquer une tâche chantier comme terminée (payload: { tache_id })
- "invoice_reminder" : préparer une relance pour une facture (payload: { invoice_id, client_name, draft_text })
- "open_quote_editor" : ouvrir l'éditeur de devis pour un client (payload: { client_id?, client_name?, redirect_url })
- "brief_chloe" : transmettre un brief devis à Chloé (payload: { client_name, client_id?, description, items?, conditions? })
- "brief_nora" : transmettre un brief planning à Nora (payload: { description, week_hint?, items?, includes_maintenance? })
- "draft_quote" : créer un brouillon de devis simple après validation (payload: { client_id?, client_name?, title?, notes?, items: [{ type?: "prestation" | "material" | "labor" | "custom", catalog_id?, name?, description?, quantity?, unit?, unit_price?, vat_rate?, is_internal? }], requires_chloe?: boolean })
- "draft_invoice" : créer un brouillon de facture simple après validation (payload: { client_id?, client_name?, title?, issue_date?, due_date?, items: [{ type?: "prestation" | "material" | "labor" | "custom", catalog_id?, name?, description?, quantity?, unit?, unit_price?, vat_rate?, is_internal? }] })
- "open_url" : rediriger vers une page de l'app (payload: { url, label })
- "draft_email" : préparer puis envoyer après validation humaine un email client/prospect (payload: { client_ids?: string[], recipient_filter?: { mode: "manual" | "all_active" | "by_status", ids?: string[], statuses?: string[] }, subject, body })
- "planning_create" : créer un créneau planning chantier simple (payload: { chantierId, chantierTitle, plannedDate, startTime?, endTime?, label, teamSize?, notes?, memberId?, memberName?, equipeId?, equipeName? })
- "planning_update" : modifier un créneau existant (payload: { slotId, slotLabel, plannedDate?, startTime?, endTime?, label?, teamSize?, notes?, memberId?, memberName?, equipeId?, equipeName? })
- "planning_delete" : supprimer un créneau existant (payload: { slotId, slotLabel, chantierTitle, plannedDate })
- "brief_marco" : transmettre un contexte ou une question sur un chantier à Marco (payload: { chantier_id, chantier_title, description })

Pages de l'app accessibles via "open_url" (utilise l'URL exacte) :
- Planning global : /chantiers/planning
- Liste des chantiers : /chantiers
- Fiche chantier : /chantiers/[id]
- Liste des clients : /clients
- Fiche client : /clients/[id]
- Finances (factures + devis) : /finances
- Nouveau devis : /finances/quote-editor
- Tableau de bord : /dashboard
- Rapports : /rapports
- Paramètres : /settings

Règles absolues :
- La carte d'action EST la confirmation. Quand l'utilisateur demande clairement une action (par exemple "crée un devis pour Dupont avec telle prestation"), renvoie DIRECTEMENT la carte d'action dans le même message, sans poser de question de validation préalable du type "voulez-vous que je le fasse ?". L'utilisateur valide en cliquant sur la carte. Ne demande JAMAIS deux confirmations.
- Ne pose une question avant la carte QUE s'il manque une information indispensable (client introuvable, prestation ambiguë, quantité absente). Si tout est clair, propose la carte tout de suite.
- Ton "reply" qui accompagne une carte d'action annonce ce qui va être fait ("Je prépare le devis suivant, validez pour le créer."), il ne redemande pas l'autorisation.
- Ne jamais exécuter une action sensible sans avoir proposé une carte d'action et attendu la confirmation (le clic sur la carte).
- Pour un email, utilise uniquement les clients/prospects connus dans le contexte. Ne mets jamais une adresse inventée. Prépare une action "draft_email" avec client_ids ou recipient_filter, subject et body. La confirmation humaine déclenchera l'envoi.
- Ne jamais inventer de données. Si tu ne sais pas, dis-le simplement.
- Si tu proposes "brief_chloe", précise que tu transmets le contexte à Chloé qui proposera directement des lignes de devis à valider dans l'éditeur (ce n'est pas encore un devis enregistré). Renseigne une "description" riche des travaux dans le payload, et si possible "items" et "conditions", car Chloé s'en sert pour bâtir sa proposition. Si tu proposes "draft_quote", précise qu'un brouillon de devis sera créé et ouvert après validation.
- Réponses courtes : 1 à 3 phrases pour une question simple, 5 lignes maximum pour un résumé ou une préparation de contenu.
- Si tu détectes des urgences dans le contexte (factures très en retard, tâches échues depuis plusieurs jours, devis expirant demain), signale-les spontanément sans attendre qu'on te pose la question.
- Pour "ce qui a été fait aujourd'hui", utilise d'abord le bloc "Réalisé aujourd'hui", puis complète avec "Planning du jour" si utile. Ne conclus jamais qu'il ne s'est rien passé si des pointages, tâches terminées, notes ou photos existent.
- Pour le planning, distingue bien les créneaux planifiés et les créneaux déjà pointés. Un créneau pointé reste un créneau qui a existé aujourd'hui, il n'est simplement plus une urgence à traiter.
- Pour les entretiens, ne les invente pas : utilise uniquement les contrats/interventions d'entretien présents dans le contexte. Si la demande contient plusieurs entretiens ou une semaine complète, passe par "brief_nora".`

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  const obj = text.match(/\{[\s\S]*\}/)
  if (obj) return obj[0]
  return text.trim()
}

function fmt(amount: number | null | undefined): string {
  if (amount == null) return '?'
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount)
}

function shortText(value: string | null | undefined, max = 160): string | null {
  if (!value) return null
  const clean = value.replace(/\s+/g, ' ').trim()
  if (!clean) return null
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

type HistoryEntry = { role: 'user' | 'sarah'; content: string }

export async function POST(req: NextRequest) {
  try {
    const { message, page, pathname, pageContext, history, conversationId: rawConversationId } = await req.json()
    const conversationHistory: HistoryEntry[] = Array.isArray(history) ? history.slice(-10) : []
    const conversationId = typeof rawConversationId === 'string' && rawConversationId.length <= 80
      ? rawConversationId
      : null

    if (!message?.trim()) {
      return NextResponse.json({ error: 'Message vide.', code: 'empty_message' }, { status: 400 })
    }

    const orgId = await getCurrentOrganizationId()
    if (!orgId) {
      return NextResponse.json({ error: 'Non connecté.', code: 'unauthenticated' }, { status: 401 })
    }

    // Gate : seuls les membres avec la permission ai.sarah peuvent utiliser Sarah
    const aiAllowed = await hasPermission('ai.sarah')
    if (!aiAllowed) {
      return NextResponse.json({ error: 'permission_denied', code: 'permission_denied' }, { status: 403 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const today = todayParis()
    const tomorrow = dateParis(Date.now() + 24 * 60 * 60 * 1000)
    const in3days = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)

    const isFirstMessage = !conversationHistory.some(h => h.role === 'user')

    const [businessCtx, ragContext, dailyBriefResult] = await Promise.all([
      getBusinessContext(orgId),
      fetchRAGContext(orgId, message, { limit: 4 }),
      // Lire le brief du jour uniquement au premier message de la conversation
      isFirstMessage
        ? supabase
            .from('company_memory')
            .select('id, content, metadata')
            .eq('organization_id', orgId)
            .eq('type', 'daily_brief')
            .eq('metadata->>date', today)
            .eq('is_active', true)
            .limit(1)
        : Promise.resolve({ data: null, error: null }),
    ])
    const businessPrompt = formatBusinessContextForPrompt(businessCtx)

    // Toutes les données opérationnelles en parallèle
    const in7days = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)

    const [
      { data: recentQuotes },
      { data: overdueInvoices },
      { data: expiringQuotes },
      { data: activeChantiers },
      { data: lateTasks },
      { data: todayPlanning },
      { data: todayPointages },
      { data: todayCompletedTasks },
      { data: todayNotes },
      { data: todayPhotos },
      { data: weekPlanning },
      { data: newRequests },
      { data: recentInvoices },
      { data: keyClients },
      { data: recentClients },
      { data: emailContacts },
      { data: equipes },
      { data: membresIndividuels },
      { data: maintenanceContracts },
      { data: todayMaintenance },
      { data: weekMaintenance },
      { data: catalogMaterials },
      { data: catalogLaborRates },
      { data: catalogPrestations },
    ] = await Promise.all([
      // Derniers devis
      supabase
        .from('quotes')
        .select('id, reference, status, total_ttc, client_name, created_at, valid_until')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(5),

      // Factures en retard ou en attente
      supabase
        .from('invoices')
        .select('id, reference, status, total_ttc, client_name, due_date')
        .eq('organization_id', orgId)
        .in('status', ['sent', 'overdue', 'partial'])
        .order('due_date', { ascending: true })
        .limit(8),

      // Devis qui expirent dans les 3 prochains jours
      supabase
        .from('quotes')
        .select('id, reference, client_name, valid_until, total_ttc')
        .eq('organization_id', orgId)
        .in('status', ['sent', 'viewed'])
        .gte('valid_until', today)
        .lte('valid_until', in3days),

      // Chantiers actifs
      supabase
        .from('chantiers')
        .select('id, title, status, client_name, end_date')
        .eq('organization_id', orgId)
        .in('status', ['en_cours', 'planifie'])
        .order('end_date', { ascending: true })
        .limit(8),

      // Tâches en retard (due_date <= aujourd'hui, pas terminées)
      supabase
        .from('chantier_taches')
        .select('id, title, status, due_date, chantier:chantiers!inner(id, title, organization_id, is_archived, status)')
        .eq('chantier.organization_id', orgId)
        .eq('chantier.is_archived', false)
        .not('chantier.status', 'in', '("termine","annule")')
        .not('status', 'eq', 'termine')
        .not('due_date', 'is', null)
        .lte('due_date', today)
        .order('due_date', { ascending: true })
        .limit(8),

      // Planning du jour (avec horaires, label, intervenant)
      supabase
        .from('chantier_plannings')
        .select('id, planned_date, start_time, end_time, label, team_size, notes, member_id, equipe_id, chantier:chantiers!inner(id, title, organization_id, is_archived, status, client_name), member:chantier_equipe_membres(prenom, name), equipe:chantier_equipes(id, name)')
        .eq('chantier.organization_id', orgId)
        .eq('chantier.is_archived', false)
        .not('chantier.status', 'in', '("termine","annule")')
        .eq('planned_date', today)
        .order('start_time', { ascending: true, nullsFirst: false }),

      supabase
        .from('chantier_pointages')
        .select('id, chantier_planning_id, chantier_id, tache_id, user_id, member_id, date, hours, start_time, description, created_at, profile:profiles(full_name), membre:chantier_equipe_membres(prenom, name), tache:chantier_taches(title), chantier:chantiers!inner(id, title, client_name, organization_id, is_archived, status)')
        .eq('chantier.organization_id', orgId)
        .eq('chantier.is_archived', false)
        .eq('date', today)
        .order('start_time', { ascending: true, nullsFirst: false })
        .limit(40),

      supabase
        .from('activity_log')
        .select('user_id, entity_id, metadata, created_at')
        .eq('organization_id', orgId)
        .eq('action', 'chantier_task.completed')
        .gte('created_at', `${today}T00:00:00+02:00`)
        .lt('created_at', `${tomorrow}T00:00:00+02:00`)
        .order('created_at', { ascending: false })
        .limit(25),

      supabase
        .from('chantier_notes')
        .select('id, content, created_at, author:profiles(full_name), chantier:chantiers!inner(id, title, client_name, organization_id, is_archived, status)')
        .eq('chantier.organization_id', orgId)
        .eq('chantier.is_archived', false)
        .gte('created_at', `${today}T00:00:00+02:00`)
        .lt('created_at', `${tomorrow}T00:00:00+02:00`)
        .order('created_at', { ascending: false })
        .limit(20),

      supabase
        .from('chantier_photos')
        .select('id, title, caption, taken_at, created_at, uploader:profiles(full_name), tache:chantier_taches(title), chantier:chantiers!inner(id, title, client_name, organization_id, is_archived, status)')
        .eq('chantier.organization_id', orgId)
        .eq('chantier.is_archived', false)
        .gte('created_at', `${today}T00:00:00+02:00`)
        .lt('created_at', `${tomorrow}T00:00:00+02:00`)
        .order('created_at', { ascending: false })
        .limit(20),

      // Planning des 7 prochains jours (hors aujourd'hui)
      supabase
        .from('chantier_plannings')
        .select('id, planned_date, start_time, end_time, label, team_size, notes, member_id, equipe_id, chantier:chantiers!inner(id, title, organization_id, is_archived, status, client_name), member:chantier_equipe_membres(prenom, name), equipe:chantier_equipes(id, name)')
        .eq('chantier.organization_id', orgId)
        .eq('chantier.is_archived', false)
        .not('chantier.status', 'in', '("termine","annule")')
        .gt('planned_date', today)
        .lte('planned_date', in7days)
        .order('planned_date', { ascending: true })
        .order('start_time', { ascending: true, nullsFirst: false })
        .limit(20),

      // Nouvelles demandes de devis entrantes
      supabase
        .from('quote_requests')
        .select('id, name, company_name, subject, description, status, created_at')
        .eq('organization_id', orgId)
        .eq('status', 'new')
        .order('created_at', { ascending: false })
        .limit(5),

      supabase
        .from('invoices')
        .select('id, reference, number, title, status, total_ttc, total_paid, issue_date, due_date, client_name')
        .eq('organization_id', orgId)
        .eq('is_archived', false)
        .order('issue_date', { ascending: false, nullsFirst: false })
        .limit(8),

      supabase
        .from('clients')
        .select('id, company_name, contact_name, first_name, last_name, email, phone, mobile, city, status, payment_terms_days, total_revenue, total_paid, internal_notes, notes')
        .eq('organization_id', orgId)
        .eq('is_archived', false)
        .order('total_revenue', { ascending: false, nullsFirst: false })
        .limit(10),

      // Clients récents (pour les actions)
      supabase
        .from('clients')
        .select('id, company_name, contact_name, first_name, last_name, email')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(10),

      // Répertoire email compact : clients/prospects/leads joignables
      supabase
        .from('clients')
        .select('id, company_name, contact_name, first_name, last_name, email, status, city, internal_notes, notes')
        .eq('organization_id', orgId)
        .eq('is_archived', false)
        .not('email', 'is', null)
        .neq('email', '')
        .order('created_at', { ascending: false })
        .limit(24),

      // Équipes (pour les actions planning)
      supabase
        .from('chantier_equipes')
        .select('id, name, membres:chantier_equipe_membres(id, prenom, name, role_label)')
        .eq('organization_id', orgId)
        .order('name', { ascending: true })
        .limit(20),

      // Membres individuels sans équipe
      supabase
        .from('chantier_equipe_membres')
        .select('id, prenom, name, role_label')
        .eq('organization_id', orgId)
        .is('equipe_id', null)
        .order('name', { ascending: true })
        .limit(40),

      supabase
        .from('maintenance_contracts')
        .select('id, title, status, prochaine_intervention, site_name, site_city, client:clients(company_name, first_name, last_name)')
        .eq('organization_id', orgId)
        .neq('status', 'résilié')
        .order('prochaine_intervention', { ascending: true, nullsFirst: false })
        .limit(12),

      supabase
        .from('maintenance_interventions')
        .select('id, maintenance_contract_id, date_intervention, start_time, end_time, observations, statut, intervenant_member_id, intervenant:chantier_equipe_membres(prenom, name), contract:maintenance_contracts!inner(title, organization_id)')
        .eq('contract.organization_id', orgId)
        .eq('date_intervention', today)
        .in('statut', ['planifiée', 'réalisée'])
        .order('start_time', { ascending: true, nullsFirst: false })
        .limit(12),

      supabase
        .from('maintenance_interventions')
        .select('id, maintenance_contract_id, date_intervention, start_time, end_time, observations, statut, intervenant_member_id, intervenant:chantier_equipe_membres(prenom, name), contract:maintenance_contracts!inner(title, organization_id)')
        .eq('contract.organization_id', orgId)
        .gt('date_intervention', today)
        .lte('date_intervention', in7days)
        .in('statut', ['planifiée'])
        .order('date_intervention', { ascending: true })
        .order('start_time', { ascending: true, nullsFirst: false })
        .limit(20),

      supabase
        .from('materials')
        .select('id, name, reference, item_kind, category, unit, sale_price, vat_rate')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(30),

      supabase
        .from('labor_rates')
        .select('id, designation, reference, category, unit, rate, cost_rate, vat_rate')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(20),

      supabase
        .from('prestation_types')
        .select('id, name, category, unit, base_price_ht, vat_rate')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('category', { ascending: true })
        .order('name', { ascending: true })
        .limit(30),
    ])

    const equipeMembersById = new Map<string, string>()
    for (const e of equipes ?? []) {
      const eq = e as any
      const members = (eq.membres ?? [])
        .map((m: any) => [m.prenom, m.name].filter(Boolean).join(' ').trim())
        .filter(Boolean)
      if (eq.id) equipeMembersById.set(eq.id, members.join(', '))
    }

    const pointedPlanningIds = new Set((todayPointages ?? []).map((p: any) => p.chantier_planning_id).filter(Boolean))
    const pointedPlanningKeys = new Set((todayPointages ?? []).map((p: any) => `${p.chantier_id}:${p.date}:${p.member_id ?? p.user_id ?? '*'}`))
    const pointedPlanningDayKeys = new Set((todayPointages ?? []).map((p: any) => `${p.chantier_id}:${p.date}`))
    const todaySlotPointageStatus = (slot: any): string => {
      if (pointedPlanningIds.has(slot.id)) return 'statut : créneau déjà pointé'
      const chantierId = (slot.chantier as any)?.id ?? ''
      const directKey = `${chantierId}:${today}:${slot.member_id ?? '*'}`
      const genericKey = `${chantierId}:${today}:*`
      if (pointedPlanningKeys.has(directKey) || pointedPlanningKeys.has(genericKey)) return 'statut : créneau déjà pointé'
      const dayKey = `${chantierId}:${today}`
      if (pointedPlanningDayKeys.has(dayKey)) return 'statut : pointage enregistré sur ce chantier aujourd’hui'
      return 'statut : pas encore pointé'
    }

    const formatPlanningIntervenant = (slot: any): string | null => {
      const m = slot.member as any
      if (m) {
        const full = [m.prenom, m.name].filter(Boolean).join(' ').trim()
        return full || null
      }

      const eq = slot.equipe as any
      if (eq) {
        const members = equipeMembersById.get(eq.id ?? slot.equipe_id)
        return members ? `équipe ${eq.name}, membres : ${members}` : `équipe ${eq.name}`
      }

      return null
    }

    // Construction du contexte injecté dans le prompt
    const contextLines: string[] = [
      `Date du jour : ${today}`,
      `Page actuelle : ${page ?? 'Atelier'}`,
      `URL actuelle : ${pathname ?? '/'}`,
      '',
      businessPrompt,
    ]

    if (pageContext) {
      contextLines.push('', `Contexte de la page ouverte : ${JSON.stringify(pageContext)}`)
    }

    if (ragContext) {
      contextLines.push('', 'Mémoire entreprise (extraits pertinents) :', ragContext)
    }

    if (todayPointages?.length || todayCompletedTasks?.length || todayNotes?.length || todayPhotos?.length) {
      contextLines.push('', `Réalisé aujourd'hui (${today}) :`)

      if (todayPointages?.length) {
        contextLines.push('  Pointages enregistrés :')
        for (const p of todayPointages) {
          const chantier = (p as any).chantier
          const memberName = [(p as any).membre?.prenom, (p as any).membre?.name].filter(Boolean).join(' ').trim()
          const person = (p as any).profile?.full_name ?? (memberName || 'Intervenant non renseigné')
          const detail = [
            p.start_time ? `début ${String(p.start_time).slice(0, 5)}` : null,
            `${p.hours ?? '?'}h`,
            (p as any).tache?.title ? `tâche "${(p as any).tache.title}"` : null,
            p.description ? shortText(p.description, 120) : null,
          ].filter(Boolean).join(', ')
          contextLines.push(`    ${person} - chantier "${chantier?.title ?? '?'}" (${chantier?.client_name ?? '?'}) - ${detail}${(p as any).chantier_planning_id ? ` - lié au créneau ${((p as any).chantier_planning_id as string).slice(0, 8)}` : ''}`)
        }
      }

      if (todayCompletedTasks?.length) {
        contextLines.push('  Tâches terminées :')
        for (const log of todayCompletedTasks) {
          const meta = (log.metadata ?? {}) as Record<string, unknown>
          contextLines.push(`    ${meta.actor_name ?? 'Quelqu’un'} a terminé "${meta.task_title ?? 'tâche'}"${meta.chantier_title ? ` sur "${meta.chantier_title}"` : ''}.`)
        }
      }

      if (todayNotes?.length) {
        contextLines.push('  Notes chantier ajoutées :')
        for (const note of todayNotes) {
          const chantier = (note as any).chantier
          const author = (note as any).author?.full_name ?? 'Auteur non renseigné'
          contextLines.push(`    ${author} - "${chantier?.title ?? '?'}" : ${shortText(note.content, 140)}`)
        }
      }

      if (todayPhotos?.length) {
        contextLines.push('  Photos/preuves ajoutées :')
        for (const photo of todayPhotos) {
          const chantier = (photo as any).chantier
          const uploader = (photo as any).uploader?.full_name ?? 'Auteur non renseigné'
          const label = shortText(photo.title ?? photo.caption ?? (photo as any).tache?.title ?? 'photo ajoutée', 120)
          contextLines.push(`    ${uploader} - "${chantier?.title ?? '?'}" : ${label}`)
        }
      }
    } else {
      contextLines.push('', `Réalisé aujourd'hui (${today}) : aucun pointage, tâche terminée, note ou photo enregistré.`)
    }

    // Planning du jour
    if (todayPlanning?.length) {
      contextLines.push('', `Planning du jour (${today}) - tous les créneaux, même ceux déjà pointés :`)
      for (const slot of todayPlanning) {
        const c = (slot.chantier as any)
        const horaire = slot.start_time
          ? `${slot.start_time.slice(0, 5)}${slot.end_time ? ` - ${slot.end_time.slice(0, 5)}` : ''}`
          : null
        const intervenant = formatPlanningIntervenant(slot)
        const details = [todaySlotPointageStatus(slot), horaire, intervenant ? `intervenant : ${intervenant}` : null, slot.label, slot.notes].filter(Boolean).join(', ')
        contextLines.push(`  [SLOT:${slot.id}] Chantier "${c?.title ?? '?'}" (client : ${c?.client_name ?? '?'})${details ? ` - ${details}` : ''}`)
      }
    } else {
      contextLines.push('', `Planning du jour (${today}) : aucune intervention planifiée.`)
    }

    // Planning de la semaine à venir
    if (weekPlanning?.length) {
      contextLines.push('', 'Planning des 7 prochains jours :')
      for (const slot of weekPlanning) {
        const c = (slot.chantier as any)
        const horaire = slot.start_time
          ? `${slot.start_time.slice(0, 5)}${slot.end_time ? ` - ${slot.end_time.slice(0, 5)}` : ''}`
          : null
        const intervenant = formatPlanningIntervenant(slot)
        const details = [horaire, intervenant ? `intervenant : ${intervenant}` : null, slot.notes].filter(Boolean).join(', ')
        contextLines.push(`  [SLOT:${slot.id}] ${slot.planned_date} - Chantier "${c?.title ?? '?'}" (client : ${c?.client_name ?? '?'})${details ? ` - ${details}` : ''}`)
      }
    }

    if (todayMaintenance?.length || weekMaintenance?.length) {
      contextLines.push('', 'Interventions entretien planifiées :')
      for (const iv of [...(todayMaintenance ?? []), ...(weekMaintenance ?? [])]) {
        const contract = Array.isArray((iv as any).contract) ? (iv as any).contract[0] : (iv as any).contract
        const intervenant = (iv as any).intervenant
        const fullName = [intervenant?.prenom, intervenant?.name].filter(Boolean).join(' ').trim()
        const horaire = iv.start_time
          ? `${String(iv.start_time).slice(0, 5)}${iv.end_time ? ` - ${String(iv.end_time).slice(0, 5)}` : ''}`
          : null
        const details = [horaire, fullName ? `intervenant : ${fullName}` : null, iv.observations].filter(Boolean).join(', ')
        contextLines.push(`  [SLOT:maintenance:${iv.id}] ${iv.date_intervention} - Entretien "${contract?.title ?? '?'}" [MAINTENANCE_CONTRACT:${iv.maintenance_contract_id}]${details ? ` - ${details}` : ''}`)
      }
    }

    if (maintenanceContracts?.length) {
      contextLines.push('', 'Contrats entretien actifs (pour brief_nora entretien) :')
      for (const contract of maintenanceContracts) {
        const client = Array.isArray((contract as any).client) ? (contract as any).client[0] : (contract as any).client
        const clientName = client?.company_name ?? [client?.first_name, client?.last_name].filter(Boolean).join(' ')
        contextLines.push(`  [MAINTENANCE_CONTRACT:${contract.id}] ${contract.title}${clientName ? ` - client ${clientName}` : ''}${contract.site_name ? ` - site ${contract.site_name}` : ''}${contract.site_city ? ` - ${contract.site_city}` : ''}${contract.prochaine_intervention ? ` - prochaine ${contract.prochaine_intervention}` : ''}`)
      }
    }

    // Tâches en retard
    if (lateTasks?.length) {
      contextLines.push('', 'Tâches en retard :')
      for (const t of lateTasks) {
        const c = (t.chantier as any)
        contextLines.push(`  [${t.id}] "${t.title}" - chantier "${c?.title ?? '?'}" - échue le ${t.due_date}`)
      }
    }

    // Devis expirant bientôt
    if (expiringQuotes?.length) {
      contextLines.push('', 'Devis expirant dans les 3 prochains jours :')
      for (const q of expiringQuotes) {
        contextLines.push(`  ${q.reference} - ${q.client_name ?? '?'} - expire le ${q.valid_until} - ${fmt(q.total_ttc)}`)
      }
    }

    // Factures en attente ou en retard
    if (overdueInvoices?.length) {
      contextLines.push('', 'Factures en attente de paiement :')
      for (const inv of overdueInvoices) {
        const retard = inv.due_date && inv.due_date < today ? ` (EN RETARD depuis le ${inv.due_date})` : ` (échéance ${inv.due_date ?? 'non définie'})`
        contextLines.push(`  [${inv.id}] ${inv.reference} - ${inv.client_name ?? '?'} - ${fmt(inv.total_ttc)}${retard}`)
      }
    }

    if (recentInvoices?.length) {
      contextLines.push('', 'Dernières factures :')
      for (const inv of recentInvoices) {
        const paid = inv.total_paid != null && inv.total_paid > 0 ? `, encaissé ${fmt(inv.total_paid)}` : ''
        contextLines.push(`  [${inv.id}] ${inv.reference ?? inv.number ?? inv.title ?? 'Facture'} - ${inv.client_name ?? '?'} - ${inv.status} - ${fmt(inv.total_ttc)}${paid} - échéance ${inv.due_date ?? 'n/a'}`)
      }
    }

    // Derniers devis
    if (recentQuotes?.length) {
      contextLines.push('', 'Devis récents :')
      for (const q of recentQuotes) {
        contextLines.push(`  [${q.id}] ${q.reference} - ${q.client_name ?? '?'} - ${q.status} - ${fmt(q.total_ttc)}`)
      }
    }

    // Chantiers actifs
    if (activeChantiers?.length) {
      contextLines.push('', 'Chantiers actifs (utilisez ces IDs pour les actions planning) :')
      for (const c of activeChantiers) {
        contextLines.push(`  [CHANTIER:${c.id}] ${c.title} - ${c.client_name ?? ''} - fin prévue : ${c.end_date ?? 'non définie'}`)
      }
    }

    // Équipes et membres (pour actions planning)
    if (equipes?.length) {
      contextLines.push('', 'Équipes disponibles (pour les actions planning) :')
      for (const e of equipes) {
        const eq = e as any
        const membresStr = (eq.membres ?? []).map((m: any) => {
          const full = [m.prenom, m.name].filter(Boolean).join(' ')
          return `${full}${m.role_label ? ` (${m.role_label})` : ''} [MEMBER:${m.id}]`
        }).join(', ')
        contextLines.push(`  [EQUIPE:${eq.id}] ${eq.name}${membresStr ? ` — membres : ${membresStr}` : ''}`)
      }
    }
    if (membresIndividuels?.length) {
      contextLines.push('', 'Membres individuels disponibles (sans équipe) :')
      for (const m of membresIndividuels) {
        const full = [m.prenom, m.name].filter(Boolean).join(' ')
        contextLines.push(`  [MEMBER:${m.id}] ${full}${m.role_label ? ` (${m.role_label})` : ''}`)
      }
    }

    if (catalogPrestations?.length || catalogMaterials?.length || catalogLaborRates?.length) {
      contextLines.push('', 'Catalogue utilisable pour brouillons devis/factures :')
      for (const p of catalogPrestations ?? []) {
        contextLines.push(`  [PRESTATION:${p.id}] ${p.name}${p.category ? ` - ${p.category}` : ''} - ${fmt(p.base_price_ht)} / ${p.unit ?? 'u'}${p.vat_rate != null ? ` - TVA ${p.vat_rate}%` : ''}`)
      }
      for (const m of catalogMaterials ?? []) {
        contextLines.push(`  [CATALOG:${m.id}] ${m.name}${m.reference ? ` (${m.reference})` : ''}${m.category ? ` - ${m.category}` : ''} - ${m.item_kind ?? 'article'} - ${fmt(m.sale_price)} / ${m.unit ?? 'u'}${m.vat_rate != null ? ` - TVA ${m.vat_rate}%` : ''}`)
      }
      for (const l of catalogLaborRates ?? []) {
        contextLines.push(`  [LABOR:${l.id}] ${l.designation}${l.reference ? ` (${l.reference})` : ''}${l.category ? ` - ${l.category}` : ''} - ${fmt(l.rate ?? l.cost_rate)} / ${l.unit ?? 'h'}${l.vat_rate != null ? ` - TVA ${l.vat_rate}%` : ''}`)
      }
      contextLines.push('  Pour draft_quote/draft_invoice, utilisez catalog_id avec ces IDs quand l’élément correspond clairement.')
    }

    // Nouvelles demandes de devis
    if (newRequests?.length) {
      contextLines.push('', 'Nouvelles demandes de devis à traiter :')
      for (const r of newRequests) {
        const who = r.company_name ?? r.name ?? '?'
        contextLines.push(`  ${who} - "${r.subject ?? r.description?.slice(0, 60) ?? '?'}"`)
      }
    }

    const clientMap = new Map<string, any>()
    for (const cl of keyClients ?? []) clientMap.set(cl.id, cl)
    for (const cl of recentClients ?? []) clientMap.set(cl.id, cl)
    const clientsForContext = [...clientMap.values()].slice(0, 14)

    // Clients disponibles (pour les redirections et actions)
    if (clientsForContext.length) {
      contextLines.push('', 'Clients à connaître (importants ou récents) :')
      for (const cl of clientsForContext) {
        const name = cl.company_name ?? [cl.first_name, cl.last_name].filter(Boolean).join(' ') ?? cl.contact_name ?? cl.email ?? '?'
        const notes = shortText(cl.internal_notes ?? cl.notes, 120)
        contextLines.push(`  [${cl.id}] ${name}${cl.city ? ` (${cl.city})` : ''}${cl.status ? ` - statut ${cl.status}` : ''}${cl.payment_terms_days != null ? ` - délai paiement ${cl.payment_terms_days}j` : ''}${cl.total_revenue != null ? ` - CA ${fmt(cl.total_revenue)}` : ''}${notes ? ` - note : ${notes}` : ''}`)
      }
    }

    if (emailContacts?.length) {
      contextLines.push('', 'Répertoire email clients/prospects (utilisez ces IDs pour draft_email, sans inventer de destinataire) :')
      for (const cl of emailContacts) {
        const name = cl.company_name ?? [cl.first_name, cl.last_name].filter(Boolean).join(' ') ?? cl.contact_name ?? cl.email ?? '?'
        const notes = shortText(cl.internal_notes ?? cl.notes, 80)
        contextLines.push(`  [CLIENT:${cl.id}] ${name}${cl.status ? ` - statut ${cl.status}` : ''}${cl.city ? ` - ${cl.city}` : ''} - email ${cl.email}${notes ? ` - note : ${notes}` : ''}`)
      }
      contextLines.push('  Filtres email autorisés si l’utilisateur vise un groupe : { mode: "all_active" } ou { mode: "by_status", statuses: ["prospect" | "lead_hot" | "lead_cold" | "active" | "subcontractor" | "inactive"] }. Maximum 50 destinataires.')
    }

    // Brief du jour (premier message uniquement) — injecté dans le contexte et marqué lu
    const dailyBriefRow = (dailyBriefResult as any)?.data?.[0] ?? null
    if (dailyBriefRow?.content && dailyBriefRow.metadata?.read !== true) {
      contextLines.push('', `Brief du jour (généré ce matin) :\n${dailyBriefRow.content}`)
      // Marquer lu de façon non-bloquante
      void (async () => {
        try {
          await supabase
            .from('company_memory')
            .update({ metadata: { ...dailyBriefRow.metadata, read: true } })
            .eq('id', dailyBriefRow.id)
            .eq('organization_id', orgId)
        } catch { /* non bloquant */ }
      })()
    }

    const userContext = contextLines.join('\n')
    const memorySavedThisConversation = { done: false }

    const apiMessages: Array<{ role: string; content: string }> = [
      { role: 'system', content: `${SYSTEM_PROMPT}\n\n---\nCONTEXTE ATELIER (mis à jour à chaque message) :\n${userContext}` },
      ...conversationHistory.slice(0, -1).map(h => ({
        role: h.role === 'user' ? 'user' : 'assistant',
        content: h.content,
      })),
      { role: 'user', content: message },
    ]

    // Premier appel avec tools disponibles
    const result = await callAI<any>({
      organizationId: orgId,
      provider: 'openrouter',
      feature: 'sarah_assistant',
      model: MODEL,
      inputKind: 'text',
      request: {
        body: {
          messages: apiMessages,
          tools: SARAH_TOOLS,
          tool_choice: 'auto',
          temperature: 0.3,
          max_tokens: 600,
        },
      },
    })

    const responseData = result.data as { choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }> }
    const assistantMsg = responseData?.choices?.[0]?.message

    // Si Sarah appelle des tools, les exécuter puis relancer
    if (assistantMsg?.tool_calls && assistantMsg.tool_calls.length > 0) {
      const toolResults: Array<{ role: string; tool_call_id: string; content: string }> = []

      for (const tc of assistantMsg.tool_calls) {
        let args: Record<string, unknown> = {}
        try { args = JSON.parse(tc.function.arguments) } catch { /* ignore */ }
        const toolResult = await executeSarahTool(tc.function.name, args, orgId, memorySavedThisConversation, conversationId)
        toolResults.push({ role: 'tool', tool_call_id: tc.id, content: toolResult })
      }

      // Deuxième appel avec résultats des tools — format JSON pour la réponse finale
      const result2 = await callAI<any>({
        organizationId: orgId,
        provider: 'openrouter',
        feature: 'sarah_assistant',
        model: MODEL,
        inputKind: 'text',
        request: {
          body: {
            messages: [
              ...apiMessages,
              assistantMsg,
              ...toolResults,
            ],
            temperature: 0.3,
            max_tokens: 500,
            response_format: { type: 'json_object' },
          },
        },
      })

      const content2 = (result2.data as any)?.choices?.[0]?.message?.content ?? ''
      const raw2 = extractJson(content2)
      let parsed2: { reply: string; action?: unknown }
      try { parsed2 = JSON.parse(raw2) } catch { parsed2 = { reply: raw2 } }
      if (typeof parsed2.reply !== 'string' || !parsed2.reply) {
        parsed2.reply = raw2 || "Je n'ai pas pu formuler de réponse."
      }

      parsed2.action = await attachPersistentProposal(orgId, user?.id ?? null, conversationId, parsed2.action)
      return NextResponse.json(parsed2)
    }

    // Pas de tool call — réponse directe JSON
    const rawContent = assistantMsg?.content ?? ''
    const raw = extractJson(rawContent)
    let parsed: { reply: string; action?: unknown }
    try { parsed = JSON.parse(raw) } catch { parsed = { reply: raw } }
    if (typeof parsed.reply !== 'string' || !parsed.reply) {
      parsed.reply = raw || "Je n'ai pas pu formuler de réponse."
    }

    parsed.action = await attachPersistentProposal(orgId, user?.id ?? null, conversationId, parsed.action)
    return NextResponse.json(parsed)
  } catch (err) {
    if (err instanceof AIModuleDisabledError) {
      return NextResponse.json({ error: 'module_disabled', code: 'module_disabled' }, { status: 403 })
    }
    if (err instanceof AIRateLimitError) {
      return NextResponse.json({ error: 'rate_limit', code: 'rate_limit' }, { status: 429 })
    }
    if (err instanceof AIProviderCreditError && err.aiBillingMode === 'client_owned') {
      return NextResponse.json({ error: 'openrouter_credits', code: 'openrouter_credits' }, { status: 402 })
    }
    if (err instanceof AIQuotaExceededError) {
      return NextResponse.json({
        error: 'quota_exceeded',
        code: 'quota_exceeded',
        quotaMonthly: err.quotaMonthly,
        usedQuantity: err.usedQuantity,
      }, { status: 402 })
    }
    console.error('[sarah-secretary]', err)
    return NextResponse.json({ error: 'server_error', code: 'server_error' }, { status: 500 })
  }
}
