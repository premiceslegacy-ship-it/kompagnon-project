import { APP_NAME } from '@/lib/brand'
import { createAdminClient } from '@/lib/supabase/admin'

export type PwaBrand = {
  name: string
  logoUrl: string | null
}

export const PWA_ICON_SIZES = [180, 192, 512] as const

export function getAppBaseUrl(origin?: string): string {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || origin || ''
}

export function appIconPath(size: number): string {
  return `/api/app-icon?size=${size}`
}

export function absoluteAppIconUrl(size: number, origin?: string): string {
  return `${getAppBaseUrl(origin)}${appIconPath(size)}`
}

export async function getPwaBrand(): Promise<PwaBrand> {
  try {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('organizations')
      .select('name, logo_url')
      .limit(1)
      .single()

    return {
      name: data?.name?.trim() || APP_NAME,
      logoUrl: data?.logo_url?.trim() || null,
    }
  } catch {
    return {
      name: APP_NAME,
      logoUrl: null,
    }
  }
}

