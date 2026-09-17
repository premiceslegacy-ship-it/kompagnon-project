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
  getMaintenanceReport,
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

// Limite haute plutôt que le défaut (10) : la section "Marge par chantier"
// a besoin de tous les chantiers actifs de la période, pas juste le top 10.
const ALL_CHANTIERS_LIMIT = 9999

export async function fetchMonthlyDataAction(year: number, month: number) {
  const hoursMonth = month
  const [monthlyReport, hoursReport, topClients, topChantiers, maintenanceReport, objectives] = await Promise.all([
    getMonthlyReport(year, month),
    getHoursReport(year, hoursMonth),
    getTopClients(year, hoursMonth),
    getTopChantiers(year, hoursMonth, ALL_CHANTIERS_LIMIT),
    getMaintenanceReport(year, hoursMonth),
    getMonthlyObjectives(year, month),
  ])
  return { monthlyReport, hoursReport, topClients, topChantiers, maintenanceReport, objectives }
}

export async function fetchAnnualDataAction(year: number) {
  const [annualReport, hoursReport, topClients, topChantiers, maintenanceReport, objectives] = await Promise.all([
    getAnnualReport(year),
    getHoursReport(year),
    getTopClients(year),
    getTopChantiers(year, undefined, ALL_CHANTIERS_LIMIT),
    getMaintenanceReport(year),
    getAnnualObjectives(year),
  ])
  return { annualReport, hoursReport, topClients, topChantiers, maintenanceReport, objectives }
}
