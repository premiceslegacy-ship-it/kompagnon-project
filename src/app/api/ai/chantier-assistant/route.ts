import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { getChantierById, getChantierTaches, getChantierPointages, getChantierNotes, getChantierEquipes, getChantierPlannings, getEquipes, type ChantierPlanning, type Equipe } from '@/lib/data/queries/chantiers'
import { getChantierProfitability } from '@/lib/data/queries/chantier-profitability'
import { createPointage, createChantierNote, updateTache } from '@/lib/data/mutations/chantiers'
import { createChantierExpense } from '@/lib/data/mutations/chantier-expenses'
import { createPlanningSlot, deletePlanningSlot } from '@/lib/data/mutations/planning'
import { createIndividualMember } from '@/lib/data/mutations/members'
import { getChantierIndividualMembers, getOrgIndividualMembers, type IndividualMember } from '@/lib/data/queries/members'
import { getTeamMembers, type TeamMember } from '@/lib/data/queries/team'
import { AIModuleDisabledError, AIRateLimitError, callAI } from '@/lib/ai/callAI'
import { AIQuotaExceededError } from '@/lib/quota'
import { getBusinessContext, formatBusinessContextForPrompt } from '@/lib/ai/business-context'
import { hasPermission } from '@/lib/data/queries/membership'
import { todayParis } from '@/lib/utils'

const MODEL = 'anthropic/claude-haiku-4-5'

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_members',
      description: 'Lister les membres et équipes connus de l\'organisation et ceux assignés à ce chantier. À appeler avant add_pointage si l\'utilisateur mentionne un nom de personne ou d\'équipe.',
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
      description: 'Enregistrer des heures de travail (pointage) sur ce chantier. Si l\'utilisateur mentionne une personne ou une équipe, utilise member_name. Pour une équipe, les heures sont pointées pour chaque membre de l\'équipe, avec le taux horaire propre à chacun. Sans member_name, pointe pour l\'utilisateur connecté.',
      parameters: {
        type: 'object',
        properties: {
          hours: { type: 'number', description: 'Nombre d\'heures travaillées (ex: 3.5)' },
          date: { type: 'string', description: 'Date du pointage au format YYYY-MM-DD. Si absent, utilise aujourd\'hui.' },
          description: { type: 'string', description: 'Description optionnelle du travail effectué.' },
          member_name: { type: 'string', description: 'Prénom, nom, initiale du nom de famille, nom complet, ou nom d\'équipe. Laisser vide pour pointer pour soi-même.' },
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
          member_name: { type: 'string', description: 'Prénom, nom, initiale du nom de famille, nom complet, ou nom d\'équipe à assigner. Si ambigu ou non trouvé, le label sera utilisé seul. Optionnel.' },
        },
        required: ['planned_date', 'label'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_planning_slot',
      description: 'Supprimer un créneau de planning existant de ce chantier. À utiliser seulement si l\'utilisateur demande explicitement de supprimer/retirer/annuler un créneau.',
      parameters: {
        type: 'object',
        properties: {
          planning_slot_id: { type: 'string', description: 'ID exact du créneau à supprimer, choisi dans la liste des créneaux existants du contexte.' },
        },
        required: ['planning_slot_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_member',
      description: 'Créer un nouveau membre dans l\'organisation après confirmation de l\'utilisateur. À utiliser uniquement si l\'utilisateur confirme qu\'il s\'agit d\'un nouveau membre (pas dans la liste). Ne pas appeler sans accord explicite.',
      parameters: {
        type: 'object',
        properties: {
          prenom: { type: 'string', description: 'Prénom du membre.' },
          name: { type: 'string', description: 'Nom de famille du membre.' },
          email: { type: 'string', description: 'Adresse email du membre (optionnelle).' },
          taux_horaire: { type: 'number', description: 'Taux horaire en €/h (optionnel).' },
          role_label: { type: 'string', description: 'Intitulé du rôle ou métier (optionnel, ex: Maçon, Chef de chantier).' },
        },
        required: ['name'],
      },
    },
  },
]

// ─── Tool execution ────────────────────────────────────────────────────────────

type KnownPerson = {
  id: string
  kind: 'member' | 'user'
  displayName: string
  firstName: string | null
  lastName: string | null
  roleLabel: string | null
  source: string
  profileId?: string | null
  tauxHoraire?: number | null
}

type AssigneeResolution =
  | { status: 'found'; memberId?: string; userId?: string; equipeId?: string; displayName: string; equipe?: Equipe }
  | { status: 'ambiguous'; message: string }
  | { status: 'not_found'; message: string }

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function initials(name: string): string {
  return normalizeName(name)
    .split(' ')
    .filter(Boolean)
    .map(part => part[0])
    .join('')
}

function splitDisplayName(displayName: string, explicitFirstName?: string | null, explicitLastName?: string | null) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean)
  return {
    firstName: explicitFirstName?.trim() || parts[0] || null,
    lastName: explicitLastName?.trim() || (parts.length > 1 ? parts[parts.length - 1] : null),
  }
}

