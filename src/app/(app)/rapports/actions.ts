'use server'

import { revalidatePath } from 'next/cache'
import {
  upsertAnnualObjectives,
  upsertMonthlyObjectives,
  getMonthlyReport,
  getAnnualReport,
  getHoursReport,
  getTopClients,
  getTopChantiers,
  getAnnualObjectives,
  getMonthlyObjectives,
} from '@/lib/data/queries/reporting'
import type { AnnualObjectives, MonthlyObjectives, CustomObjective } from '@/lib/data/queries/reporting'

export async function saveObjectivesAction(
  year: number,
  data: Omit<AnnualObjectives, 'year' | 'customs'> & { customs: CustomObjective[] }
): Promise<{ error: string | null }> {
  const result = await upsertAnnualObjectives(year, data)
  if (!result.error) {
    revalidatePath('/rapports')
  }
  return result
}

export async function saveMonthlyObjectivesAction(
  year: number,
  month: number,
  data: Omit<MonthlyObjectives, 'year' | 'month' | 'customs'> & { customs: CustomObjective[] }
): Promise<{ error: string | null }> {
  const result = await upsertMonthlyObjectives(year, month, data)
  if (!result.error) {
    revalidatePath('/rapports')
  }
  return result
}

export async function fetchMonthlyDataAction(year: number, month: number) {
  const hoursMonth = month
  const [monthlyReport, hoursReport, topClients, topChantiers, objectives] = await Promise.all([
    getMonthlyReport(year, month),
    getHoursReport(year, hoursMonth),
    getTopClients(year, hoursMonth),
    getTopChantiers(year, hoursMonth),
    getMonthlyObjectives(year, month),
  ])
  return { monthlyReport, hoursReport, topClients, topChantiers, objectives }
}

export async function fetchAnnualDataAction(year: number) {
  const [annualReport, hoursReport, topClients, topChantiers, objectives] = await Promise.all([
    getAnnualReport(year),
    getHoursReport(year),
    getTopClients(year),
    getTopChantiers(year),
    getAnnualObjectives(year),
  ])
  return { annualReport, hoursReport, topClients, topChantiers, objectives }
}
