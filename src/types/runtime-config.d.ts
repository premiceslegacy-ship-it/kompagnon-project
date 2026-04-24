import type { AppRuntimeConfig } from '@/lib/supabase/config'

declare global {
  interface Window {
    __APP_RUNTIME_CONFIG__?: AppRuntimeConfig
  }
}

export {}
