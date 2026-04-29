import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from './clients'

export type JalonStatus = 'pending' | 'in_progress' | 'completed' | 'invoiced'

export type ChantierJalon = {
  id: string
  chantier_id: string
  position: number
  title: string
  description: string | null
  acompte_pct: number
  status: JalonStatus
  completion_report: string | null
  completed_at: string | null
  invoice_id: string | null
  created_at: string
  taches: Array<{ id: string; title: string; status: string }>
  taches_total: number
  taches_done: number
}

export async function getJalonsForChantier(chantierId: string): Promise<ChantierJalon[]> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  const { data: jalons, error } = await supabase
    .from('chantier_jalons')
    .select('id, chantier_id, position, title, description, acompte_pct, status, completion_report, completed_at, invoice_id, created_at')
    .eq('chantier_id', chantierId)
    .eq('organization_id', orgId)
    .order('position', { ascending: true })

  if (error) {
    console.error('[getJalonsForChantier]', error)
    return []
  }
  if (!jalons?.length) return []

  const ids = jalons.map(j => j.id)
  const { data: taches } = await supabase
    .from('chantier_taches')
    .select('id, title, status, jalon_id')
    .in('jalon_id', ids)

  const tachesByJalon: Record<string, Array<{ id: string; title: string; status: string }>> = {}
  for (const t of (taches ?? []) as any[]) {
    if (!t.jalon_id) continue
    ;(tachesByJalon[t.jalon_id] ??= []).push({ id: t.id, title: t.title, status: t.status })
  }

  return jalons.map((j: any) => {
    const list = tachesByJalon[j.id] ?? []
    return {
      ...j,
      taches: list,
      taches_total: list.length,
      taches_done: list.filter(t => t.status === 'termine').length,
    }
  })
}
