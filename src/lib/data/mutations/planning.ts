'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { APP_NAME } from '@/lib/brand'
import { dateParis } from '@/lib/utils'
import { AIModuleDisabledError, callAI } from '@/lib/ai/callAI'

// ─── Types ────────────────────────────────────────────────────────────────────

export type PlanningSlotInput = {
  chantierId: string
  plannedDate: string       // YYYY-MM-DD
  startTime?: string | null // HH:MM
  endTime?: string | null   // HH:MM
  label: string
  teamSize?: number
  notes?: string | null
  equipeId?: string | null
  memberId?: string | null  // Membre individuel — exclusif avec equipeId
}

export type AIPlanningSlot = PlanningSlotInput & {
  chantierTitle: string     // pour l'affichage dans la preview
}

export type AIPlanningDeletion = {
  id: string
  chantierId: string
  chantierTitle: string
  plannedDate: string
  startTime?: string | null
  endTime?: string | null
  label: string
}

export type AIPlanningResult = {
  slots: AIPlanningSlot[]
  deletions: AIPlanningDeletion[]
  summary: string           // résumé en langage naturel de ce qui va être créé
  error?: string
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function createPlanningSlot(data: PlanningSlotInput): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  const { error } = await supabase.from('chantier_plannings').insert({
    chantier_id: data.chantierId,
    planned_date: data.plannedDate,
    start_time: data.startTime ?? null,
    end_time: data.endTime ?? null,
    label: data.label,
    team_size: data.teamSize ?? 1,
    notes: data.notes ?? null,
    equipe_id: data.equipeId ?? null,
    member_id: data.memberId ?? null,
    created_by: user.id,
  })

  if (error) return { error: error.message }
  revalidatePath('/chantiers/planning')
  revalidatePath(`/chantiers/${data.chantierId}`)
  return { error: null }
}

export async function createPlanningSlots(slots: PlanningSlotInput[]): Promise<{ error: string | null; created: number }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.', created: 0 }

  const rows = slots.map(s => ({
    chantier_id: s.chantierId,
    planned_date: s.plannedDate,
    start_time: s.startTime ?? null,
    end_time: s.endTime ?? null,
    label: s.label,
    team_size: s.teamSize ?? 1,
    notes: s.notes ?? null,
    equipe_id: s.equipeId ?? null,
    member_id: s.memberId ?? null,
    created_by: user.id,
  }))

  const { error } = await supabase.from('chantier_plannings').insert(rows)
  if (error) return { error: error.message, created: 0 }

  revalidatePath('/chantiers/planning')
  for (const chantierId of new Set(slots.map(s => s.chantierId))) {
    revalidatePath(`/chantiers/${chantierId}`)
  }
  return { error: null, created: slots.length }
}

export async function deletePlanningSlot(id: string): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }

  // Vérifier que le créneau appartient bien à l'org avant de supprimer
  const { data: planning } = await supabase
    .from('chantier_plannings')
    .select('chantier_id, chantiers!inner(organization_id)')
    .eq('id', id)
    .single()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!planning || (planning as any).chantiers?.organization_id !== orgId) {
    return { error: 'Créneau introuvable ou non autorisé.' }
  }

  const { error } = await supabase
    .from('chantier_plannings')
    .delete()
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/chantiers/planning')
  revalidatePath(`/chantiers/${planning.chantier_id}`)
  return { error: null }
}

// ─── Agent IA — Parsing langage naturel ──────────────────────────────────────

