import { redirect } from 'next/navigation'
import { getUserPermissions } from '@/lib/data/queries/membership'
import {
  getMonthlyReport,
  getAnnualReport,
  getHoursReport,
  getTopClients,
  getTopChantiers,
  getAnnualObjectives,
  getMonthlyObjectives,
  getMembersWithoutRate,
} from '@/lib/data/queries/reporting'
import RapportsClient from './RapportsClient'

function currentYM() {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

export default async function RapportsPage({
  searchParams,
}: {
  searchParams?: { vue?: string; periode?: string }
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

  const hoursMonth = vue === 'mois' ? month : undefined

  const [monthlyReport, annualReport, hoursReport, topClients, topChantiers, annualObjectives, monthlyObjectives, membersWithoutRate] = await Promise.all([
    vue === 'mois' ? getMonthlyReport(year, month) : Promise.resolve(null),
    vue === 'annee' ? getAnnualReport(year) : Promise.resolve(null),
    getHoursReport(year, hoursMonth),
    getTopClients(year, hoursMonth),
    getTopChantiers(year, hoursMonth),
    getAnnualObjectives(year),
    vue === 'mois' ? getMonthlyObjectives(year, month) : Promise.resolve(null),
    getMembersWithoutRate(),
  ])

  return (
    <RapportsClient
      initialVue={vue}
      initialYear={year}
      initialMonth={month}
      initialMonthlyReport={monthlyReport}
      initialAnnualReport={annualReport}
      initialHoursReport={hoursReport}
      initialTopClients={topClients}
      initialTopChantiers={topChantiers}
      initialAnnualObjectives={annualObjectives}
      initialMonthlyObjectives={monthlyObjectives}
      membersWithoutRate={membersWithoutRate ?? []}
    />
  )
}
