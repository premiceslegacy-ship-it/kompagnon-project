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
          <div
            style={{
              alignItems: 'center',
              background: '#0a0a0a',
              borderRadius: size * 0.18,
              color: '#ffffff',
              display: 'flex',
              fontSize: size * 0.56,
              fontWeight: 800,
              height: '82%',
              justifyContent: 'center',
              letterSpacing: 0,
              width: '82%',
            }}
          >
            A
          </div>
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

