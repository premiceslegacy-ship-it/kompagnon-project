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
import { findReplacementCandidates, findPlanningConflicts, findMissingPointages } from '@/lib/data/mutations/planning-agent'
import { getMemberAbsences } from '@/lib/data/mutations/absences'
import { getDashboardStats } from '@/lib/data/queries/dashboard'
import { clientNameFromJoin } from '@/lib/client'

// Les tables quotes/invoices/chantiers n'ont pas de colonne client_name :
// le nom se résout via la relation clients (voir clientNameFromJoin).
const CLIENT_JOIN = 'client:clients(company_name, first_name, last_name, contact_name, email)'

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
  {
    type: 'function',
    function: {
      name: 'find_replacement_candidates',
      description: 'Chercher qui peut remplacer un membre absent sur un chantier à une date et un horaire donnés. Exclut automatiquement les membres déjà occupés ou déclarés absents sur cette période. Utiliser avant de proposer un remplacement, jamais en devinant une disponibilité.',
      parameters: {
        type: 'object',
        properties: {
          chantierId: { type: 'string', description: 'ID du chantier concerné (utiliser les IDs [CHANTIER:...] du contexte).' },
          plannedDate: { type: 'string', description: 'Date du créneau au format YYYY-MM-DD.' },
          startTime: { type: 'string', description: 'Heure de début HH:MM, si connue.' },
          endTime: { type: 'string', description: 'Heure de fin HH:MM, si connue.' },
          excludeMemberId: { type: 'string', description: 'ID du membre absent à ne pas proposer comme remplaçant.' },
        },
        required: ['chantierId', 'plannedDate'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_planning_conflicts',
      description: 'Détecter les conflits de planning (même membre ou équipe affecté sur deux créneaux qui se chevauchent) sur une période donnée. Utiliser quand l\'utilisateur demande un point sur les conflits ou avant de préparer un planning cohérent.',
      parameters: {
        type: 'object',
        properties: {
          fromDate: { type: 'string', description: 'Date de début YYYY-MM-DD.' },
          toDate: { type: 'string', description: 'Date de fin YYYY-MM-DD.' },
        },
        required: ['fromDate', 'toDate'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_missing_pointages',
      description: 'Lister les créneaux planifiés à une date donnée qui n\'ont pas encore de pointage associé. Ne signifie pas que la personne était absente : signale uniquement une absence de pointage à vérifier.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Date au format YYYY-MM-DD.' },
        },
        required: ['date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_member_absences',
      description: 'Vérifier les absences déjà déclarées pour un membre ou sur une période, avant de proposer un remplacement ou de répondre sur la disponibilité de quelqu\'un.',
      parameters: {
        type: 'object',
        properties: {
          memberId: { type: 'string', description: 'ID du membre à vérifier, si connu.' },
          fromDate: { type: 'string', description: 'Début de la période YYYY-MM-DD.' },
          toDate: { type: 'string', description: 'Fin de la période YYYY-MM-DD.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_documents',
      description: 'Rechercher des devis ou des factures par référence, nom de client ou statut, au-delà des documents récents du contexte. Utiliser dès que l\'utilisateur mentionne un devis ou une facture introuvable dans le contexte.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['quote', 'invoice', 'both'], description: 'Type de document recherché.' },
          query: { type: 'string', description: 'Référence, numéro ou nom de client.' },
          status: { type: 'string', description: 'Filtre statut facultatif : draft, sent, viewed, signed, refused, paid, partial, overdue.' },
        },
        required: ['kind'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_chantier_details',
      description: 'Obtenir le détail complet d\'un chantier : tâches et leur état, planning à venir, dernières notes, dépenses. Utiliser pour toute question précise sur un chantier donné (avancement, ce qui reste à faire, coûts), y compris si le chantier n\'est pas dans le contexte : la recherche par nom fonctionne.',
      parameters: {
        type: 'object',
        properties: {
          chantierId: { type: 'string', description: 'ID du chantier si connu (IDs [CHANTIER:...] du contexte).' },
          query: { type: 'string', description: 'Nom (même partiel) du chantier si l\'ID n\'est pas connu.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_client_overview',
      description: 'Obtenir en un seul appel la situation complète d\'un client précis : ses chantiers actifs, ses factures en attente ou en retard, ses devis en attente. Utiliser systématiquement dès que la question porte sur "ce client a-t-il des factures / chantiers / devis en cours" ou toute question croisant plusieurs sujets pour un même client nommé, plutôt que d\'enchaîner get_chantier_details et search_documents séparément.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Nom, société ou email du client à vérifier.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_financial_summary',
      description: 'Donner le chiffre facturé TTC, l\'encaissé, les devis en attente et le nombre de chantiers en cours sur un mois donné. Utiliser pour toute question sur le CA, la facturation, les encaissements ou le nombre de chantiers actifs — ce sont les mêmes chiffres que ceux affichés sur le tableau de bord.',
      parameters: {
        type: 'object',
        properties: {
          month: { type: 'string', description: 'Mois au format YYYY-MM. Si absent, le mois courant est utilisé.' },
        },
        required: [],
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

  if (name === 'find_replacement_candidates') {
    const chantierId = (args.chantierId as string | undefined)?.trim()
    const plannedDate = (args.plannedDate as string | undefined)?.trim()
    if (!chantierId || !plannedDate) return 'Chantier ou date manquant pour chercher un remplaçant.'

    const { candidates, error } = await findReplacementCandidates({
      chantierId,
      plannedDate,
      startTime: (args.startTime as string | undefined) ?? null,
      endTime: (args.endTime as string | undefined) ?? null,
      excludeMemberId: (args.excludeMemberId as string | undefined) ?? null,
    })
    if (error) return `Erreur : ${error}`
    if (candidates.length === 0) return 'Aucun membre trouvé dans l\'organisation.'

    const available = candidates.filter(c => !c.exclusionReason)
    const excluded = candidates.filter(c => c.exclusionReason)
    const lines = [
      ...available.map(c => `[MEMBER:${c.memberId}] ${c.name} - ${c.reasons.join(' ')}`),
      ...excluded.slice(0, 5).map(c => `[MEMBER:${c.memberId}] ${c.name} - écarté : ${c.exclusionReason}`),
    ]
    return `Candidats pour ce créneau (disponibilité non confirmée sans donnée positive, à valider avec la personne) :\n${lines.join('\n')}`
  }

  if (name === 'check_planning_conflicts') {
    const fromDate = (args.fromDate as string | undefined)?.trim()
    const toDate = (args.toDate as string | undefined)?.trim()
    if (!fromDate || !toDate) return 'Période manquante pour vérifier les conflits.'

    const { conflicts, error } = await findPlanningConflicts(fromDate, toDate)
    if (error) return `Erreur : ${error}`
    if (conflicts.length === 0) return 'Aucun conflit de planning détecté sur cette période.'

    const lines = conflicts.map(c => `${c.name} le ${c.date} : ${c.slots.map(s => `"${s.chantierTitle}" ${s.startTime ?? '?'}-${s.endTime ?? '?'}`).join(' / ')}`)
    return `Conflits détectés :\n${lines.join('\n')}`
  }

  if (name === 'check_missing_pointages') {
    const date = (args.date as string | undefined)?.trim()
    if (!date) return 'Date manquante.'

    const { missing, error } = await findMissingPointages(date)
    if (error) return `Erreur : ${error}`
    if (missing.length === 0) return `Aucun pointage manquant détecté pour le ${date}.`

    const lines = missing.map(m => `[SLOT:${m.slotId}] "${m.chantierTitle}" - ${m.memberName ?? m.label}${m.startTime ? ` - ${m.startTime}${m.endTime ? `-${m.endTime}` : ''}` : ''}${m.memberId ? ` [MEMBER:${m.memberId}]` : ''}`)
    return `Pointages manquants pour le ${date} (absence de pointage, pas nécessairement absence réelle) :\n${lines.join('\n')}`
  }

  if (name === 'check_member_absences') {
    const absences = await getMemberAbsences({
      memberId: (args.memberId as string | undefined) ?? undefined,
      fromDate: (args.fromDate as string | undefined) ?? undefined,
      toDate: (args.toDate as string | undefined) ?? undefined,
    })
    if (absences.length === 0) return 'Aucune absence déclarée trouvée pour cette recherche.'
    const lines = absences.map(a => `[MEMBER:${a.member_id}] du ${a.start_date} au ${a.end_date}${a.reason ? ` - ${a.reason}` : ''}`)
    return `Absences déclarées :\n${lines.join('\n')}`
  }

  if (name === 'search_documents') {
    const kind = (args.kind as string | undefined) ?? 'both'
    const query = (args.query as string | undefined)?.trim()
    const status = (args.status as string | undefined)?.trim()
    if (!query && !status) return 'Précisez une référence, un client ou un statut à rechercher.'

    const supabase = await createClient()
    const pattern = query ? `%${query.replace(/[%_]/g, '\\$&')}%` : null
    const lines: string[] = []

    // Le nom client vit dans la table clients : on résout d'abord les clients
    // correspondants pour inclure leurs documents dans la recherche.
    let matchingClientIds: string[] = []
    if (pattern) {
      const clientResults = await Promise.all(
        (['company_name', 'contact_name', 'first_name', 'last_name'] as const).map(column =>
          supabase.from('clients').select('id').eq('organization_id', orgId).ilike(column, pattern).limit(10),
        ),
      )
      matchingClientIds = [...new Set(clientResults.flatMap(r => (r.data ?? []).map(c => c.id)))]
    }
    // "reference" n'existe que sur quotes, pas sur invoices (colonne number
    // uniquement) : deux filtres distincts pour éviter une erreur PostgREST
    // silencieuse sur .or() côté invoices.
    const clientIdFilter = matchingClientIds.length ? [`client_id.in.(${matchingClientIds.join(',')})`] : []
    const quoteOrFilter = pattern
      ? [`reference.ilike.${pattern}`, `number.ilike.${pattern}`, ...clientIdFilter].join(',')
      : null
    const invoiceOrFilter = pattern
      ? [`number.ilike.${pattern}`, ...clientIdFilter].join(',')
      : null

    if (kind === 'quote' || kind === 'both') {
      let q = supabase
        .from('quotes')
        .select(`id, reference, number, status, total_ttc, created_at, valid_until, ${CLIENT_JOIN}`)
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(8)
      if (quoteOrFilter) q = q.or(quoteOrFilter)
      if (status) q = q.eq('status', status)
      const { data } = await q
      for (const d of data ?? []) {
        lines.push(`Devis [${d.id}] ${d.reference ?? d.number ?? '?'} - ${clientNameFromJoin((d as any).client) ?? '?'} - statut ${d.status} - ${d.total_ttc != null ? `${Number(d.total_ttc).toFixed(2)} €` : '?'}${d.valid_until ? ` - valide jusqu'au ${d.valid_until}` : ''}`)
      }
    }

    if (kind === 'invoice' || kind === 'both') {
      let q = supabase
        .from('invoices')
        .select(`id, number, status, total_ttc, total_paid, due_date, ${CLIENT_JOIN}`)
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(8)
      if (invoiceOrFilter) q = q.or(invoiceOrFilter)
      if (status) q = q.eq('status', status)
      const { data } = await q
      for (const d of data ?? []) {
        lines.push(`Facture [${d.id}] ${d.number ?? '?'} - ${clientNameFromJoin((d as any).client) ?? '?'} - statut ${d.status} - ${d.total_ttc != null ? `${Number(d.total_ttc).toFixed(2)} €` : '?'}${d.total_paid ? ` (encaissé ${Number(d.total_paid).toFixed(2)} €)` : ''}${d.due_date ? ` - échéance ${d.due_date}` : ''}`)
      }
    }

    if (lines.length === 0) return 'Aucun document trouvé pour cette recherche.'
    return `Documents trouvés :\n${lines.join('\n')}`
  }

  if (name === 'get_chantier_details') {
    const chantierIdArg = (args.chantierId as string | undefined)?.trim()
    const query = (args.query as string | undefined)?.trim()
    if (!chantierIdArg && !query) return 'Précisez un ID ou un nom de chantier.'

    const supabase = await createClient()
    let chantier: { id: string; title: string; status: string; budget_ht: number | null; city: string | null; client?: unknown } | null = null

    if (chantierIdArg) {
      const { data } = await supabase
        .from('chantiers')
        .select(`id, title, status, budget_ht, city, ${CLIENT_JOIN}`)
        .eq('id', chantierIdArg)
        .eq('organization_id', orgId)
        .maybeSingle()
      chantier = data
    }

    if (!chantier && query) {
      const pattern = `%${query.replace(/[%_]/g, '\\$&')}%`

      // Le nom de chantier peut être différent du nom du client recherché
      // (ex: "Opération atelier" pour le client "Groupe Deschamps Industrie") :
      // on cherche par titre de chantier ET par client associé, pas seulement le titre.
      const clientMatches = await Promise.all(
        (['company_name', 'contact_name', 'first_name', 'last_name'] as const).map(column =>
          supabase.from('clients').select('id').eq('organization_id', orgId).ilike(column, pattern).limit(10),
        ),
      )
      const matchingClientIds = [...new Set(clientMatches.flatMap(r => (r.data ?? []).map(c => c.id)))]

      let q = supabase
        .from('chantiers')
        .select(`id, title, status, budget_ht, city, ${CLIENT_JOIN}`)
        .eq('organization_id', orgId)
        .eq('is_archived', false)
        .order('created_at', { ascending: false })
        .limit(5)
      q = matchingClientIds.length
        ? q.or(`title.ilike.${pattern},client_id.in.(${matchingClientIds.join(',')})`)
        : q.ilike('title', pattern)
      const { data: matches, error: matchError } = await q
      if (process.env.NODE_ENV !== 'production' && matchError) {
        console.log('[sarah get_chantier_details] match error', matchError.message, 'pattern:', pattern)
      }
      if (matches && matches.length > 1) {
        return `Plusieurs chantiers correspondent à "${query}" :\n${matches.map(m => `[CHANTIER:${m.id}] ${m.title} - ${clientNameFromJoin((m as any).client) ?? '?'} - ${m.status}`).join('\n')}\nRelance l'outil avec le chantierId voulu.`
      }
      chantier = matches?.[0] ?? null
    }

    if (!chantier) return 'Chantier introuvable.'
    const chantierId = chantier.id

    const [{ data: taches }, { data: plannings }, { data: notes }, { data: expenses }] = await Promise.all([
      supabase.from('chantier_taches').select('id, title, status, due_date').eq('chantier_id', chantierId).order('due_date', { ascending: true, nullsFirst: false }).limit(20),
      supabase.from('chantier_plannings').select('id, planned_date, start_time, end_time, label').eq('chantier_id', chantierId).gte('planned_date', todayParis()).order('planned_date', { ascending: true }).limit(10),
      supabase.from('chantier_notes').select('content, created_at').eq('chantier_id', chantierId).order('created_at', { ascending: false }).limit(5),
      supabase.from('chantier_expenses').select('label, amount_ht, category, expense_date').eq('chantier_id', chantierId).order('expense_date', { ascending: false, nullsFirst: false }).limit(10),
    ])

    const lines: string[] = [
      `Chantier "${chantier.title}" - client ${clientNameFromJoin(chantier.client) ?? '?'} - statut ${chantier.status}${chantier.budget_ht ? ` - budget ${Number(chantier.budget_ht).toFixed(0)} € HT` : ''}${chantier.city ? ` - ${chantier.city}` : ''}`,
    ]
    if (taches?.length) {
      const done = taches.filter(t => t.status === 'termine').length
      lines.push(`Tâches (${done}/${taches.length} terminées) :`)
      for (const t of taches) lines.push(`  [${t.id}] "${t.title}" - ${t.status}${t.due_date ? ` - échéance ${t.due_date}` : ''}`)
    } else lines.push('Aucune tâche enregistrée.')
    if (plannings?.length) {
      lines.push('Planning à venir :')
      for (const p of plannings) lines.push(`  ${p.planned_date}${p.start_time ? ` ${String(p.start_time).slice(0, 5)}` : ''}${p.end_time ? `-${String(p.end_time).slice(0, 5)}` : ''} - ${p.label ?? ''}`)
    }
    if (notes?.length) {
      lines.push('Dernières notes :')
      for (const n of notes) lines.push(`  ${String(n.created_at).slice(0, 10)} : ${String(n.content).replace(/\s+/g, ' ').slice(0, 140)}`)
    }
    if (expenses?.length) {
      const total = expenses.reduce((sum, e) => sum + Number(e.amount_ht ?? 0), 0)
      lines.push(`Dernières dépenses (total affiché ${total.toFixed(2)} € HT) :`)
      for (const e of expenses) lines.push(`  ${e.expense_date ?? '?'} - ${e.label} - ${Number(e.amount_ht ?? 0).toFixed(2)} € HT${e.category ? ` (${e.category})` : ''}`)
    }
    return lines.join('\n')
  }

  if (name === 'get_client_overview') {
    const query = (args.query as string | undefined)?.trim()
    if (!query) return 'Précisez un nom, une société ou un email de client.'

    const supabase = await createClient()
    const pattern = `%${query.replace(/[%_]/g, '\\$&')}%`
    const columns = ['company_name', 'contact_name', 'email', 'first_name', 'last_name'] as const
    const clientResults = await Promise.all(columns.map(column =>
      supabase
        .from('clients')
        .select('id, company_name, contact_name, first_name, last_name, email')
        .eq('organization_id', orgId)
        .ilike(column, pattern)
        .limit(5),
    ))
    const clients = Array.from(
      new Map(clientResults.flatMap(r => r.data ?? []).map(c => [c.id, c])).values(),
    )

    if (clients.length === 0) return `Aucun client trouvé pour "${query}".`
    if (clients.length > 1) {
      const lines = clients.map(c => {
        const name = c.company_name ?? [c.first_name, c.last_name].filter(Boolean).join(' ') ?? c.contact_name ?? c.email ?? '?'
        return `[${c.id}] ${name}`
      })
      return `Plusieurs clients correspondent à "${query}" :\n${lines.join('\n')}\nRelance l'outil avec un nom plus précis.`
    }

    const client = clients[0]
    const clientName = client.company_name ?? [client.first_name, client.last_name].filter(Boolean).join(' ') ?? client.contact_name ?? client.email ?? query

    const [{ data: chantiers }, { data: quotes }, { data: invoices }] = await Promise.all([
      supabase
        .from('chantiers')
        .select('id, title, status, end_date')
        .eq('organization_id', orgId)
        .eq('client_id', client.id)
        .in('status', ['en_cours', 'planifie'])
        .order('end_date', { ascending: true, nullsFirst: false }),
      supabase
        .from('quotes')
        .select('id, reference, number, status, total_ttc, valid_until')
        .eq('organization_id', orgId)
        .eq('client_id', client.id)
        .in('status', ['sent', 'viewed'])
        .order('created_at', { ascending: false }),
      supabase
        .from('invoices')
        .select('id, number, status, total_ttc, total_paid, due_date')
        .eq('organization_id', orgId)
        .eq('client_id', client.id)
        .in('status', ['sent', 'overdue', 'partial'])
        .order('due_date', { ascending: true, nullsFirst: false }),
    ])

    const today = todayParis()
    const lines = [`Situation de ${clientName} :`]

    if (chantiers?.length) {
      lines.push('Chantiers actifs :')
      for (const c of chantiers) lines.push(`  [CHANTIER:${c.id}] "${c.title}" - ${c.status} - fin prévue : ${c.end_date ?? 'non définie'}`)
    } else {
      lines.push('Aucun chantier actif.')
    }

    if (invoices?.length) {
      lines.push('Factures en attente ou en retard :')
      for (const inv of invoices) {
        const retard = inv.due_date && inv.due_date < today ? ` (EN RETARD depuis le ${inv.due_date})` : ` (échéance ${inv.due_date ?? 'non définie'})`
        lines.push(`  [${inv.id}] ${inv.number ?? '?'} - ${fmt(inv.total_ttc)}${retard}`)
      }
    } else {
      lines.push('Aucune facture en attente ou en retard.')
    }

    if (quotes?.length) {
      lines.push('Devis en attente de réponse :')
      for (const q of quotes) lines.push(`  [${q.id}] ${q.reference ?? q.number ?? '?'} - ${fmt(q.total_ttc)}${q.valid_until ? ` - valide jusqu'au ${q.valid_until}` : ''}`)
    } else {
      lines.push('Aucun devis en attente de réponse.')
    }

    return lines.join('\n')
  }

  if (name === 'get_financial_summary') {
    const month = (args.month as string | undefined)?.trim() || undefined
    const stats = await getDashboardStats(month)

    const supabase = await createClient()
    const { count: chantiersEnCours } = await supabase
      .from('chantiers')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('status', 'en_cours')

    return [
      `Facturé TTC : ${stats.caMois.toFixed(2)} €`,
      `Encaissé : ${stats.encaisseMois.toFixed(2)} €`,
      `Devis en attente de réponse : ${stats.devisEnAttente}`,
      `Factures en retard : ${stats.facturesEnRetard}`,
      `Chantiers en cours : ${chantiersEnCours ?? 0}`,
    ].join('\n')
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
- Créer des fiches clients et prospects, ouvrir des chantiers, ajouter des tâches, des notes internes et des dépenses chantier.
- Analyser une pièce jointe envoyée dans le chat (photo de chantier, facture fournisseur, devis reçu, document PDF) : décrivez ce que vous y voyez et proposez l'action utile (enregistrer une dépense, créer une note, préparer un devis). La pièce jointe n'est visible que dans le message où elle est envoyée : si l'utilisateur y fait référence plus tard, appuyez-vous sur ce qui a été dit dans la conversation.
- Suivre la facturation de bout en bout : envoyer un devis ou une facture (uniquement sur demande explicite), marquer un devis accepté ou refusé, marquer une facture payée, relancer un devis ou une facture en attente.
- Mémoriser des informations importantes via save_memory (préférences client, habitudes, notes durables).
- Rechercher un client précis via search_client si son nom n'est pas dans les clients récents du contexte.
- Rechercher n'importe quel devis ou facture via search_documents (par référence, client ou statut) quand le document n'est pas dans le contexte.
- Consulter le détail complet d'un chantier via get_chantier_details (tâches, planning, notes, dépenses) pour répondre précisément sur son avancement.
- Consulter la situation complète d'un client via get_client_overview (chantiers actifs, factures en attente/retard, devis en attente) en un seul appel dès que la question croise plusieurs sujets pour ce client.
- Lire les messages que les autres assistants (Marco, Chloé, Nora) vous transmettent : s'il y a un bloc "Messages des autres assistants" dans le contexte, mentionnez-le spontanément à l'utilisateur et proposez la suite logique.
- Gérer les absences, remplacements, conflits de planning et pointages manquants avec les outils dédiés (voir section "Planning intelligent" ci-dessous).

Planning intelligent - règles impératives :
- Une absence ne se déclare que si l'utilisateur le dit explicitement ("Nora est absente", "Marc ne vient pas"). Utilise alors l'action "absence_declare" pour l'enregistrer, avec validation.
- Un pointage manquant n'est JAMAIS une preuve d'absence. Si l'utilisateur demande "qui n'a pas pointé", utilise check_missing_pointages et présente le résultat comme une absence de pointage à vérifier, jamais comme une absence de la personne.
- Avant de proposer un remplacement, utilise find_replacement_candidates. N'affirme jamais qu'une personne est "disponible" avec certitude : dis plutôt qu'elle n'est ni absente déclarée ni déjà occupée, et que la disponibilité reste à confirmer avec elle si aucune donnée positive ne le garantit.
- N'invente jamais d'heures, de disponibilité ou d'horaires. Si une donnée manque, dis-le et propose de vérifier plutôt que d'agir.
- Pour un remplacement, utilise l'action "planning_replacement_suggest" (payload: { slotId?, chantierId, plannedDate, startTime?, endTime?, memberId, memberName, label?, notes? }) : rien n'est modifié avant validation.
- Pour un rappel de pointage, utilise l'action "pointage_reminder_prepare" (payload: { memberId, memberName, reminderText? }) : jamais envoyé deux fois pour le même créneau grâce à la déduplication automatique.
- Pour un point sur les conflits de planning, utilise check_planning_conflicts et résume clairement qui est en double réservation.
- Si les données sont incomplètes pour conclure (disponibilité incertaine, identité ambiguë), réponds avec ce qui est à vérifier plutôt que de proposer une action automatique.

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
- "absence_declare" : déclarer l'absence d'un membre après confirmation explicite de l'utilisateur (payload: { memberId, memberName, startDate, endDate, reason? })
- "planning_replacement_suggest" : mettre en place un remplacement sur un créneau (payload: { slotId?, chantierId, plannedDate, startTime?, endTime?, memberId, memberName, label?, notes? })
- "pointage_reminder_prepare" : préparer un rappel de pointage à un membre (payload: { memberId, memberName, reminderText? })
- "client_create" : créer une fiche client ou prospect, risque faible (payload: { type: "company" | "individual", company_name?, first_name?, last_name?, contact_name?, email?, phone?, siret?, address_line1?, postal_code?, city?, status?: "active" | "prospect" | "lead_hot" | "lead_cold" | "subcontractor" })
- "chantier_create" : créer un chantier, risque moyen (payload: { title, client_id?, client_name?, description?, address_line1?, postal_code?, city?, start_date?, estimated_end_date?, budget_ht? })
- "task_create" : ajouter une tâche à un chantier, risque faible (payload: { chantierId, title, description?, due_date?, member_ids?, equipe_ids? })
- "chantier_note_add" : ajouter une note interne sur un chantier, risque faible (payload: { chantierId, content })
- "expense_record" : enregistrer une dépense sur un chantier, risque moyen (payload: { chantierId, label, amount_ht, category?: "materiel" | "sous_traitance" | "location" | "transport" | "autre", vat_rate?, expense_date?, supplier_name?, notes? })
- "invoice_mark_paid" : marquer une facture envoyée comme payée intégralement, risque fort (payload: { invoice_id })
- "invoice_send" : envoyer une facture au client par email, risque fort (payload: { invoice_id }). Uniquement si l'utilisateur le demande explicitement.
- "quote_send" : envoyer un devis au client pour signature, risque fort (payload: { quote_id }). Uniquement si l'utilisateur le demande explicitement.
- "quote_mark_accepted" : marquer un devis comme accepté, risque moyen (payload: { quote_id })
- "quote_mark_refused" : marquer un devis comme refusé, risque moyen (payload: { quote_id })
- "quote_followup" : envoyer une relance pour un devis envoyé sans réponse, risque fort (payload: { quote_id, subject?, draft_text? })

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
- Ton "reply" qui accompagne une carte d'action annonce ce qui va être fait ("Voici la fiche prospect prête à créer, validez la carte ci-dessous."), il ne redemande pas l'autorisation. N'écris jamais "Validez-vous", "Confirmez-vous", "Souhaitez-vous que je" ni aucune autre question de permission dans un message qui contient déjà une carte.
- Ne jamais exécuter une action sensible sans avoir proposé une carte d'action et attendu la confirmation (le clic sur la carte).
- Pour un email, utilise uniquement les clients/prospects connus dans le contexte. Ne mets jamais une adresse inventée. Prépare une action "draft_email" avec client_ids ou recipient_filter, subject et body. La confirmation humaine déclenchera l'envoi.
- Ne jamais inventer de données. Si tu ne sais pas, dis-le simplement.
- Dès qu'une question porte sur un client précis et croise plusieurs sujets (factures ET chantiers, ou "la situation de ce client", ou "a-t-il des trucs en cours"), utilise get_client_overview en un seul appel plutôt que d'enchaîner get_chantier_details puis search_documents séparément : c'est plus fiable et ça évite d'oublier un des deux volets. N'affirme rien depuis un simple survol des listes globales du contexte ("Factures en attente de paiement", "Chantiers actifs") : ces listes couvrent toute l'entreprise, pas un client en particulier, et une lecture rapide fait rater une ligne. Une réponse "aucun(e)" doit toujours venir d'un appel d'outil qui confirme l'absence, jamais d'une simple absence de mention dans le contexte général.
- Pour tout comptage ("combien de chantiers en cours", "combien de devis en attente"), utilise get_financial_summary plutôt que de compter les lignes d'une liste du contexte : ces listes sont plafonnées et peuvent ne pas représenter le total réel.
- Ne jamais afficher un statut technique brut du contexte (en_cours, planifie, sent, viewed, draft, overdue...). Traduis-le toujours en français naturel : "en cours", "planifié", "envoyé", "consulté par le client", "brouillon", "en retard". Idem pour tout identifiant ou code interne : ne les montre jamais à l'utilisateur.
- Si tu proposes "brief_chloe", précise que tu transmets le contexte à Chloé qui proposera directement des lignes de devis à valider dans l'éditeur (ce n'est pas encore un devis enregistré). Renseigne une "description" riche des travaux dans le payload, et si possible "items" et "conditions", car Chloé s'en sert pour bâtir sa proposition. Si tu proposes "draft_quote", précise qu'un brouillon de devis sera créé et ouvert après validation.
- Réponses courtes : 1 à 3 phrases pour une question simple, 5 lignes maximum pour un résumé ou une préparation de contenu.
- Si tu détectes des urgences dans le contexte (factures très en retard, tâches échues depuis plusieurs jours, devis expirant demain), signale-les spontanément sans attendre qu'on te pose la question.
- Pour "ce qui a été fait aujourd'hui", utilise d'abord le bloc "Réalisé aujourd'hui", puis complète avec "Planning du jour" si utile. Ne conclus jamais qu'il ne s'est rien passé si des pointages, tâches terminées, notes ou photos existent.
- Pour le planning, distingue bien les créneaux planifiés et les créneaux déjà pointés. Un créneau pointé reste un créneau qui a existé aujourd'hui, il n'est simplement plus une urgence à traiter.
- Pour les entretiens, ne les invente pas : utilise uniquement les contrats/interventions d'entretien présents dans le contexte. Si la demande contient plusieurs entretiens ou une semaine complète, passe par "brief_nora".`

// Filet de sécurité : si le JSON du modèle est tronqué ou illisible, on ne
// montre jamais le fragment brut à l'utilisateur. Si une action valide est
// présente malgré un "reply" manquant, on formule la phrase depuis l'action.
function safeReplyFromRaw(raw: string, action?: unknown): string {
  if (action && typeof action === 'object') {
    const description = (action as Record<string, unknown>).description
    if (typeof description === 'string' && description.trim()) {
      return `Voici ce que je vous propose : ${description.trim()}. Validez la carte ci-dessous pour confirmer.`
    }
  }
  const trimmed = raw.trim()
  if (!trimmed || trimmed.startsWith('{') || trimmed.startsWith('"') || trimmed.startsWith('```')) {
    return "Je n'ai pas réussi à formuler ma réponse correctement. Pouvez-vous reformuler votre demande ?"
  }
  return trimmed
}

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

// Pièces jointes du chat : images et PDF envoyés en data URL, analysés par le
// modèle vision. Taille plafonnée pour protéger la mémoire et le quota IA.
const SARAH_ATTACHMENT_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
const SARAH_ATTACHMENT_MAX_DATAURL = 8_500_000 // ~6 Mo de fichier une fois encodé en base64

type SarahAttachment = { name: string; mimeType: string; dataUrl: string }

function sanitizeSarahAttachment(raw: unknown): SarahAttachment | null {
  if (!raw || typeof raw !== 'object') return null
  const att = raw as Record<string, unknown>
  const mimeType = typeof att.mimeType === 'string' ? att.mimeType.toLowerCase().trim() : ''
  const dataUrl = typeof att.dataUrl === 'string' ? att.dataUrl : ''
  if (!SARAH_ATTACHMENT_MIMES.includes(mimeType)) return null
  if (!dataUrl.startsWith(`data:${mimeType};base64,`)) return null
  if (dataUrl.length > SARAH_ATTACHMENT_MAX_DATAURL) return null
  const name = typeof att.name === 'string' && att.name.trim() ? att.name.trim().slice(0, 120) : 'document'
  return { name, mimeType, dataUrl }
}

export async function POST(req: NextRequest) {
  try {
    const { message, page, pathname, pageContext, history, conversationId: rawConversationId, attachment: rawAttachment } = await req.json()
    const attachment = sanitizeSarahAttachment(rawAttachment)
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

    const [businessCtx, ragContext, dailyBriefResult, incomingBriefsResult] = await Promise.all([
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
      // Messages transmis par les autres assistants (Marco, Chloé, Nora) à Sarah
      isFirstMessage
        ? supabase
            .from('ai_briefs')
            .select('id, source_assistant, payload, created_at')
            .eq('organization_id', orgId)
            .eq('target_assistant', 'sarah')
            .eq('status', 'pending')
            .order('created_at', { ascending: false })
            .limit(5)
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
        .select(`id, reference, status, total_ttc, created_at, valid_until, ${CLIENT_JOIN}`)
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(5),

      // Factures en retard ou en attente
      supabase
        .from('invoices')
        .select(`id, number, status, total_ttc, due_date, ${CLIENT_JOIN}`)
        .eq('organization_id', orgId)
        .in('status', ['sent', 'overdue', 'partial'])
        .order('due_date', { ascending: true })
        .limit(8),

      // Devis qui expirent dans les 3 prochains jours
      supabase
        .from('quotes')
        .select(`id, reference, valid_until, total_ttc, ${CLIENT_JOIN}`)
        .eq('organization_id', orgId)
        .in('status', ['sent', 'viewed'])
        .gte('valid_until', today)
        .lte('valid_until', in3days),

      // Chantiers actifs
      supabase
        .from('chantiers')
        .select(`id, title, status, end_date, ${CLIENT_JOIN}`)
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
        .select('id, planned_date, start_time, end_time, label, team_size, notes, member_id, equipe_id, chantier:chantiers!inner(id, title, organization_id, is_archived, status, client:clients(company_name, first_name, last_name, contact_name, email)), member:chantier_equipe_membres(prenom, name), equipe:chantier_equipes(id, name)')
        .eq('chantier.organization_id', orgId)
        .eq('chantier.is_archived', false)
        .not('chantier.status', 'in', '("termine","annule")')
        .eq('planned_date', today)
        .order('start_time', { ascending: true, nullsFirst: false }),

      supabase
        .from('chantier_pointages')
        .select('id, chantier_planning_id, chantier_id, tache_id, user_id, member_id, date, hours, start_time, description, created_at, profile:profiles(full_name), membre:chantier_equipe_membres(prenom, name), tache:chantier_taches(title), chantier:chantiers!inner(id, title, organization_id, is_archived, status, client:clients(company_name, first_name, last_name, contact_name, email))')
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
        .select('id, content, created_at, author:profiles(full_name), chantier:chantiers!inner(id, title, organization_id, is_archived, status, client:clients(company_name, first_name, last_name, contact_name, email))')
        .eq('chantier.organization_id', orgId)
        .eq('chantier.is_archived', false)
        .gte('created_at', `${today}T00:00:00+02:00`)
        .lt('created_at', `${tomorrow}T00:00:00+02:00`)
        .order('created_at', { ascending: false })
        .limit(20),

      supabase
        .from('chantier_photos')
        .select('id, title, caption, taken_at, created_at, uploader:profiles(full_name), tache:chantier_taches(title), chantier:chantiers!inner(id, title, organization_id, is_archived, status, client:clients(company_name, first_name, last_name, contact_name, email))')
        .eq('chantier.organization_id', orgId)
        .eq('chantier.is_archived', false)
        .gte('created_at', `${today}T00:00:00+02:00`)
        .lt('created_at', `${tomorrow}T00:00:00+02:00`)
        .order('created_at', { ascending: false })
        .limit(20),

      // Planning des 7 prochains jours (hors aujourd'hui)
      supabase
        .from('chantier_plannings')
        .select('id, planned_date, start_time, end_time, label, team_size, notes, member_id, equipe_id, chantier:chantiers!inner(id, title, organization_id, is_archived, status, client:clients(company_name, first_name, last_name, contact_name, email)), member:chantier_equipe_membres(prenom, name), equipe:chantier_equipes(id, name)')
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
        .select(`id, number, title, status, total_ttc, total_paid, issue_date, due_date, ${CLIENT_JOIN}`)
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

    // Normalisation : résoudre client_name depuis la relation clients, en
    // direct (quotes, invoices, chantiers) comme via un join chantier imbriqué.
    for (const row of [
      ...(recentQuotes ?? []), ...(overdueInvoices ?? []), ...(expiringQuotes ?? []),
      ...(activeChantiers ?? []), ...(recentInvoices ?? []),
    ]) {
      ;(row as any).client_name = clientNameFromJoin((row as any).client)
    }
    for (const row of [
      ...(todayPlanning ?? []), ...(weekPlanning ?? []), ...(todayPointages ?? []),
      ...(todayNotes ?? []), ...(todayPhotos ?? []), ...(lateTasks ?? []),
    ]) {
      const chantier = Array.isArray((row as any).chantier) ? (row as any).chantier[0] : (row as any).chantier
      if (chantier && chantier.client_name === undefined) {
        chantier.client_name = clientNameFromJoin(chantier.client)
      }
    }

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
        contextLines.push(`  ${q.reference} - ${(q as any).client_name ?? '?'} - expire le ${q.valid_until} - ${fmt(q.total_ttc)}`)
      }
    }

    // Factures en attente ou en retard
    if (overdueInvoices?.length) {
      contextLines.push('', 'Factures en attente de paiement :')
      for (const inv of overdueInvoices) {
        const retard = inv.due_date && inv.due_date < today ? ` (EN RETARD depuis le ${inv.due_date})` : ` (échéance ${inv.due_date ?? 'non définie'})`
        contextLines.push(`  [${inv.id}] ${inv.number} - ${(inv as any).client_name ?? '?'} - ${fmt(inv.total_ttc)}${retard}`)
      }
    }

    if (recentInvoices?.length) {
      contextLines.push('', 'Dernières factures :')
      for (const inv of recentInvoices) {
        const paid = inv.total_paid != null && inv.total_paid > 0 ? `, encaissé ${fmt(inv.total_paid)}` : ''
        contextLines.push(`  [${inv.id}] ${inv.number ?? inv.title ?? 'Facture'} - ${(inv as any).client_name ?? '?'} - ${inv.status} - ${fmt(inv.total_ttc)}${paid} - échéance ${inv.due_date ?? 'n/a'}`)
      }
    }

    // Derniers devis
    if (recentQuotes?.length) {
      contextLines.push('', 'Devis récents :')
      for (const q of recentQuotes) {
        contextLines.push(`  [${q.id}] ${q.reference} - ${(q as any).client_name ?? '?'} - ${q.status} - ${fmt(q.total_ttc)}`)
      }
    }

    // Chantiers actifs
    if (activeChantiers?.length) {
      contextLines.push('', 'Chantiers actifs (utilisez ces IDs pour les actions planning) :')
      for (const c of activeChantiers) {
        contextLines.push(`  [CHANTIER:${c.id}] ${c.title} - ${(c as any).client_name ?? ''} - fin prévue : ${c.end_date ?? 'non définie'}`)
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

    // Messages des autres assistants adressés à Sarah — injectés puis marqués consommés
    const incomingBriefs = ((incomingBriefsResult as any)?.data ?? []) as Array<{ id: string; source_assistant: string; payload: Record<string, unknown>; created_at: string }>
    if (incomingBriefs.length > 0) {
      const SOURCE_NAMES: Record<string, string> = { marco: 'Marco (chef de chantier)', chloe: 'Chloé (devis)', nora: 'Nora (planning)' }
      contextLines.push('', 'Messages des autres assistants (à mentionner à l\'utilisateur) :')
      for (const brief of incomingBriefs) {
        const from = SOURCE_NAMES[brief.source_assistant] ?? brief.source_assistant
        const description = typeof brief.payload?.description === 'string' ? brief.payload.description : JSON.stringify(brief.payload)
        contextLines.push(`  De ${from}, le ${String(brief.created_at).slice(0, 10)} : ${description}`)
      }
      void (async () => {
        try {
          await supabase
            .from('ai_briefs')
            .update({ status: 'consumed', consumed_at: new Date().toISOString() })
            .in('id', incomingBriefs.map(b => b.id))
            .eq('organization_id', orgId)
        } catch { /* non bloquant */ }
      })()
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

    // Message utilisateur : texte seul, ou multimodal si une pièce jointe est fournie.
    const userMessageContent: string | Array<Record<string, unknown>> = attachment
      ? [
          { type: 'text', text: `${message}\n\n(Pièce jointe fournie : ${attachment.name})` },
          { type: 'image_url', image_url: { url: attachment.dataUrl } },
        ]
      : message

    const apiMessages: Array<{ role: string; content: string | Array<Record<string, unknown>> }> = [
      { role: 'system', content: `${SYSTEM_PROMPT}\n\n---\nCONTEXTE ATELIER (mis à jour à chaque message) :\n${userContext}` },
      ...conversationHistory.slice(0, -1).map(h => ({
        role: h.role === 'user' ? 'user' : 'assistant',
        content: h.content,
      })),
      { role: 'user', content: userMessageContent },
    ]

    // Boucle d'outils bornée : un seul aller-retour ne permettait pas à Sarah de
    // se rattraper si un premier appel d'outil renvoyait un résultat vide ou
    // insuffisant (ex: chercher un chantier par nom de client puis devoir
    // enchaîner sur search_documents). On garde les tools disponibles sur
    // chaque tour, jusqu'à 3 tours d'appels d'outils avant de forcer le JSON final.
    const loopMessages: Array<{ role: string; content?: string | Array<Record<string, unknown>>; tool_calls?: unknown; tool_call_id?: string }> = [...apiMessages]
    let assistantMsg: { content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } | undefined
    const MAX_TOOL_ROUNDS = 3

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const isLastAllowedRound = round === MAX_TOOL_ROUNDS
      const result = await callAI<any>({
        organizationId: orgId,
        provider: 'openrouter',
        feature: 'sarah_assistant',
        model: MODEL,
        inputKind: attachment && round === 0 ? 'mixed' : 'text',
        request: {
          body: {
            messages: loopMessages,
            // Sur le dernier tour autorisé, on retire les tools pour forcer une
            // réponse JSON finale plutôt qu'un nouvel appel d'outil.
            ...(isLastAllowedRound ? {} : { tools: SARAH_TOOLS, tool_choice: 'auto' }),
            temperature: 0.3,
            // Gemini 2.5 Flash consomme des tokens de raisonnement sur ce budget :
            // trop bas, la réponse JSON arrive tronquée en plein milieu.
            max_tokens: round === 0 ? 1600 : 1400,
            ...(isLastAllowedRound ? { response_format: { type: 'json_object' } } : {}),
          },
        },
      })

      const responseData = result.data as { choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }> }
      assistantMsg = responseData?.choices?.[0]?.message

      if (!assistantMsg?.tool_calls?.length || isLastAllowedRound) break

      loopMessages.push(assistantMsg as any)
      for (const tc of assistantMsg.tool_calls) {
        let args: Record<string, unknown> = {}
        try { args = JSON.parse(tc.function.arguments) } catch { /* ignore */ }
        const toolResult = await executeSarahTool(tc.function.name, args, orgId, memorySavedThisConversation, conversationId)
        if (process.env.NODE_ENV !== 'production') {
          console.log(`[sarah tool] round ${round} ${tc.function.name}(${tc.function.arguments}) -> ${toolResult.slice(0, 200)}`)
        }
        loopMessages.push({ role: 'tool', tool_call_id: tc.id, content: toolResult })
      }
    }

    // Si le dernier tour a encore renvoyé des tool_calls (JSON forcé sans tools,
    // ne devrait pas arriver mais on protège contre un contenu vide).
    if (assistantMsg?.tool_calls?.length && !assistantMsg?.content) {
      const parsed2 = { reply: "Je n'ai pas réussi à formuler ma réponse correctement. Pouvez-vous reformuler votre demande ?" }
      return NextResponse.json(parsed2)
    }

    if (loopMessages.length > apiMessages.length) {
      const content2 = assistantMsg?.content ?? ''
      const raw2 = extractJson(content2)
      let parsed2: { reply: string; action?: unknown }
      try { parsed2 = JSON.parse(raw2) } catch { parsed2 = { reply: safeReplyFromRaw(raw2) } }
      if (typeof parsed2.reply !== 'string' || !parsed2.reply) {
        parsed2.reply = safeReplyFromRaw(raw2, parsed2.action)
      }

      parsed2.action = await attachPersistentProposal(orgId, user?.id ?? null, conversationId, parsed2.action)
      return NextResponse.json(parsed2)
    }

    // Pas de tool call — réponse directe JSON
    const rawContent = assistantMsg?.content ?? ''
    const raw = extractJson(rawContent)
    let parsed: { reply: string; action?: unknown }
    try { parsed = JSON.parse(raw) } catch { parsed = { reply: safeReplyFromRaw(raw) } }
    if (typeof parsed.reply !== 'string' || !parsed.reply) {
      parsed.reply = safeReplyFromRaw(raw, parsed.action)
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