function fullMemberName(member: { prenom?: string | null; name: string }) {
  return [member.prenom, member.name].filter(Boolean).join(' ').trim() || member.name
}

function personLabel(person: KnownPerson) {
  const suffixes = [person.roleLabel, person.source].filter(Boolean)
  return `${person.displayName}${suffixes.length > 0 ? ` (${suffixes.join(', ')})` : ''}`
}

function uniqById<T extends { id: string; kind?: string }>(items: T[]) {
  const seen = new Set<string>()
  return items.filter(item => {
    const key = `${item.kind ?? 'item'}:${item.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function buildKnownPeople(input: {
  chantierIndividualMembers: IndividualMember[]
  orgIndividualMembers: IndividualMember[]
  chantierEquipes: Equipe[]
  allEquipes: Equipe[]
  teamMembers: TeamMember[]
}): KnownPerson[] {
  const people: KnownPerson[] = []

  for (const member of input.chantierIndividualMembers) {
    const displayName = fullMemberName(member)
    people.push({
      id: member.id,
      kind: 'member',
      displayName,
      ...splitDisplayName(displayName, member.prenom, member.name),
      roleLabel: member.role_label,
      source: 'membre du chantier',
      profileId: member.profile_id,
      tauxHoraire: member.taux_horaire,
    })
  }

  for (const equipe of input.chantierEquipes) {
    for (const member of equipe.membres) {
      const displayName = fullMemberName(member)
      people.push({
        id: member.id,
        kind: 'member',
        displayName,
        ...splitDisplayName(displayName, member.prenom, member.name),
        roleLabel: member.role_label,
        source: `équipe du chantier ${equipe.name}`,
        profileId: member.profile_id,
        tauxHoraire: member.taux_horaire,
      })
    }
  }

  for (const member of input.orgIndividualMembers) {
    const displayName = fullMemberName(member)
    people.push({
      id: member.id,
      kind: 'member',
      displayName,
      ...splitDisplayName(displayName, member.prenom, member.name),
      roleLabel: member.role_label,
      source: 'membre organisation',
      profileId: member.profile_id,
      tauxHoraire: member.taux_horaire,
    })
  }

  for (const equipe of input.allEquipes) {
    for (const member of equipe.membres) {
      const displayName = fullMemberName(member)
      people.push({
        id: member.id,
        kind: 'member',
        displayName,
        ...splitDisplayName(displayName, member.prenom, member.name),
        roleLabel: member.role_label,
        source: `équipe organisation ${equipe.name}`,
        profileId: member.profile_id,
        tauxHoraire: member.taux_horaire,
      })
    }
  }

  const profileIdsAlreadyKnown = new Set(people.map(person => person.profileId).filter(Boolean))
  for (const member of input.teamMembers) {
    if (profileIdsAlreadyKnown.has(member.user_id)) continue
    const displayName = member.full_name?.trim() || member.email
    const { firstName, lastName } = splitDisplayName(displayName)
    people.push({
      id: member.user_id,
      kind: 'user',
      displayName,
      firstName,
      lastName,
      roleLabel: member.job_title ?? member.role_name ?? null,
      source: 'membre app organisation',
      tauxHoraire: member.labor_cost_per_hour ?? null,
    })
  }

  return uniqById(people)
}

function scorePersonMatch(query: string, person: KnownPerson): number {
  const q = normalizeName(query)
  if (!q) return 0

  const full = normalizeName(person.displayName)
  const first = person.firstName ? normalizeName(person.firstName) : ''
  const last = person.lastName ? normalizeName(person.lastName) : ''
  const fullInitials = initials(person.displayName)
  const queryParts = q.split(' ').filter(Boolean)

  if (q === full) return 100
  if (full.startsWith(`${q} `)) return 95
  if (queryParts.length >= 2 && first && last) {
    const [qFirst, qLast] = queryParts
    if (first === qFirst && (last === qLast || last.startsWith(qLast))) return 92
  }
  if (q === fullInitials) return 88
  if (first && q === first) return 80
  if (first && last && q === `${first} ${last[0]}`) return 78
  if (last && q === last) return 60
  if (full.includes(q)) return 50
  if (q.includes(full)) return 45
  return 0
}

function scoreEquipeMatch(query: string, equipe: Equipe): number {
  const q = normalizeName(query)
  const name = normalizeName(equipe.name)
  if (!q) return 0
  if (q === name) return 100
  if (name.startsWith(q)) return 92
  if (name.includes(q)) return 70
  return 0
}

function resolveAssigneeByName(query: string, people: KnownPerson[], equipes: Equipe[]): AssigneeResolution {
  const personMatches = people
    .map(person => ({ person, score: scorePersonMatch(query, person) }))
    .filter(match => match.score > 0)
    .sort((a, b) => b.score - a.score)

  const equipeMatches = uniqById(equipes)
    .map(equipe => ({ equipe, score: scoreEquipeMatch(query, equipe) }))
    .filter(match => match.score > 0)
    .sort((a, b) => b.score - a.score)

  const q = normalizeName(query)
  const queryParts = q.split(' ').filter(Boolean)
  if (queryParts.length === 1) {
    const sameFirstName = personMatches.filter(({ person }) => {
      const first = person.firstName ? normalizeName(person.firstName) : ''
      return first === q
    })
    if (sameFirstName.length > 1) {
      return {
        status: 'ambiguous',
        message: `Plusieurs personnes s'appellent "${query}" : ${sameFirstName.map(match => personLabel(match.person)).join(', ')}. Demande le nom complet ou le prénom + initiale du nom de famille.`,
      }
    }
  }

  const bestScore = Math.max(personMatches[0]?.score ?? 0, equipeMatches[0]?.score ?? 0)
  if (bestScore === 0) {
    return { status: 'not_found', message: `Aucun membre ou équipe trouvé pour "${query}". Utilise list_members pour voir les noms disponibles.` }
  }

  const tiedPeople = personMatches.filter(match => match.score === bestScore)
  const tiedEquipes = equipeMatches.filter(match => match.score === bestScore)
  if (tiedPeople.length + tiedEquipes.length > 1) {
    const options = [
      ...tiedPeople.map(match => personLabel(match.person)),
      ...tiedEquipes.map(match => `${match.equipe.name} (équipe, ${match.equipe.membres.length} pers.)`),
    ].slice(0, 6)
    return {
      status: 'ambiguous',
      message: `Plusieurs correspondances pour "${query}" : ${options.join(', ')}. Demande le nom complet ou le prénom + initiale du nom de famille.`,
    }
  }

  if (tiedEquipes[0]) {
    const equipe = tiedEquipes[0].equipe
    return { status: 'found', equipeId: equipe.id, displayName: equipe.name, equipe }
  }

  const person = tiedPeople[0].person
  return {
    status: 'found',
    ...(person.kind === 'member' ? { memberId: person.id } : { userId: person.id }),
    displayName: person.displayName,
  }
}

