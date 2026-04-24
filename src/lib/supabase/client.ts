import { createBrowserClient } from '@supabase/ssr'
import { getBrowserRuntimeConfig } from './config'

let browserClient: ReturnType<typeof createBrowserClient> | undefined

export function createClient() {
  if (browserClient) return browserClient

  const { supabaseUrl, supabaseAnonKey } = getBrowserRuntimeConfig()

  browserClient = createBrowserClient(supabaseUrl, supabaseAnonKey)
  return browserClient
}
