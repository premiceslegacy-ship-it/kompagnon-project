import { isOperatorEmailAllowed } from '@/lib/operator'
import { createClient } from '@/lib/supabase/server'
import { isOperatorModeEnabled } from '@/lib/supabase/operator'

export async function getOperatorUser() {
  if (!isOperatorModeEnabled()) return null

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.email || !isOperatorEmailAllowed(user.email)) {
    return null
  }

  return user
}
