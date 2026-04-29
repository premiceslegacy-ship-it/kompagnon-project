import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { getChantierById, getChantierTaches, getChantierPointages, getChantierNotes, getChantierEquipes, getChantierPlannings, type ChantierPlanning, type Equipe } from '@/lib/data/queries/chantiers'
import { getChantierProfitability } from '@/lib/data/queries/chantier-profitability'
import { createPointage, createChantierNote, updateTache } from '@/lib/data/mutations/chantiers'
import { createChantierExpense } from '@/lib/data/mutations/chantier-expenses'
import { createPlanningSlot, deletePlanningSlot } from '@/lib/data/mutations/planning'
import { getChantierIndividualMembers } from '@/lib/data/queries/members'
import { AIModuleDisabledError, AIRateLimitError, callAI } from '@/lib/ai/callAI'
import { getBusinessContext, formatBusinessContextForPrompt } from '@/lib/ai/business-context'
import { todayParis } from '@/lib/utils'

const MODEL = 'anthropic/claude-haiku-4-5'

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_members',
      description: 'Lister les membres et équipes assignés à ce chantier. À appeler avant add_pointage si l\'utilisateur mentionne un nom de personne.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_pointage',
      description: 'Enregistrer des heures de travail (pointage) sur ce chantier. Si l\'utilisateur mentionne un nom de personne, utilise member_name pour pointer pour ce membre spécifique. Sans member_name, pointe pour l\'utilisateur connecté.',
      parameters: {
        type: 'object',
        properties: {
          hours: { type: 'number', description: 'Nombre d\'heures travaillées (ex: 3.5)' },
          date: { type: 'string', description: 'Date du pointage au format YYYY-MM-DD. Si absent, utilise aujourd\'hui.' },
          description: { type: 'string', description: 'Description optionnelle du travail effectué.' },
          member_name: { type: 'string', description: 'Prénom ou nom du membre pour lequel pointer les heures. Laisser vide pour pointer pour soi-même.' },
        },
        required: ['hours'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_expense',
      description: 'Enregistrer une dépense sur ce chantier (matériel, sous-traitance, location, transport, autre).',
      parameters: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'Description de la dépense (ex: "Placo BA13 - 50 plaques")' },
          amount_ht: { type: 'number', description: 'Montant HT en euros' },
          category: {
            type: 'string',
            enum: ['materiel', 'sous_traitance', 'location', 'transport', 'autre'],
            description: 'Catégorie de la dépense',
          },
          supplier_name: { type: 'string', description: 'Nom du fournisseur (optionnel)' },
          date: { type: 'string', description: 'Date de la dépense au format YYYY-MM-DD. Si absent, utilise aujourd\'hui.' },
        },
        required: ['label', 'amount_ht', 'category'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_note',
      description: 'Ajouter une note de suivi sur ce chantier.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Contenu de la note' },
        },
        required: ['content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_task_status',
      description: 'Modifier le statut d\'une tâche du chantier.',
      parameters: {
        type: 'object',
        properties: {
          task_title_query: { type: 'string', description: 'Nom ou partie du nom de la tâche à modifier' },
          status: {
            type: 'string',
            enum: ['a_faire', 'en_cours', 'termine'],
            description: 'Nouveau statut',
          },
        },
        required: ['task_title_query', 'status'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_planning_slot',
      description: 'Créer un créneau de planification pour ce chantier. Utiliser pour planifier des journées ou demi-journées de travail avec une équipe ou un membre.',
      parameters: {
        type: 'object',
        properties: {
          planned_date: { type: 'string', description: 'Date du créneau au format YYYY-MM-DD' },
          label: { type: 'string', description: 'Libellé du créneau (ex: "Équipe maçonnerie", "Jean - pose carrelage")' },
          start_time: { type: 'string', description: 'Heure de début au format HH:MM (ex: "08:00"). Optionnel.' },
          end_time: { type: 'string', description: 'Heure de fin au format HH:MM (ex: "17:00"). Optionnel.' },
          team_size: { type: 'number', description: 'Nombre de personnes. Par défaut 1.' },
          notes: { type: 'string', description: 'Notes additionnelles sur le créneau. Optionnel.' },
          member_name: { type: 'string', description: 'Prénom ou nom du membre individuel à assigner. Si non trouvé, le label sera utilisé seul. Optionnel.' },
        },
        required: ['planned_date', 'label'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_planning_slot',
      description: 'Supprimer un créneau de planning existant de ce chantier. À utiliser seulement si l’utilisateur demande explicitement de supprimer/retirer/annuler un créneau.',
      parameters: {
        type: 'object',
        properties: {
          planning_slot_id: { type: 'string', description: 'ID exact du créneau à supprimer, choisi dans la liste des créneaux existants du contexte.' },
        },
        required: ['planning_slot_id'],
      },
    },
  },
]

// ─── Tool execution ────────────────────────────────────────────────────────────

type IndividualMember = { id: string; name: string; prenom: string | null; role_label: string | null }

function findMemberByName(
  query: string,
  individualMembers: IndividualMember[],
  equipes: Equipe[],
): { memberId?: string; equipeId?: string; displayName: string } | null {
  const q = query.toLowerCase().trim()
  // Cherche dans les membres individuels du chantier
  for (const m of individualMembers) {
    const fullName = `${m.prenom ?? ''} ${m.name}`.toLowerCase().trim()
    if (fullName.includes(q) || q.includes(m.name.toLowerCase()) || (m.prenom && q.includes(m.prenom.toLowerCase()))) {
      return { memberId: m.id, displayName: `${m.prenom ?? ''} ${m.name}`.trim() }
    }
  }
  // Cherche dans les membres des équipes (EquipeMembre n'a pas prenom, match sur name)
  for (const eq of equipes) {
    for (const m of eq.membres) {
      if (m.name.toLowerCase().includes(q) || q.includes(m.name.toLowerCase())) {
        return { memberId: m.id, displayName: m.name }
      }
    }
    // Cherche aussi par nom d'équipe
    if (eq.name.toLowerCase().includes(q)) {
      return { equipeId: eq.id, displayName: eq.name }
    }
  }
  return null
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  chantierId: string,
  taches: Awaited<ReturnType<typeof getChantierTaches>>,
  individualMembers: IndividualMember[],
  equipes: Awaited<ReturnType<typeof getChantierEquipes>>,
  plannings: ChantierPlanning[],
  today: string,
): Promise<string> {
  if (name === 'list_members') {
    const lines: string[] = []
    if (individualMembers.length > 0) {
      lines.push('Membres individuels :')
      for (const m of individualMembers) {
        lines.push(`  - ${m.prenom ?? ''} ${m.name}${m.role_label ? ` (${m.role_label})` : ''}`.trim())
      }
    }
    if (equipes.length > 0) {
      lines.push('Équipes :')
      for (const eq of equipes) {
        const membresStr = eq.membres.map(m => m.name).join(', ')
        lines.push(`  - ${eq.name}${membresStr ? ` : ${membresStr}` : ''}`)
      }
    }
    if (lines.length === 0) return 'Aucun membre ni équipe assigné à ce chantier.'
    return lines.join('\n')
  }

  if (name === 'add_pointage') {
    const hours = args.hours as number
    const date = (args.date as string | undefined) ?? today
    const description = (args.description as string | undefined) ?? null
    const memberNameQuery = args.member_name as string | undefined

    if (memberNameQuery) {
      const found = findMemberByName(memberNameQuery, individualMembers, equipes)
      if (!found || !found.memberId) {
        return `Membre "${memberNameQuery}" non trouvé sur ce chantier. Utilise list_members pour voir les membres disponibles.`
      }
      // Pointage direct en DB pour ce member_id (sans user_id)
      const supabase = await createClient()
      const { error } = await supabase.from('chantier_pointages').insert({
        chantier_id: chantierId,
        member_id: found.memberId,
        date,
        hours,
        description,
      })
      if (error) return `Erreur : ${error.message}`
      return `Pointage de ${hours}h enregistré pour ${found.displayName} le ${date}.`
    }

    const result = await createPointage(chantierId, { hours, date, description })
    if (result.error) return `Erreur : ${result.error}`
    return `Pointage de ${hours}h enregistré pour le ${date}.`
  }

  if (name === 'add_expense') {
    const result = await createChantierExpense({
      chantierId,
      category: args.category as 'materiel' | 'sous_traitance' | 'location' | 'transport' | 'autre',
      label: args.label as string,
      amountHt: args.amount_ht as number,
      supplierName: (args.supplier_name as string | undefined) ?? null,
      expenseDate: (args.date as string | undefined) ?? today,
    })
    if (result.error) return `Erreur : ${result.error}`
    return `Dépense "${args.label}" de ${args.amount_ht}€ HT enregistrée.`
  }

  if (name === 'add_note') {
    const result = await createChantierNote(chantierId, args.content as string)
    if (result.error) return `Erreur : ${result.error}`
    return `Note ajoutée avec succès.`
  }

  if (name === 'update_task_status') {
    const query = (args.task_title_query as string).toLowerCase()
    const tache = taches.find(t => t.title.toLowerCase().includes(query))
    if (!tache) return `Aucune tâche trouvée correspondant à "${args.task_title_query}".`
    const result = await updateTache(tache.id, chantierId, { status: args.status as 'a_faire' | 'en_cours' | 'termine' })
    if (result.error) return `Erreur : ${result.error}`
    return `Tâche "${tache.title}" mise à jour : statut = ${args.status}.`
  }

  if (name === 'add_planning_slot') {
    const plannedDate = args.planned_date as string
    const label = args.label as string
    const memberNameQuery = args.member_name as string | undefined

    let memberId: string | null = null
    let equipeId: string | null = null

    if (memberNameQuery) {
      const found = findMemberByName(memberNameQuery, individualMembers, equipes)
      if (found) {
        memberId = found.memberId ?? null
        equipeId = found.equipeId ?? null
      }
    }

    const result = await createPlanningSlot({
      chantierId,
      plannedDate,
      label,
      startTime: (args.start_time as string | undefined) ?? null,
      endTime: (args.end_time as string | undefined) ?? null,
      teamSize: (args.team_size as number | undefined) ?? 1,
      notes: (args.notes as string | undefined) ?? null,
      memberId,
      equipeId,
    })
    if (result.error) return `Erreur : ${result.error}`
    const who = memberId || equipeId ? ` pour ${memberNameQuery}` : ''
    return `Créneau "${label}" créé le ${plannedDate}${who}.`
  }

  if (name === 'delete_planning_slot') {
    const planningSlotId = args.planning_slot_id as string | undefined
    const planning = plannings.find(p => p.id === planningSlotId)
    if (!planningSlotId || !planning) {
      return 'Créneau introuvable sur ce chantier. Vérifie la liste des créneaux disponibles avant de supprimer.'
    }

    const result = await deletePlanningSlot(planningSlotId)
    if (result.error) return `Erreur : ${result.error}`
    const time = planning.start_time ? ` à ${planning.start_time}${planning.end_time ? `-${planning.end_time}` : ''}` : ''
    return `Créneau "${planning.label}" supprimé le ${planning.planned_date}${time}.`
  }

  return `Outil "${name}" non reconnu.`
}

// ─── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return NextResponse.json({ error: 'Organisation introuvable' }, { status: 403 })

  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json({ error: 'Clé API IA non configurée' }, { status: 500 })
  }

  const body = await req.json()
  const chantierId: string = body.chantierId
  const messages: Array<{ role: string; content: string }> = body.messages ?? []

  if (!chantierId) return NextResponse.json({ error: 'chantierId manquant' }, { status: 400 })
  if (messages.length === 0) return NextResponse.json({ error: 'Messages vides' }, { status: 400 })

  // Charger le contexte complet du chantier
  const [chantier, taches, pointages, notes, profitability, individualMembers, equipes, plannings, businessCtx] = await Promise.all([
    getChantierById(chantierId),
    getChantierTaches(chantierId),
    getChantierPointages(chantierId),
    getChantierNotes(chantierId),
    getChantierProfitability(chantierId),
    getChantierIndividualMembers(chantierId),
    getChantierEquipes(chantierId),
    getChantierPlannings(chantierId),
    getBusinessContext(orgId),
  ])

  if (!chantier) return NextResponse.json({ error: 'Chantier introuvable' }, { status: 404 })

  const today = todayParis()
  const tachesDone = taches.filter(t => t.status === 'termine').length
  const avancementPct = taches.length > 0 ? Math.round((tachesDone / taches.length) * 100) : 0
  const lastNote = notes[0]?.content ?? 'aucune'
  const recentPointages = pointages.slice(0, 5).map(p => `${p.date}: ${p.hours}h${p.description ? ` (${p.description})` : ''}`)

  const membresIndivStr = individualMembers.length > 0
    ? individualMembers.map(m => `${m.prenom ?? ''} ${m.name}`.trim()).join(', ')
    : 'aucun'
  const equipesStr = equipes.length > 0
    ? equipes.map(eq => {
        const membresEq = (eq.membres ?? []).map(m => m.name).join(', ')
        return `${eq.name}${membresEq ? ` (${membresEq})` : ''}`
      }).join(' | ')
    : 'aucune'
  const planningsStr = plannings.length > 0
    ? plannings.map(p => `ID ${p.id} : ${p.planned_date} ${p.start_time ?? 'sans heure'}${p.end_time ? `-${p.end_time}` : ''}, ${p.label}, ${p.team_size} pers.${p.notes ? `, notes: ${p.notes}` : ''}`).join(' | ')
    : 'aucun'

  const systemPrompt = `Tu es l'assistant IA de ce chantier dans l'application ATELIER by Orsayn.

${formatBusinessContextForPrompt(businessCtx)}

Chantier : ${chantier.title}
Statut : ${chantier.status}
Budget HT : ${chantier.budget_ht ? chantier.budget_ht + '€' : 'non défini'}
Avancement tâches : ${tachesDone}/${taches.length} (${avancementPct}%)
Heures pointées : ${profitability?.hoursLogged ?? 0}h
Coût total : ${profitability ? Math.round(profitability.costTotal) + '€' : 'N/A'}
Coût main-d'œuvre : ${profitability ? Math.round(profitability.costLabor) + '€' : 'N/A'}
Coût matériel : ${profitability ? Math.round(profitability.costMaterial) + '€' : 'N/A'}
CA facturé : ${profitability ? Math.round(profitability.revenueHt) + '€' : 'N/A'}
Marge : ${profitability ? Math.round(profitability.marginEur) + '€ (' + Math.round(profitability.marginPct * 100) + '%)' : 'N/A'}
Dernière note : ${lastNote}
Pointages récents : ${recentPointages.length > 0 ? recentPointages.join(' | ') : 'aucun'}
Tâches : ${taches.map(t => `"${t.title}" [${t.status}]`).join(', ') || 'aucune'}
Membres individuels du chantier : ${membresIndivStr}
Équipes du chantier : ${equipesStr}
Créneaux planning existants : ${planningsStr}
Date du jour : ${today}

Instructions :
- Réponds toujours en français, ton professionnel mais direct
- Si la marge est < 10%, alerte l'utilisateur
- Si le coût dépasse 90% du budget, alerte l'utilisateur
- Tu peux ajouter des pointages (pour toi ou pour un membre nommé), des dépenses, des notes, mettre à jour des tâches, et créer des créneaux de planning via les outils disponibles
- Tu peux aussi supprimer un créneau existant via delete_planning_slot si l'utilisateur le demande explicitement
- Pour pointer les heures d'un membre spécifique, utilise add_pointage avec member_name
- Pour créer un planning, utilise add_planning_slot avec la date, le label, et optionnellement les horaires
- Si tu ne connais pas les membres du chantier, appelle d'abord list_members
- Pas de formules creuses, chiffre tout ce qui peut l'être
- Aucun emoji, aucun symbole décoratif
- Aucun tiret cadratin (—) : utilise des virgules ou des points à la place`

  const apiMessages = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ]

  try {
    // Premier appel IA
    const { data } = await callAI<any>({
      organizationId: orgId,
      provider: 'openrouter',
      feature: 'chantier_assistant',
      model: MODEL,
      inputKind: 'text',
      request: {
        body: {
          messages: apiMessages,
          tools: TOOLS,
          tool_choice: 'auto',
          max_tokens: 600,
        },
      },
      metadata: { route: 'api/ai/chantier-assistant', chantier_id: chantierId },
    })

    const choice = data.choices?.[0]
    const assistantMsg = choice?.message

    // Si l'IA appelle des tools, les exécuter
    if (assistantMsg?.tool_calls && assistantMsg.tool_calls.length > 0) {
      const toolResults: Array<{ role: string; tool_call_id: string; content: string }> = []

      for (const tc of assistantMsg.tool_calls) {
        let args: Record<string, unknown> = {}
        try { args = JSON.parse(tc.function.arguments) } catch { /* ignore */ }
        const result = await executeTool(tc.function.name, args, chantierId, taches, individualMembers as IndividualMember[], equipes, plannings, today)
        toolResults.push({ role: 'tool', tool_call_id: tc.id, content: result })
      }

      // Deuxième appel avec les résultats des tools
      const { data: data2 } = await callAI<any>({
        organizationId: orgId,
        provider: 'openrouter',
        feature: 'chantier_assistant',
        model: MODEL,
        inputKind: 'text',
        request: {
          body: {
            messages: [
              ...apiMessages,
              assistantMsg,
              ...toolResults,
            ],
            max_tokens: 400,
          },
        },
        metadata: { route: 'api/ai/chantier-assistant', chantier_id: chantierId, step: 'tool_result' },
      })

      const finalContent = data2.choices?.[0]?.message?.content?.trim() ?? 'Fait.'
      const toolSummary = toolResults.map(r => r.content).join('\n')
      const planningChanged = assistantMsg.tool_calls.some((tc: { function: { name: string } }) => ['add_planning_slot', 'delete_planning_slot'].includes(tc.function.name))
      return NextResponse.json({ reply: finalContent, toolsExecuted: toolSummary, planningCreated: planningChanged })
    }

    const reply = assistantMsg?.content?.trim() ?? 'Je n\'ai pas pu générer de réponse.'
    return NextResponse.json({ reply, toolsExecuted: null })
  } catch (err) {
    if (err instanceof AIModuleDisabledError) {
      return NextResponse.json({ error: 'Module IA planning désactivé.' }, { status: 403 })
    }
    if (err instanceof AIRateLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 })
    }
    console.error('[chantier-assistant]', err)
    return NextResponse.json({ error: 'Erreur IA, veuillez réessayer.' }, { status: 500 })
  }
}
