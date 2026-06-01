import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { cache } from 'react'
import { todayParis } from '@/lib/utils'

export type MyTask = {
  id: string
  title: string
  chantier_id: string
  chantier_title: string
  status: 'a_faire' | 'en_cours' | 'termine'
  due_date: string | null
  is_overdue: boolean
}

export type MyPlanningSlot = {
  id: string
  source?: 'chantier' | 'maintenance'
  chantier_id: string
  chantier_title: string
  chantier_address: string | null
  start_time: string | null
  end_time: string | null
  label: string
  notes: string | null
}

export type MyWeekPointage = {
  total_hours: number
  days_worked: number
}

export type CollaborateurDashboard = {
  tasks: MyTask[]
  todayPlanning: MyPlanningSlot[]
  weekPointage: MyWeekPointage
  /** profile_id de l'individal member trouvé, null si non lié */
  memberId: string | null
}

/**
 * Données du dashboard personnel d'un collaborateur/employee/viewer.
 * userId = auth.users.id (Supabase UID)
 *
 * Un membre org peut exister dans deux états :
 * - Uniquement dans `memberships` (compte app, pas de ligne terrain)
 *   → tâches via assigned_to=userId, pointages via user_id, pas de planning terrain
 * - Dans `memberships` ET `chantier_equipe_membres` (profile_id=userId)
 *   → planning terrain visible en plus
 */
export const getCollaborateurDashboard = cache(async (userId: string): Promise<CollaborateurDashboard> => {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()

  const empty: CollaborateurDashboard = {
    tasks: [],
    todayPlanning: [],
    weekPointage: { total_hours: 0, days_worked: 0 },
    memberId: null,
  }

  if (!orgId) return empty

  const today = todayParis()

  // Semaine courante (lundi - dimanche)
  const now = new Date()
  const dayOfWeek = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const mondayStr = monday.toISOString().split('T')[0]
  const sundayStr = sunday.toISOString().split('T')[0]

  // Cherche un enregistrement terrain lié (optionnel — membres org purs n'en ont pas)
  const { data: memberRow } = await supabase
    .from('chantier_equipe_membres')
    .select('id, equipe_id')
    .eq('organization_id', orgId)
    .eq('profile_id', userId)
    .maybeSingle()

  const memberId = memberRow?.id ?? null
  const equipeId = memberRow?.equipe_id ?? null

  let assignedTaskIds: string[] = []
  if (memberId || equipeId) {
    const filters = [
      memberId ? `member_id.eq.${memberId}` : null,
      equipeId ? `equipe_id.eq.${equipeId}` : null,
    ].filter(Boolean).join(',')
    const { data: assignmentRows } = await supabase
      .from('chantier_task_assignments')
      .select('tache_id')
      .or(filters)
    assignedTaskIds = [...new Set((assignmentRows ?? []).map((row: any) => row.tache_id).filter(Boolean))]
  }

  const oldAssignedTasksQuery = supabase
    .from('chantier_taches')
    .select(`
      id, title, status, due_date, chantier_id,
      chantier:chantiers!inner(title, organization_id)
    `)
    .eq('chantier.organization_id', orgId)
    .eq('assigned_to', userId)
    .neq('status', 'termine')
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(15)

  const assignedTasksQuery = assignedTaskIds.length > 0
    ? supabase
        .from('chantier_taches')
        .select(`
          id, title, status, due_date, chantier_id,
          chantier:chantiers!inner(title, organization_id)
        `)
        .eq('chantier.organization_id', orgId)
        .in('id', assignedTaskIds)
        .neq('status', 'termine')
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(15)
    : Promise.resolve({ data: [] as any[] })

  const [
    { data: oldAssignedTasks },
    { data: assignedTasks },
    { data: planningByMember },
    { data: maintenanceToday },
    { data: pointagesByMember },
    { data: pointagesByUser },
  ] = await Promise.all([
    // Compat ancienne colonne assigned_to + nouvelles assignations multiples.
    oldAssignedTasksQuery,
    assignedTasksQuery,

    // Planning du jour via profil terrain (member_id)
    memberId
      ? supabase
          .from('chantier_plannings')
          .select(`
            id, chantier_id, start_time, end_time, label, notes,
            chantier:chantiers!inner(title, organization_id, address_line1, city)
          `)
          .eq('chantiers.organization_id', orgId)
          .eq('planned_date', today)
          .eq('member_id', memberId)
          .order('start_time', { ascending: true })
      : Promise.resolve({ data: [] as any[] }),

    supabase
      .from('maintenance_interventions')
      .select(`
        id, date_intervention, start_time, end_time, duration_hours, rapport,
        contract:maintenance_contracts!inner(title, chantier_id, organization_id)
      `)
      .eq('contract.organization_id', orgId)
      .eq('date_intervention', today)
      .eq('statut', 'planifiée')
      .or([
        `intervenant_user_id.eq.${userId}`,
        memberId ? `intervenant_member_id.eq.${memberId}` : null,
        memberId ? `intervenant_id.eq.${memberId}` : null,
      ].filter(Boolean).join(','))
      .order('start_time', { ascending: true, nullsFirst: false }),

    // Pointages via profil terrain (member_id) — pour membres avec fiche intervenant
    memberId
      ? supabase
          .from('chantier_pointages')
          .select('hours, date')
          .eq('member_id', memberId)
          .gte('date', mondayStr)
          .lte('date', sundayStr)
      : Promise.resolve({ data: [] as any[] }),

    // Pointages via compte app (user_id) — pour membres org purs
    supabase
      .from('chantier_pointages')
      .select('hours, date')
      .eq('user_id', userId)
      .gte('date', mondayStr)
      .lte('date', sundayStr),
  ])

  const taskRows = [...(oldAssignedTasks ?? []), ...(assignedTasks ?? [])]
  const uniqueTaskRows = Array.from(new Map(taskRows.map((task: any) => [task.id, task])).values())

  const tasks: MyTask[] = uniqueTaskRows.map((t: any) => ({
    id: t.id,
    title: t.title,
    chantier_id: t.chantier_id,
    chantier_title: t.chantier?.title ?? '',
    status: t.status,
    due_date: t.due_date ?? null,
    is_overdue: Boolean(t.due_date && t.due_date < today && t.status !== 'termine'),
  }))

  const todayPlanning: MyPlanningSlot[] = (planningByMember ?? []).map((p: any) => {
    const c = p.chantier
    const parts = [c?.address_line1, c?.city].filter(Boolean)
    return {
      id: p.id,
      source: 'chantier' as const,
      chantier_id: p.chantier_id,
      chantier_title: c?.title ?? '',
      chantier_address: parts.length ? parts.join(', ') : null,
      start_time: p.start_time ?? null,
      end_time: p.end_time ?? null,
      label: p.label,
      notes: p.notes ?? null,
    }
  })

  todayPlanning.push(...(maintenanceToday ?? []).map((iv: any) => {
    const contract = Array.isArray(iv.contract) ? iv.contract[0] : iv.contract
    return {
      id: `maintenance:${iv.id}`,
      source: 'maintenance' as const,
      chantier_id: contract?.chantier_id ?? '',
      chantier_title: contract?.title ? `Entretien - ${contract.title}` : 'Entretien',
      chantier_address: null,
      start_time: iv.start_time ?? null,
      end_time: iv.end_time ?? null,
      label: 'Intervention entretien',
      notes: iv.rapport ?? null,
    }
  }))

  todayPlanning.sort((a, b) => (a.start_time ?? '99:99').localeCompare(b.start_time ?? '99:99'))

  // Fusionne pointages terrain + pointages compte app (déduplique par date+hours si besoin)
  const allPointages = [
    ...(pointagesByMember ?? []),
    ...(pointagesByUser ?? []),
  ]
  const totalHours = allPointages.reduce((sum: number, p: any) => sum + (p.hours ?? 0), 0)
  const daysWorked = new Set(allPointages.map((p: any) => p.date)).size

  return {
    tasks,
    todayPlanning,
    weekPointage: { total_hours: Math.round(totalHours * 10) / 10, days_worked: daysWorked },
    memberId,
  }
})

