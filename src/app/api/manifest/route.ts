import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { APP_NAME, absoluteBrandAssetUrl } from '@/lib/brand'

export const dynamic = 'force-dynamic'

export async function GET() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? ''
  const fallbackIcon = absoluteBrandAssetUrl('/brand/atelier/monogramme-noir.svg') ?? `${appUrl}/brand/atelier/monogramme-noir.svg`

  let iconUrl = fallbackIcon
  let appName = APP_NAME

  try {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('organizations')
      .select('name, logo_url')
      .limit(1)
      .single()

    if (data?.name) appName = data.name
    if (data?.logo_url) iconUrl = data.logo_url
  } catch {
    // DB inaccessible — fallback Atelier
  }

  const manifest = {
    name: appName,
    short_name: appName,
    description: 'Gérez vos chantiers, vos finances et vos clients.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0a0a0a',
    theme_color: '#0a0a0a',
    icons: [
      {
        src: iconUrl,
        sizes: 'any',
        type: iconUrl.endsWith('.svg') ? 'image/svg+xml' : 'image/png',
        purpose: 'any maskable',
      },
    ],
  }

  return new NextResponse(JSON.stringify(manifest), {
    headers: {
      'Content-Type': 'application/manifest+json',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
