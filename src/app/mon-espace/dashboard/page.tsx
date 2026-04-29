import { redirect } from 'next/navigation'
import { getMemberSession } from '@/lib/auth/member-session'
import {
  getMemberByIdAdmin,
  getMemberPointages,
  getMemberPlannings,
} from '@/lib/data/queries/members'
import { createAdminClient } from '@/lib/supabase/admin'
import MonEspaceDashboardClient from './MonEspaceDashboardClient'

export default async function MonEspaceDashboardPage() {
  const session = await getMemberSession()
  if (!session) redirect('/mon-espace/request-access')

  const member = await getMemberByIdAdmin(session.memberId)
  if (!member) redirect('/mon-espace/request-access?error=invalid_token')

  // Mois en cours par défaut
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
  const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10)

  // Plannings : 3 prochaines semaines
  const today = now.toISOString().slice(0, 10)
  const in3Weeks = new Date(now.getTime() + 21 * 86_400_000).toISOString().slice(0, 10)

  const [pointages, plannings, orgRow] = await Promise.all([
    getMemberPointages(session.memberId, { dateFrom: monthStart, dateTo: monthEnd, useAdmin: true }),
    getMemberPlannings(session.memberId, { dateFrom: today, dateTo: in3Weeks, useAdmin: true }),
    createAdminClient().from('organizations').select('name').eq('id', member.organization_id).single(),
  ])

  // Liste des chantiers ouverts pour le formulaire de pointage
  const { data: chantiersRows } = await createAdminClient()
    .from('chantiers')
    .select('id, title, status')
    .eq('organization_id', member.organization_id)
    .in('status', ['en_cours', 'planifie', 'suspendu'])
    .order('title', { ascending: true })

  const chantiers = (chantiersRows ?? []).map(c => ({ id: c.id, title: c.title }))

  return (
    <MonEspaceDashboardClient
      member={member}
      organizationName={orgRow.data?.name ?? 'Mon espace'}
      pointages={pointages}
      plannings={plannings}
      chantiers={chantiers}
      monthStart={monthStart}
      monthEnd={monthEnd}
    />
  )
}
