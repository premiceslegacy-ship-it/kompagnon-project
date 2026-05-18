import { NextResponse } from 'next/server'
import { absoluteAppIconUrl, getPwaBrand } from '@/lib/pwa'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const origin = new URL(request.url).origin
  const brand = await getPwaBrand()

  const manifest = {
    name: brand.name,
    short_name: brand.name,
    description: 'Gérez vos chantiers, vos finances et vos clients.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0a0a0a',
    theme_color: '#0a0a0a',
    icons: [
      {
        src: absoluteAppIconUrl(192, origin),
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: absoluteAppIconUrl(512, origin),
        sizes: '512x512',
        type: 'image/png',
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
