import { createClient } from '@supabase/supabase-js'

export function isOperatorModeEnabled(): boolean {
  return process.env.OPERATOR_MODE === 'true'
}

export function createOperatorAdminClient() {
  const url = process.env.OPERATOR_SUPABASE_URL
  const key = process.env.OPERATOR_SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error('Operator Supabase env vars missing')
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

