'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { APP_NAME } from '@/lib/brand'
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
}

export type AIPlanningSlot = PlanningSlotInput & {
  chantierTitle: string     // pour l'affichage dans la preview
}

export type AIPlanningResult = {
  slots: AIPlanningSlot[]
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
    created_by: user.id,
  })

  if (error) return { error: error.message }
  revalidatePath('/chantiers/planning')
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
    created_by: user.id,
  }))

  const { error } = await supabase.from('chantier_plannings').insert(rows)
  if (error) return { error: error.message, created: 0 }

  revalidatePath('/chantiers/planning')
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
  return { error: null }
}

// ─── Agent IA — Parsing langage naturel ──────────────────────────────────────

export async function planWeekWithAI(prompt: string, weekMondayDate: string): Promise<AIPlanningResult> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { slots: [], summary: '', error: 'Organisation introuvable.' }

  // Récupérer les chantiers actifs pour que Claude puisse les matcher
  const { data: chantiers } = await supabase
    .from('chantiers')
    .select('id, title, city, status')
    .eq('organization_id', orgId)
    .in('status', ['en_cours', 'planifie', 'suspendu'])
    .order('created_at', { ascending: false })
    .limit(20)

  if (!chantiers?.length) {
    return { slots: [], summary: '', error: 'Aucun chantier actif trouvé. Créez d\'abord un chantier.' }
  }

  // Calculer les dates de la semaine
  const monday = new Date(weekMondayDate)
  const weekDays: Record<string, string> = {}
  const dayNames = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    weekDays[dayNames[i]] = d.toISOString().split('T')[0]
  }

  const chantiersContext = chantiers.map(c => `- ID: ${c.id} | "${c.title}"${c.city ? ` (${c.city})` : ''}`).join('\n')

  const systemPrompt = `Tu es un assistant de planification pour un artisan BTP. Tu dois parser une description de planning en langage naturel et retourner un JSON structuré.

Chantiers disponibles :
${chantiersContext}

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
- start_time et end_time au format "HH:MM", null si non précisé
- team_size = nombre de personnes (1 si non précisé)
- label = nom de l'équipe ou des personnes mentionnées, sinon "Équipe"
- Si un créneau couvre "toute la journée", start_time = "08:00", end_time = "17:00"
- Si "matin" : start_time = "08:00", end_time = "12:00"
- Si "après-midi" : start_time = "13:00", end_time = "17:00"

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
      "notes": null
    }
  ],
  "summary": "Résumé en 1-2 phrases de ce qui va être planifié"
}`

  try {
    const { data } = await callAI<any>({
      organizationId: orgId,
      provider: 'openrouter',
      feature: 'planning_ai',
      model: 'anthropic/claude-sonnet-4-6',
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
    const parsed = JSON.parse(cleaned) as { slots: AIPlanningSlot[]; summary: string }

    // Valider que les chantierId existent bien
    const validIds = new Set(chantiers.map(c => c.id))
    const validSlots = parsed.slots.filter(s => validIds.has(s.chantierId))

    return { slots: validSlots, summary: parsed.summary ?? '' }
  } catch (error) {
    if (error instanceof AIModuleDisabledError) {
      return { slots: [], summary: '', error: 'Module IA planning désactivé.' }
    }

    return { slots: [], summary: '', error: 'Réponse IA invalide. Reformulez votre demande.' }
  }
}
