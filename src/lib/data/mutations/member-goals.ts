'use server'

import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { requirePermission } from '@/lib/data/queries/membership'
import { revalidatePath } from 'next/cache'

export type GoalUpsertInput = {
  /** ID intervenant terrain (chantier_equipe_membres) — exclusif avec membership_id */
  member_id?: string
  /** ID membership (membres org avec compte app) — exclusif avec member_id */
  membership_id?: string
  period_year: number
  period_month: number
  metric: string
  label: string
  target: number
  unit: string
  note?: string
}

function revalidate() {
  revalidatePath('/dashboard')
  revalidatePath('/chantiers/equipes')
}

export async function upsertMemberGoal(input: GoalUpsertInput): Promise<{ error?: string }> {
  if (!input.member_id && !input.membership_id) return { error: 'member_id ou membership_id requis.' }
  if (input.member_id && input.membership_id) return { error: 'member_id et membership_id sont exclusifs.' }

  const denied = await requirePermission('settings.edit_goals')
  if (denied) return { error: denied }

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }

  const { data: { user } } = await supabase.auth.getUser()

  const conflictCol = input.member_id
    ? 'member_id,period_year,period_month,metric'
    : 'membership_id,period_year,period_month,metric'

  const { error } = await supabase
    .from('member_goals')
    .upsert({
      organization_id: orgId,
      member_id: input.member_id ?? null,
      membership_id: input.membership_id ?? null,
      period_year: input.period_year,
      period_month: input.period_month,
      metric: input.metric,
      label: input.label,
      target: input.target,
      unit: input.unit,
      note: input.note ?? null,
      created_by: user?.id ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: conflictCol })

  if (error) return { error: error.message }
  revalidate()
  return {}
}

export type BulkTarget =
  | { kind: 'intervenant'; id: string }
  | { kind: 'org'; membership_id: string }

/** Applique le même objectif à une liste hétérogène de membres (bulk). */
export async function bulkUpsertMemberGoals(
  targets: BulkTarget[],
  base: Omit<GoalUpsertInput, 'member_id' | 'membership_id'>,
): Promise<{ error?: string }> {
  if (!targets.length) return {}

  const denied = await requirePermission('settings.edit_goals')
  if (denied) return { error: denied }

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }

  const { data: { user } } = await supabase.auth.getUser()
  const now = new Date().toISOString()

  // Upsert par lot : intervenants d'abord, puis membres org
  const intervenants = targets.filter(t => t.kind === 'intervenant')
  const orgMembers = targets.filter(t => t.kind === 'org')

  if (intervenants.length > 0) {
    const rows = intervenants.map(t => ({
      organization_id: orgId,
      member_id: (t as { kind: 'intervenant'; id: string }).id,
      membership_id: null,
      period_year: base.period_year,
      period_month: base.period_month,
      metric: base.metric,
      label: base.label,
      target: base.target,
      unit: base.unit,
      note: base.note ?? null,
      created_by: user?.id ?? null,
      updated_at: now,
    }))
    const { error } = await supabase
      .from('member_goals')
      .upsert(rows, { onConflict: 'member_id,period_year,period_month,metric' })
    if (error) return { error: error.message }
  }

  if (orgMembers.length > 0) {
    const rows = orgMembers.map(t => ({
      organization_id: orgId,
      member_id: null,
      membership_id: (t as { kind: 'org'; membership_id: string }).membership_id,
      period_year: base.period_year,
      period_month: base.period_month,
      metric: base.metric,
      label: base.label,
      target: base.target,
      unit: base.unit,
      note: base.note ?? null,
      created_by: user?.id ?? null,
      updated_at: now,
    }))
    const { error } = await supabase
      .from('member_goals')
      .upsert(rows, { onConflict: 'membership_id,period_year,period_month,metric' })
    if (error) return { error: error.message }
  }

  revalidate()
  return {}
}

export async function deleteMemberGoal(goalId: string): Promise<{ error?: string }> {
  const denied = await requirePermission('settings.edit_goals')
  if (denied) return { error: denied }

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }

  const { error } = await supabase
    .from('member_goals')
    .delete()
    .eq('id', goalId)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }
  revalidate()
  return {}
}

export type GoalDisplayRow = {
  id: string
  member_id: string | null
  membership_id: string | null
  period_year: number
  period_month: number
  metric: string
  label: string | null
  target: number
  unit: string | null
  note: string | null
  display_name: string
  display_sub: string | null
}

/** Charge les objectifs d'un mois depuis le client (Server Action). */
export async function fetchMemberGoalsByMonth(year: number, month: number): Promise<{ data?: GoalDisplayRow[]; error?: string }> {
  const denied = await requirePermission('settings.edit_goals')
  if (denied) return { error: denied }

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }

  // 1. Goals + intervenants terrain (FK directe, pas de problème de join)
  const { data, error } = await supabase
    .from('member_goals')
    .select(`
      id, member_id, membership_id, period_year, period_month, metric, label, target, unit, note,
      intervenant:chantier_equipe_membres(name, prenom, role_label),
      membership:memberships(id, user_id, roles(name))
    `)
    .eq('organization_id', orgId)
    .eq('period_year', year)
    .eq('period_month', month)
    .order('created_at', { ascending: true })

  if (error) return { error: error.message }
  if (!data?.length) return { data: [] }

  // 2. Récupère les profils pour les membership_id concernés
  const userIds = (data as any[])
    .map(r => {
      const m = Array.isArray(r.membership) ? r.membership[0] : r.membership
      return m?.user_id ?? null
    })
    .filter(Boolean)

  const profileById: Record<string, string> = {}
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', userIds)
    for (const p of profiles ?? []) {
      profileById[p.id] = p.full_name ?? ''
    }
  }

  const rows: GoalDisplayRow[] = (data as any[]).map(row => {
    let display_name = ''
    let display_sub: string | null = null

    if (row.intervenant) {
      display_name = [row.intervenant.prenom, row.intervenant.name].filter(Boolean).join(' ')
      display_sub = row.intervenant.role_label ?? 'Intervenant'
    } else {
      const membership = Array.isArray(row.membership) ? row.membership[0] : row.membership
      const role = membership ? (Array.isArray(membership.roles) ? membership.roles[0] : membership.roles) : null
      display_name = profileById[membership?.user_id] ?? ''
      display_sub = role?.name ?? null
    }

    return {
      id: row.id,
      member_id: row.member_id,
      membership_id: row.membership_id,
      period_year: row.period_year,
      period_month: row.period_month,
      metric: row.metric,
      label: row.label,
      target: row.target,
      unit: row.unit,
      note: row.note,
      display_name,
      display_sub,
    }
  })

  return { data: rows }
}
