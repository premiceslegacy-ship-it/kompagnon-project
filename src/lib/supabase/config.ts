export type AppRuntimeConfig = {
  supabaseUrl: string
  supabaseAnonKey: string
}

function readEnv(key: string, legacyKey?: string): string | undefined {
  const runtimeValue = process.env[key]
  if (runtimeValue) return runtimeValue

  if (legacyKey) {
    const legacyValue = process.env[legacyKey]
    if (legacyValue) return legacyValue
  }

  return undefined
}

export function getSupabaseRuntimeConfig(): AppRuntimeConfig {
  const supabaseUrl = readEnv('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL')
  const supabaseAnonKey = readEnv('SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY')

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing Supabase runtime config. Set SUPABASE_URL and SUPABASE_ANON_KEY (legacy NEXT_PUBLIC_* fallback still supported temporarily).'
    )
  }

  return {
    supabaseUrl,
    supabaseAnonKey,
  }
}

export function getPublicRuntimeConfig(): AppRuntimeConfig {
  return getSupabaseRuntimeConfig()
}

export function getBrowserRuntimeConfig(): AppRuntimeConfig {
  const config = window.__APP_RUNTIME_CONFIG__

  if (!config?.supabaseUrl || !config?.supabaseAnonKey) {
    throw new Error('Missing browser runtime config. The root layout must inject window.__APP_RUNTIME_CONFIG__.')
  }

  return config
}

export function serializeRuntimeConfig(config: AppRuntimeConfig): string {
  return JSON.stringify(config)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}
