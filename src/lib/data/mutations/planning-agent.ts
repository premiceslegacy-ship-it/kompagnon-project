'use server'

import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { hasPermission } from '@/lib/data/queries/membership'
import { overlaps } from '@/lib/planning/overlaps'

// ─── Types ────────────────────────────────────────────────────────────────────

export type PlanningConflict = {
  memberId: string | null
  equipeId: string | null
  name: string
  date: string
  slots: Array<{ id: string; chantierTitle: string; startTime: string | null; endTime: string | null; label: string }>
}

export type ReplacementCandidate = {
  memberId: string
  name: string
  confidence: 'available' | 'unconfirmed'
  reasons: string[]
  exclusionReason?: string
}

export type MissingPointage = {
  slotId: string
  chantierId: string
  chantierTitle: string
  plannedDate: string
  startTime: string | null
  endTime: string | null
  memberId: string | null
  memberName: string | null
  label: string
}

// ─── Conflits de planning (même membre/équipe, créneaux qui se chevauchent) ───

export async function findPlanningConflicts(fromDate: string, toDate: string): Promise<{ conflicts: PlanningConflict[]; error: string | null }> {
  if (!await hasPermission('chantiers.planning')) return { conflicts: [], error: 'Action non autorisée.' }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { conflicts: [], error: 'Organisation introuvable.' }

  const supabase = await createClient()
  const { data: slots } = await supabase
    .from('chantier_plannings')
    .select('id, planned_date, start_time, end_time, label, member_id, equipe_id, member:chantier_equipe_membres(prenom, name), equipe:chantier_equipes(name), chantier:chantiers!inner(title, organization_id)')
    .eq('chantier.organization_id', orgId)
    .gte('planned_date', fromDate)
    .lte('planned_date', toDate)
    .order('planned_date', { ascending: true })

  const byKey = new Map<string, any[]>()
  for (const slot of slots ?? []) {
    const s = slot as any
    const ownerKey = s.member_id ? `member:${s.member_id}` : s.equipe_id ? `equipe:${s.equipe_id}` : null
    if (!ownerKey) continue
    const key = `${ownerKey}:${s.planned_date}`
    const list = byKey.get(key) ?? []
    list.push(s)
    byKey.set(key, list)
  }

  const conflicts: PlanningConflict[] = []
  for (const [key, list] of byKey) {
    if (list.length < 2) continue
    const overlapping: any[] = []
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (overlaps(list[i].start_time, list[i].end_time, list[j].start_time, list[j].end_time)) {
          if (!overlapping.includes(list[i])) overlapping.push(list[i])
          if (!overlapping.includes(list[j])) overlapping.push(list[j])
        }
      }
    }
    if (overlapping.length < 2) continue

    const first = list[0]
    const name = first.member
      ? [first.member.prenom, first.member.name].filter(Boolean).join(' ')
      : first.equipe
        ? `équipe ${first.equipe.name}`
        : 'Inconnu'

    conflicts.push({
      memberId: first.member_id ?? null,
      equipeId: first.equipe_id ?? null,
      name,
      date: first.planned_date,
      slots: overlapping.map(s => ({
        id: s.id,
        chantierTitle: s.chantier?.title ?? 'Chantier',
        startTime: s.start_time,
        endTime: s.end_time,
        label: s.label,
      })),
    })
    void key
  }

  return { conflicts, error: null }
}

// ─── Candidats de remplacement ────────────────────────────────────────────────

