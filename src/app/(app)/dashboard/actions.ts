'use server'

import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'

export async function dismissSetupChecklist(): Promise<void> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return

  await supabase
    .from('organizations')
    .update({ setup_checklist_dismissed: true })
    .eq('id', orgId)
}
