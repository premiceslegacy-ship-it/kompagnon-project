import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'
import { getPwaBrand, PWA_ICON_SIZES } from '@/lib/pwa'

export const dynamic = 'force-dynamic'

function resolveIconSize(request: NextRequest): number {
  const requestedSize = Number(request.nextUrl.searchParams.get('size'))
  return PWA_ICON_SIZES.includes(requestedSize as (typeof PWA_ICON_SIZES)[number])
    ? requestedSize
    : 192
}

export async function GET(request: NextRequest) {
  const size = resolveIconSize(request)
  const brand = await getPwaBrand()

  return new ImageResponse(
    (
      <div
        style={{
          alignItems: 'center',
          background: '#ffffff',
          display: 'flex',
          height: '100%',
          justifyContent: 'center',
          width: '100%',
        }}
      >
        {brand.logoUrl ? (
          <img
            alt={brand.name}
            src={brand.logoUrl}
            style={{
              height: '82%',
              objectFit: 'contain',
              width: '82%',
            }}
          />
        ) : (
          <img
            alt="Atelier"
            src={`${(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '')}/icon-192.png`}
            style={{ height: '100%', width: '100%', objectFit: 'contain' }}
          />
        )}
      </div>
    ),
    {
      width: size,
      height: size,
      headers: {
        'Cache-Control': 'public, max-age=3600',
      },
    },
  )
}

