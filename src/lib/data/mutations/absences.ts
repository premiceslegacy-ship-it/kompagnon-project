'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { hasPermission } from '@/lib/data/queries/membership'
import { getMemberSession } from '@/lib/auth/member-session'
import { sendPushToOrgPermission } from '@/lib/push'

export type MemberAbsence = {
  id: string
  organization_id: string
  member_id: string
  start_date: string
  end_date: string
  reason: string | null
  created_by: string | null
  created_by_member_id: string | null
  created_at: string
}

export type ConflictingSlot = {
  id: string
  chantier_id: string
  chantier_title: string
  planned_date: string
  start_time: string | null
  end_time: string | null
  label: string
}

type Result = { error: string | null }

async function findConflictingSlots(
  orgId: string,
  memberId: string,
  startDate: string,
  endDate: string,
): Promise<ConflictingSlot[]> {
  const admin = createAdminClient()
  const { data: member } = await admin
    .from('chantier_equipe_membres')
    .select('id, equipe_id')
    .eq('id', memberId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!member) return []

  const orFilter = member.equipe_id
    ? `member_id.eq.${memberId},equipe_id.eq.${member.equipe_id}`
    : `member_id.eq.${memberId}`

  const { data } = await admin
    .from('chantier_plannings')
    .select('id, chantier_id, planned_date, start_time, end_time, label, chantier:chantiers!inner(title, organization_id)')
    .eq('chantier.organization_id', orgId)
    .gte('planned_date', startDate)
    .lte('planned_date', endDate)
    .or(orFilter)
    .order('planned_date', { ascending: true })

  return (data ?? []).map((slot: any) => ({
    id: slot.id,
    chantier_id: slot.chantier_id,
    chantier_title: slot.chantier?.title ?? 'Chantier',
    planned_date: slot.planned_date,
    start_time: slot.start_time,
    end_time: slot.end_time,
    label: slot.label,
  }))
}

/** Déclare une absence pour un membre, côté manager (planning global, Sarah). */
export async function declareMemberAbsence(input: {
  memberId: string
  startDate: string
  endDate: string
  reason?: string | null
}): Promise<Result & { id?: string; conflictingSlots?: ConflictingSlot[] }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  if (!await hasPermission('chantiers.planning')) {
    return { error: 'Action non autorisée.' }
  }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }

  if (input.endDate < input.startDate) {
    return { error: 'La date de fin doit être postérieure à la date de début.' }
  }

  const { data: member } = await supabase
    .from('chantier_equipe_membres')
    .select('id')
    .eq('id', input.memberId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!member) return { error: 'Membre introuvable ou non autorisé.' }

  const { data: inserted, error } = await supabase
    .from('member_absences')
    .insert({
      organization_id: orgId,
      member_id: input.memberId,
      start_date: input.startDate,
      end_date: input.endDate,
      reason: input.reason ?? null,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  const conflictingSlots = await findConflictingSlots(orgId, input.memberId, input.startDate, input.endDate)

  revalidatePath('/chantiers/planning')
  return { error: null, id: inserted?.id, conflictingSlots }
}

/** Déclare sa propre absence depuis /mon-espace (session membre, sans compte app). */
export async function declareMyAbsenceFromSpace(input: {
  startDate: string
  endDate: string
  reason?: string | null
}): Promise<Result & { id?: string; conflictingSlots?: ConflictingSlot[] }> {
  const session = await getMemberSession()
  if (!session) return { error: 'Session expirée. Reconnectez-vous via votre lien.' }
  if (!session.memberId) return { error: 'Session invalide. Reconnectez-vous via votre lien.' }

  if (input.endDate < input.startDate) {
    return { error: 'La date de fin doit être postérieure à la date de début.' }
  }

  const admin = createAdminClient()
  const { data: inserted, error } = await admin
    .from('member_absences')
    .insert({
      organization_id: session.organizationId,
      member_id: session.memberId,
      start_date: input.startDate,
      end_date: input.endDate,
      reason: input.reason ?? null,
      created_by_member_id: session.memberId,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  const conflictingSlots = await findConflictingSlots(session.organizationId, session.memberId, input.startDate, input.endDate)

  const { data: member } = await admin
    .from('chantier_equipe_membres')
    .select('prenom, name')
    .eq('id', session.memberId)
    .maybeSingle()
  const memberName = member ? [member.prenom, member.name].filter(Boolean).join(' ') : 'Un membre'
  sendPushToOrgPermission(session.organizationId, 'chantiers.edit', {
    title: `Absence déclarée — ${memberName}`,
    body: `Du ${input.startDate} au ${input.endDate}${conflictingSlots.length > 0 ? ` (${conflictingSlots.length} créneau${conflictingSlots.length > 1 ? 'x' : ''} en conflit)` : ''}`,
    url: '/chantiers/planning',
  }).catch(() => {})

  return { error: null, id: inserted?.id, conflictingSlots }
}

/** Liste les absences d'un membre, ou de toute l'organisation si memberId omis. */
export async function getMemberAbsences(params?: {
  memberId?: string
  fromDate?: string
  toDate?: string
}): Promise<MemberAbsence[]> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  let query = supabase
    .from('member_absences')
    .select('*')
    .eq('organization_id', orgId)
    .order('start_date', { ascending: true })

  if (params?.memberId) query = query.eq('member_id', params.memberId)
  if (params?.fromDate) query = query.gte('end_date', params.fromDate)
  if (params?.toDate) query = query.lte('start_date', params.toDate)

  const { data } = await query
  return (data ?? []) as MemberAbsence[]
}

export async function deleteMemberAbsence(id: string): Promise<Result> {
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }
  if (!await hasPermission('chantiers.planning')) {
    return { error: 'Action non autorisée.' }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('member_absences')
    .delete()
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }
  revalidatePath('/chantiers/planning')
  return { error: null }
}