/** Planning du jour complet de l'organisation — pour le digest owner/admin. */
export const getTodayPlanningDigest = cache(async (): Promise<MyPlanningSlot[]> => {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  const today = todayParis()

  const [{ data }, { data: maintenanceToday }] = await Promise.all([
    supabase
      .from('chantier_plannings')
      .select(`
        id, chantier_id, start_time, end_time, label, notes,
        chantier:chantiers!inner(title, organization_id, address_line1, city)
      `)
      .eq('chantiers.organization_id', orgId)
      .eq('planned_date', today)
      .order('start_time', { ascending: true, nullsFirst: false })
      .limit(20),
    supabase
      .from('maintenance_interventions')
      .select(`
        id, start_time, end_time, rapport, observations,
        contract:maintenance_contracts!inner(
          title, chantier_id, organization_id, site_address_line1, site_city,
          chantier:chantiers!maintenance_contracts_chantier_id_fkey(address_line1, city)
        )
      `)
      .eq('organization_id', orgId)
      .eq('date_intervention', today)
      .in('statut', ['planifiée', 'réalisée'])
      .order('start_time', { ascending: true, nullsFirst: false })
      .limit(20),
  ])

  const chantierSlots = (data ?? []).map((p: any) => {
    const c = p.chantier
    const parts = [c?.address_line1, c?.city].filter(Boolean)
    return {
      id: p.id,
      source: 'chantier' as const,
      chantier_id: p.chantier_id,
      chantier_title: c?.title ?? '',
      chantier_address: parts.length ? parts.join(', ') : null,
      start_time: p.start_time ?? null,
      end_time: p.end_time ?? null,
      label: p.label,
      notes: p.notes ?? null,
    }
  })

  const maintenanceSlots = (maintenanceToday ?? []).map((iv: any) => {
    const contract = Array.isArray(iv.contract) ? iv.contract[0] : iv.contract
    const chantier = Array.isArray(contract?.chantier) ? contract.chantier[0] : contract?.chantier
    const parts = [
      chantier?.address_line1 ?? contract?.site_address_line1,
      chantier?.city ?? contract?.site_city,
    ].filter(Boolean)
    return {
      id: `maintenance:${iv.id}`,
      source: 'maintenance' as const,
      chantier_id: contract?.chantier_id ?? '',
      chantier_title: contract?.title ? `Entretien - ${contract.title}` : 'Entretien',
      chantier_address: parts.length ? parts.join(', ') : null,
      start_time: iv.start_time ? String(iv.start_time).slice(0, 5) : null,
      end_time: iv.end_time ? String(iv.end_time).slice(0, 5) : null,
      label: 'Intervention entretien',
      notes: iv.rapport ?? iv.observations ?? null,
    }
  })

  return [...chantierSlots, ...maintenanceSlots]
    .sort((a, b) => (a.start_time ?? '99:99').localeCompare(b.start_time ?? '99:99'))
})