export async function findReplacementCandidates(params: {
  chantierId: string
  plannedDate: string
  startTime?: string | null
  endTime?: string | null
  excludeMemberId?: string | null
}): Promise<{ candidates: ReplacementCandidate[]; error: string | null }> {
  if (!await hasPermission('chantiers.planning')) return { candidates: [], error: 'Action non autorisée.' }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { candidates: [], error: 'Organisation introuvable.' }

  const supabase = await createClient()
  const { data: chantier } = await supabase
    .from('chantiers')
    .select('id')
    .eq('id', params.chantierId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!chantier) return { candidates: [], error: 'Chantier introuvable ou non autorisé.' }

  const [{ data: members }, { data: absences }, { data: dayPlanning }, { data: priorPlanning }] = await Promise.all([
    supabase
      .from('chantier_equipe_membres')
      .select('id, prenom, name, role_label')
      .eq('organization_id', orgId),
    supabase
      .from('member_absences')
      .select('member_id, start_date, end_date')
      .eq('organization_id', orgId)
      .lte('start_date', params.plannedDate)
      .gte('end_date', params.plannedDate),
    supabase
      .from('chantier_plannings')
      .select('member_id, start_time, end_time, chantier:chantiers!inner(organization_id)')
      .eq('chantier.organization_id', orgId)
      .eq('planned_date', params.plannedDate)
      .not('member_id', 'is', null),
    supabase
      .from('chantier_plannings')
      .select('member_id')
      .eq('chantier_id', params.chantierId)
      .not('member_id', 'is', null)
      .limit(200),
  ])

  const absentMemberIds = new Set((absences ?? []).map(a => a.member_id))
  const busyMemberIds = new Set(
    (dayPlanning ?? [])
      .filter((p: any) => overlaps(params.startTime ?? null, params.endTime ?? null, p.start_time, p.end_time))
      .map((p: any) => p.member_id)
      .filter(Boolean),
  )
  const experiencedMemberIds = new Set((priorPlanning ?? []).map(p => p.member_id).filter(Boolean))

  const candidates: ReplacementCandidate[] = []
  for (const member of members ?? []) {
    if (params.excludeMemberId && member.id === params.excludeMemberId) continue
    const name = [member.prenom, member.name].filter(Boolean).join(' ') || 'Membre'

    if (absentMemberIds.has(member.id)) {
      candidates.push({ memberId: member.id, name, confidence: 'unconfirmed', reasons: [], exclusionReason: 'Absent(e) sur cette période.' })
      continue
    }
    if (busyMemberIds.has(member.id)) {
      candidates.push({ memberId: member.id, name, confidence: 'unconfirmed', reasons: [], exclusionReason: 'Déjà affecté(e) sur un autre créneau ce jour-là.' })
      continue
    }

    const reasons: string[] = []
    if (experiencedMemberIds.has(member.id)) reasons.push('Connaît déjà ce chantier.')
    // Aucune disponibilité déclarée positivement dans le projet : on ne peut jamais
    // affirmer qu'un membre est "disponible" avec certitude, seulement qu'il n'est
    // ni absent déclaré, ni déjà occupé sur ce créneau.
    reasons.push('Non occupé(e) et non déclaré(e) absent(e) sur ce créneau, disponibilité non confirmée par ailleurs.')

    candidates.push({ memberId: member.id, name, confidence: 'unconfirmed', reasons })
  }

  // Les candidats réellement proposables : ni absents ni occupés, triés par expérience.
  const proposable = candidates
    .filter(c => !c.exclusionReason)
    .sort((a, b) => Number(b.reasons.includes('Connaît déjà ce chantier.')) - Number(a.reasons.includes('Connaît déjà ce chantier.')))

  const excluded = candidates.filter(c => c.exclusionReason)

  return { candidates: [...proposable, ...excluded], error: null }
}

// ─── Pointages manquants ──────────────────────────────────────────────────────
// Différencie explicitement "pas de pointage retrouvé" d'une absence réelle :
// ne conclut jamais qu'un membre était absent uniquement sur cette base.

export async function findMissingPointages(date: string): Promise<{ missing: MissingPointage[]; error: string | null }> {
  if (!await hasPermission('chantiers.planning')) return { missing: [], error: 'Action non autorisée.' }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { missing: [], error: 'Organisation introuvable.' }

  const supabase = await createClient()
  const [{ data: slots }, { data: pointages }] = await Promise.all([
    supabase
      .from('chantier_plannings')
      .select('id, chantier_id, planned_date, start_time, end_time, label, member_id, member:chantier_equipe_membres(prenom, name), chantier:chantiers!inner(title, organization_id, is_archived, status)')
      .eq('chantier.organization_id', orgId)
      .eq('chantier.is_archived', false)
      .not('chantier.status', 'in', '("termine","annule")')
      .eq('planned_date', date),
    supabase
      .from('chantier_pointages')
      .select('id, chantier_planning_id, chantier_id, date, member_id')
      .eq('date', date),
  ])

  const pointedPlanningIds = new Set((pointages ?? []).map(p => p.chantier_planning_id).filter(Boolean))
  const pointedKeys = new Set((pointages ?? []).map(p => `${p.chantier_id}:${p.date}:${p.member_id ?? '*'}`))
  const pointedDayKeys = new Set((pointages ?? []).map(p => `${p.chantier_id}:${p.date}`))

  const missing: MissingPointage[] = []
  for (const slot of slots ?? []) {
    const s = slot as any
    if (pointedPlanningIds.has(s.id)) continue
    const directKey = `${s.chantier_id}:${s.planned_date}:${s.member_id ?? '*'}`
    if (pointedKeys.has(directKey)) continue
    if (pointedDayKeys.has(`${s.chantier_id}:${s.planned_date}`)) continue

    missing.push({
      slotId: s.id,
      chantierId: s.chantier_id,
      chantierTitle: s.chantier?.title ?? 'Chantier',
      plannedDate: s.planned_date,
      startTime: s.start_time,
      endTime: s.end_time,
      memberId: s.member_id,
      memberName: s.member ? [s.member.prenom, s.member.name].filter(Boolean).join(' ') || null : null,
      label: s.label,
    })
  }

  return { missing, error: null }
}