async function insertPointageRows(rows: Array<{
  chantier_id: string
  user_id?: string | null
  member_id?: string | null
  date: string
  hours: number
  description: string | null
}>) {
  if (rows.some(row => row.hours <= 0 || row.hours > 24)) {
    return { error: 'Le nombre d\'heures doit être compris entre 0.5 et 24.' }
  }
  const supabase = await createClient()
  const { error } = await supabase.from('chantier_pointages').insert(rows)
  if (!error) {
    for (const chantierId of new Set(rows.map(row => row.chantier_id))) {
      revalidatePath(`/chantiers/${chantierId}`)
    }
    revalidatePath('/chantiers/heures')
  }
  return { error: error?.message ?? null }
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  chantierId: string,
  taches: Awaited<ReturnType<typeof getChantierTaches>>,
  people: KnownPerson[],
  chantierEquipes: Awaited<ReturnType<typeof getChantierEquipes>>,
  allEquipes: Awaited<ReturnType<typeof getEquipes>>,
  plannings: ChantierPlanning[],
  today: string,
  permissions: { canCreateExpenses: boolean; canManagePlanning: boolean },
): Promise<string> {
  if (name === 'list_members') {
    const lines: string[] = []
    if (people.length > 0) {
      lines.push('Personnes connues :')
      for (const person of people) lines.push(`  - ${personLabel(person)}`)
    }
    const equipes = uniqById([...chantierEquipes, ...allEquipes])
    if (equipes.length > 0) {
      lines.push('Équipes :')
      for (const eq of equipes) {
        const membresStr = eq.membres.map(m => {
          const rate = m.taux_horaire != null ? `, ${m.taux_horaire}€/h` : ''
          return `${fullMemberName(m)}${m.role_label ? ` (${m.role_label}${rate})` : rate ? ` (${rate.slice(2)})` : ''}`
        }).join(', ')
        lines.push(`  - ${eq.name}${membresStr ? ` : ${membresStr}` : ''}`)
      }
    }
    if (lines.length === 0) return 'Aucun membre ni équipe connu dans cette organisation.'
    return lines.join('\n')
  }

  if (name === 'add_pointage') {
    const hours = args.hours as number
    const date = (args.date as string | undefined) ?? today
    const description = (args.description as string | undefined) ?? null
    const memberNameQuery = args.member_name as string | undefined

    if (memberNameQuery) {
      const found = resolveAssigneeByName(memberNameQuery, people, [...chantierEquipes, ...allEquipes])
      if (found.status !== 'found') return found.message

      if (found.equipe) {
        if (found.equipe.membres.length === 0) {
          return `L'équipe "${found.displayName}" n'a aucun membre, impossible de pointer des heures d'équipe.`
        }
        const result = await insertPointageRows(found.equipe.membres.map(member => ({
          chantier_id: chantierId,
          member_id: member.id,
          date,
          hours,
          description: description ?? `Pointage équipe ${found.displayName}`,
        })))
        if (result.error) return `Erreur : ${result.error}`
        const totalHours = hours * found.equipe.membres.length
        const memberNames = found.equipe.membres.map(fullMemberName).join(', ')
        return `Pointage d'équipe enregistré pour ${found.displayName} le ${date} : ${hours}h par membre (${totalHours}h au total), membres : ${memberNames}.`
      }

      const result = await insertPointageRows([{
        chantier_id: chantierId,
        user_id: found.userId ?? null,
        member_id: found.memberId ?? null,
        date,
        hours,
        description,
      }])
      if (result.error) return `Erreur : ${result.error}`
      return `Pointage de ${hours}h enregistré pour ${found.displayName} le ${date}.`
    }

    const result = await createPointage(chantierId, { hours, date, description })
    if (result.error) return `Erreur : ${result.error}`
    return `Pointage de ${hours}h enregistré pour le ${date}.`
  }

  if (name === 'add_expense') {
    if (!permissions.canCreateExpenses) {
      return 'Action non autorisée : vous n\'avez pas la permission d\'ajouter des dépenses sur ce chantier.'
    }
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
    if (!permissions.canManagePlanning) {
      return 'Action non autorisée : vous n\'avez pas la permission de créer des créneaux de planning.'
    }
    const plannedDate = args.planned_date as string
    const label = args.label as string
    const memberNameQuery = args.member_name as string | undefined

    let memberId: string | null = null
    let equipeId: string | null = null

    if (memberNameQuery) {
      const found = resolveAssigneeByName(memberNameQuery, people, [...chantierEquipes, ...allEquipes])
      if (found.status === 'ambiguous') return found.message
      if (found.status === 'not_found') {
        return `Je ne connais pas "${memberNameQuery}" dans vos membres ou équipes. S'agit-il d'un nouveau membre ? Si oui, dites-le moi et donnez-moi son prénom, son nom et éventuellement son taux horaire, je l'ajouterai avant de créer le créneau.`
      }
      if (found.status === 'found') {
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
    if (!permissions.canManagePlanning) {
      return 'Action non autorisée : vous n\'avez pas la permission de supprimer des créneaux de planning.'
    }
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

  if (name === 'add_member') {
    if (!permissions.canManagePlanning) {
      return 'Action non autorisée : vous n\'avez pas la permission d\'ajouter des membres.'
    }
    const memberName = (args.name as string | undefined)?.trim()
    if (!memberName) return 'Le nom du membre est requis.'

    const result = await createIndividualMember({
      prenom: (args.prenom as string | undefined)?.trim() || null,
      name: memberName,
      email: (args.email as string | undefined)?.trim() || null,
      tauxHoraire: args.taux_horaire != null ? Number(args.taux_horaire) : null,
      roleLabel: (args.role_label as string | undefined)?.trim() || null,
    })
    if (result.error) return `Erreur lors de l'ajout du membre : ${result.error}`

    const displayName = [(args.prenom as string | undefined)?.trim(), memberName].filter(Boolean).join(' ')
    return `Membre "${displayName}" ajouté à l'organisation (ID : ${result.id}). Vous pouvez maintenant l'assigner à un créneau en utilisant son nom.`
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

  const [canViewExpenses, canCreateExpenses, canManagePlanning] = await Promise.all([
    hasPermission('chantiers.expenses.view'),
    hasPermission('chantiers.expenses.create'),
    hasPermission('chantiers.planning'),
  ])

  const body = await req.json()
  const chantierId: string = body.chantierId
  const messages: Array<{ role: string; content: string }> = body.messages ?? []

  if (!chantierId) return NextResponse.json({ error: 'chantierId manquant' }, { status: 400 })
  if (messages.length === 0) return NextResponse.json({ error: 'Messages vides' }, { status: 400 })

  // Charger le contexte complet du chantier
  const [chantier, taches, pointages, notes, profitability, individualMembers, chantierEquipes, plannings, businessCtx, orgIndividualMembers, allEquipes, teamMembers] = await Promise.all([
    getChantierById(chantierId),
    getChantierTaches(chantierId),
    getChantierPointages(chantierId),
    getChantierNotes(chantierId),
    getChantierProfitability(chantierId),
    getChantierIndividualMembers(chantierId),
    getChantierEquipes(chantierId),
    getChantierPlannings(chantierId),
    getBusinessContext(orgId),
    getOrgIndividualMembers(),
    getEquipes(),
    getTeamMembers(),
  ])

  if (!chantier) return NextResponse.json({ error: 'Chantier introuvable' }, { status: 404 })

  const today = todayParis()
  const tachesDone = taches.filter(t => t.status === 'termine').length
  const avancementPct = taches.length > 0 ? Math.round((tachesDone / taches.length) * 100) : 0
  const lastNote = notes[0]?.content ?? 'aucune'
  const recentPointages = pointages.slice(0, 5).map(p => `${p.date}: ${p.hours}h${p.description ? ` (${p.description})` : ''}`)

  const people = buildKnownPeople({
    chantierIndividualMembers: individualMembers,
    orgIndividualMembers,
    chantierEquipes,
    allEquipes,
    teamMembers,
  })
  const duplicateFirstNames = Array.from(
    people.reduce((acc, person) => {
      const first = person.firstName ? normalizeName(person.firstName) : ''
      if (!first) return acc
      acc.set(first, [...(acc.get(first) ?? []), person])
      return acc
    }, new Map<string, KnownPerson[]>()),
  )
    .filter(([, matches]) => matches.length > 1)
    .map(([first, matches]) => `${first}: ${matches.map(personLabel).join(', ')}`)

  const membresIndivStr = people.length > 0
    ? people.map(person => personLabel(person)).join(' | ')
    : 'aucun'
  const equipesForContext = uniqById([...chantierEquipes, ...allEquipes])
  const equipesStr = equipesForContext.length > 0
    ? equipesForContext.map(eq => {
        const membresEq = (eq.membres ?? []).map(m => {
          const rate = m.taux_horaire != null ? `, ${m.taux_horaire}€/h` : ''
          return `${fullMemberName(m)}${m.role_label ? ` (${m.role_label}${rate})` : rate ? ` (${rate.slice(2)})` : ''}`
        }).join(', ')
        return `${eq.name}${membresEq ? ` (${membresEq})` : ''}`
      }).join(' | ')
    : 'aucune'
  const planningsStr = plannings.length > 0
    ? plannings.map(p => `ID ${p.id} : ${p.planned_date} ${p.start_time ?? 'sans heure'}${p.end_time ? `-${p.end_time}` : ''}, ${p.label}, ${p.team_size} pers.${p.notes ? `, notes: ${p.notes}` : ''}`).join(' | ')
    : 'aucun'

  const systemPrompt = `Tu t'appelles Marco. Tu es chef de chantier virtuel chez ATELIER by Orsayn. Tu suis ce chantier de pres, tu connais les gens de l'equipe, l'avancement, les chiffres. Tu parles comme un vrai chef de chantier : direct, chaleureux, concret. Pas de langue de bois, pas de blabla, on va droit au but. Tu tutoies naturellement.

${formatBusinessContextForPrompt(businessCtx)}

Chantier : ${chantier.title}
Statut : ${chantier.status}
Budget HT : ${chantier.budget_ht ? chantier.budget_ht + '€' : 'non defini'}
Avancement taches : ${tachesDone}/${taches.length} (${avancementPct}%)
Heures pointees : ${profitability?.hoursLogged ?? 0}h
${canViewExpenses ? `Cout total : ${profitability ? Math.round(profitability.costTotal) + '€' : 'N/A'}
Cout main-d'oeuvre : ${profitability ? Math.round(profitability.costLabor) + '€' : 'N/A'}
Cout materiel : ${profitability ? Math.round(profitability.costMaterial) + '€' : 'N/A'}
CA facture : ${profitability ? Math.round(profitability.revenueHt) + '€' : 'N/A'}
Marge : ${profitability ? Math.round(profitability.marginEur) + '€ (' + Math.round(profitability.marginPct * 100) + '%)' : 'N/A'}` : 'Donnees financieres : acces non autorise'}
Derniere note : ${lastNote}
Pointages recents : ${recentPointages.length > 0 ? recentPointages.join(' | ') : 'aucun'}
Taches : ${taches.map(t => `"${t.title}" [${t.status}]`).join(', ') || 'aucune'}
Personnes connues (chantier + organisation + fantomes + comptes app) : ${membresIndivStr}
Equipes connues (chantier + organisation) : ${equipesStr}
Homonymes/prenoms ambigus : ${duplicateFirstNames.length > 0 ? duplicateFirstNames.join(' | ') : 'aucun'}
Creneaux planning existants : ${planningsStr}
Date du jour : ${today}

Instructions :
- Reponds toujours en francais, ton direct et humain, comme un chef de chantier experimente qui connait son equipe
- Utilise les prenoms des membres quand tu en parles : "Voila, j'ai pointe 4h pour Thomas ce matin" plutot que "Pointage enregistre"
- Si la marge est < 10%, previens clairement, sans dramatiser
- Si le cout depasse 90% du budget, sonne l'alarme avec des mots clairs
- Tu peux ajouter des pointages (pour l'utilisateur, pour un membre nomme ou pour une equipe), des notes, mettre a jour des taches via les outils disponibles
${canCreateExpenses ? '- Tu peux ajouter des depenses via add_expense' : '- Tu ne peux pas ajouter de depenses : c\'est reserve aux membres habilites. Dis-le simplement.'}
${canManagePlanning ? '- Tu peux creer et supprimer des creneaux de planning via add_planning_slot et delete_planning_slot' : '- Tu ne peux pas toucher au planning : c\'est reserve aux membres habilites. Dis-le simplement.'}
${canViewExpenses ? '' : '- Tu n\'as pas acces aux donnees financieres (couts, marges, rentabilite) : reserve aux membres habilites. Dis-le simplement si demande.'}
- Pour pointer les heures d'une personne ou d'une equipe, utilise add_pointage avec member_name
- Quand member_name designe une equipe, les heures sont pointees pour chaque membre avec son propre taux horaire
- Pour creer un planning (si autorise), utilise add_planning_slot avec la date, le label, les horaires, et member_name si une personne ou equipe est nommee
- Si un prenom est ambigu, demande le nom complet avant d'agir
- Si tu ne connais pas les membres ou equipes, appelle d'abord list_members
- Si add_planning_slot retourne que le membre est inconnu, demande si c'est un nouveau membre. Si oui, collecte prenom, nom, taux horaire (facultatif) et email (facultatif), puis appelle add_member avant de recreer le creneau
- N'appelle jamais add_member sans confirmation explicite que c'est bien un nouveau membre
- Chiffre tout ce qui peut l'etre, sois factuel
- Aucun emoji, aucun symbole decoratif
- Aucun tiret cadratin : utilise des virgules ou des points a la place`

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
        const result = await executeTool(tc.function.name, args, chantierId, taches, people, chantierEquipes, allEquipes, plannings, today, { canCreateExpenses, canManagePlanning })
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
    if (err instanceof AIQuotaExceededError) {
      return NextResponse.json({ error: 'Quota mensuel de l\'assistant chantier atteint.' }, { status: 402 })
    }
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
