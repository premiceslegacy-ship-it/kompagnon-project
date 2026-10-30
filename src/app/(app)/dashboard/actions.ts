'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'

export async function dismissSetupChecklist(): Promise<void> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return

  const { error } = await supabase
    .from('organizations')
    .update({ setup_checklist_dismissed: true })
    .eq('id', orgId)

  if (!error) revalidatePath('/dashboard')
}