export async function planWeekWithAI(prompt: string, weekMondayDate: string): Promise<AIPlanningResult> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { slots: [], deletions: [], summary: '', error: 'Organisation introuvable.' }

  // Récupérer les chantiers actifs pour que Claude puisse les matcher
  const { data: chantiers } = await supabase
    .from('chantiers')
    .select('id, title, city, status')
    .eq('organization_id', orgId)
    .in('status', ['en_cours', 'planifie', 'suspendu'])
    .order('created_at', { ascending: false })
    .limit(20)

  if (!chantiers?.length) {
    return { slots: [], deletions: [], summary: '', error: 'Aucun chantier actif trouvé. Créez d\'abord un chantier.' }
  }

  // Récupérer les équipes et membres individuels pour permettre à l'IA de les nommer
  const [{ data: equipes }, { data: membres }] = await Promise.all([
    supabase
      .from('chantier_equipes')
      .select('id, name')
      .eq('organization_id', orgId)
      .order('name', { ascending: true })
      .limit(50),
    supabase
      .from('chantier_equipe_membres')
      .select('id, prenom, name')
      .eq('organization_id', orgId)
      .order('name', { ascending: true })
      .limit(80),
  ])

  const equipesContext = (equipes ?? []).map(e => `- EQUIPE_ID: ${e.id} | "${e.name}"`).join('\n') || '(aucune équipe)'
  const membresContext = (membres ?? []).map(m => {
    const full = [m.prenom, m.name].filter(Boolean).join(' ')
    return `- MEMBER_ID: ${m.id} | "${full}"`
  }).join('\n') || '(aucun membre individuel)'

  // Calculer les dates de la semaine
  const monday = new Date(weekMondayDate)
  const weekDays: Record<string, string> = {}
  const dayNames = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    weekDays[dayNames[i]] = dateParis(d.getTime())
  }

  const chantiersContext = chantiers.map(c => `- ID: ${c.id} | "${c.title}"${c.city ? ` (${c.city})` : ''}`).join('\n')
  const weekEndDate = weekDays['dimanche']

  const { data: existingPlannings } = await supabase
    .from('chantier_plannings')
    .select(`
      id, chantier_id, planned_date, start_time, end_time, label,
      chantier:chantiers!inner(title, organization_id)
    `)
    .eq('chantier.organization_id', orgId)
    .gte('planned_date', weekMondayDate)
    .lte('planned_date', weekEndDate)
    .order('planned_date', { ascending: true })
    .order('start_time', { ascending: true, nullsFirst: false })

  const existingContext = (existingPlannings ?? []).map((p: any) => (
    `- SLOT_ID: ${p.id} | CHANTIER_ID: ${p.chantier_id} | "${p.chantier?.title ?? 'Chantier'}" | ${p.planned_date} ${p.start_time ?? 'sans heure'}${p.end_time ? `-${p.end_time}` : ''} | ${p.label}`
  )).join('\n') || '(aucun créneau existant cette semaine)'

  const systemPrompt = `Tu es un assistant de planification pour un artisan BTP. Tu dois parser une description de planning en langage naturel et retourner un JSON structuré.

Chantiers disponibles :
${chantiersContext}

Équipes disponibles :
${equipesContext}

Membres individuels disponibles :
${membresContext}

Créneaux existants cette semaine, supprimables uniquement si l'utilisateur le demande explicitement :
${existingContext}

Dates de la semaine du ${weekMondayDate} :
- lundi: ${weekDays['lundi']}
- mardi: ${weekDays['mardi']}
- mercredi: ${weekDays['mercredi']}
- jeudi: ${weekDays['jeudi']}
- vendredi: ${weekDays['vendredi']}
- samedi: ${weekDays['samedi']}
- dimanche: ${weekDays['dimanche']}

Règles :
- Matcher chaque mention de chantier avec l'ID le plus proche dans la liste (correspondance approximative par nom)
- Si une mention nomme une **équipe** existante, remplir equipeId avec son EQUIPE_ID, memberId = null
- Si une mention nomme une **personne individuelle** (prénom/nom) qui figure dans les membres listés, remplir memberId avec son MEMBER_ID, equipeId = null
- equipeId et memberId sont **mutuellement exclusifs** (jamais les deux dans le même slot)
- Si la personne/équipe n'est pas dans la liste, laisser equipeId et memberId à null et mettre le nom dans label
- start_time et end_time au format "HH:MM", null si non précisé
- team_size = nombre de personnes (1 si non précisé ou si memberId rempli)
- label = nom de l'équipe ou des personnes mentionnées, sinon "Équipe"
- Si un créneau couvre "toute la journée", start_time = "08:00", end_time = "17:00"
- Si "matin" : start_time = "08:00", end_time = "12:00"
- Si "après-midi" : start_time = "13:00", end_time = "17:00"
- Si l'utilisateur demande de supprimer/retirer/annuler un créneau existant, remplir deletions avec le SLOT_ID correspondant
- Ne mets jamais un créneau en deletions par déduction vague : il faut une correspondance claire avec les créneaux existants

Retourne UNIQUEMENT ce JSON (sans markdown) :
{
  "slots": [
    {
      "chantierId": "uuid",
      "chantierTitle": "titre pour affichage",
      "plannedDate": "YYYY-MM-DD",
      "startTime": "HH:MM" | null,
      "endTime": "HH:MM" | null,
      "label": "Équipe Martin",
      "teamSize": 2,
      "notes": null,
      "equipeId": "uuid" | null,
      "memberId": "uuid" | null
    }
  ],
  "deletions": [
    {
      "id": "slot_id",
      "chantierId": "uuid",
      "chantierTitle": "titre pour affichage",
      "plannedDate": "YYYY-MM-DD",
      "startTime": "HH:MM" | null,
      "endTime": "HH:MM" | null,
      "label": "libellé existant"
    }
  ],
  "summary": "Résumé en 1-2 phrases de ce qui va être planifié"
}`

  try {
    const { data } = await callAI<any>({
      organizationId: orgId,
      provider: 'openrouter',
      feature: 'planning_ai',
      model: 'deepseek/deepseek-v4-flash',
      inputKind: 'text',
      request: {
        body: {
          max_tokens: 1500,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
          ],
        },
      },
      metadata: {
        mutation: 'planWeekWithAI',
        week_monday_date: weekMondayDate,
        app_name: APP_NAME,
      },
    })

    const text: string = data.choices?.[0]?.message?.content?.trim() ?? ''
    // Nettoyer le JSON si Claude a ajouté des backticks malgré la consigne
    const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim()
    const parsed = JSON.parse(cleaned) as { slots?: AIPlanningSlot[]; deletions?: AIPlanningDeletion[]; summary: string }

    // Valider que les chantierId existent bien
    const validChantierIds = new Set(chantiers.map(c => c.id))
    const validEquipeIds = new Set((equipes ?? []).map(e => e.id))
    const validMemberIds = new Set((membres ?? []).map(m => m.id))
    const existingById = new Map((existingPlannings ?? []).map((p: any) => [p.id, p]))

    const validSlots = (parsed.slots ?? [])
      .filter(s => validChantierIds.has(s.chantierId))
      .map(s => ({
        ...s,
        equipeId: s.equipeId && validEquipeIds.has(s.equipeId) ? s.equipeId : null,
        memberId: s.memberId && validMemberIds.has(s.memberId) ? s.memberId : null,
      }))
      // Garantir l'exclusivité (member prioritaire si la personne est nommément citée)
      .map(s => s.memberId ? { ...s, equipeId: null } : s)

    const validDeletions = (parsed.deletions ?? [])
      .filter(d => existingById.has(d.id))
      .map(d => {
        const existing: any = existingById.get(d.id)
        return {
          id: existing.id,
          chantierId: existing.chantier_id,
          chantierTitle: existing.chantier?.title ?? d.chantierTitle ?? 'Chantier',
          plannedDate: existing.planned_date,
          startTime: existing.start_time,
          endTime: existing.end_time,
          label: existing.label,
        }
      })

    return { slots: validSlots, deletions: validDeletions, summary: parsed.summary ?? '' }
  } catch (error) {
    if (error instanceof AIModuleDisabledError) {
      return { slots: [], deletions: [], summary: '', error: 'Module IA planning désactivé.' }
    }

    return { slots: [], deletions: [], summary: '', error: 'Réponse IA invalide. Reformulez votre demande.' }
  }
}
