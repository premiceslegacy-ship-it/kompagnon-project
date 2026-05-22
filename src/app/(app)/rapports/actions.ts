'use server'

import { revalidatePath } from 'next/cache'
import { upsertAnnualObjectives } from '@/lib/data/queries/reporting'
import type { AnnualObjectives, CustomObjective } from '@/lib/data/queries/reporting'

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
