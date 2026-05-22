import { redirect } from 'next/navigation'
import { getUserPermissions } from '@/lib/data/queries/membership'
import {
  getMonthlyReport,
  getAnnualReport,
  getHoursReport,
  getTopClients,
  getTopChantiers,
  getAnnualObjectives,
  getMembersWithoutRate,
} from '@/lib/data/queries/reporting'
import type { MemberWithoutRate } from '@/lib/data/queries/reporting'
import RapportsClient from './RapportsClient'

function currentYM() {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

export default async function RapportsPage({
  searchParams,
}: {
  searchParams?: { vue?: string; periode?: string; heures_periode?: string }
}) {
  const perms = await getUserPermissions()
  if (!perms.has('*') && !perms.has('dashboard.view_ca')) {
    redirect('/dashboard')
  }

  const vue = searchParams?.vue === 'annee' ? 'annee' : 'mois'
  const { year: currentYear, month: currentMonth } = currentYM()

  let year = currentYear
  let month = currentMonth

  if (vue === 'mois' && searchParams?.periode && /^\d{4}-\d{2}$/.test(searchParams.periode)) {
    const [y, m] = searchParams.periode.split('-').map(Number)
    year = y; month = m
  } else if (vue === 'annee' && searchParams?.periode && /^\d{4}$/.test(searchParams.periode)) {
    year = parseInt(searchParams.periode)
  }

  // Les heures suivent toujours la période principale
  const hoursMonth = vue === 'mois' ? month : undefined

  const [monthlyReport, annualReport, hoursReport, topClients, topChantiers, objectives, membersWithoutRate] = await Promise.all([
    vue === 'mois' ? getMonthlyReport(year, month) : Promise.resolve(null),
    vue === 'annee' ? getAnnualReport(year) : Promise.resolve(null),
    getHoursReport(year, hoursMonth),
    getTopClients(year, hoursMonth),
    getTopChantiers(year, hoursMonth),
    getAnnualObjectives(year),
    getMembersWithoutRate(),
  ])

  return (
    <RapportsClient
      vue={vue}
      year={year}
      month={month}
      monthlyReport={monthlyReport}
      annualReport={annualReport}
      hoursReport={hoursReport}
      topClients={topClients}
      topChantiers={topChantiers}
      objectives={objectives}
      membersWithoutRate={membersWithoutRate ?? []}
    />
  )
}
