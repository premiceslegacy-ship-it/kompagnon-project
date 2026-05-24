import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseRuntimeConfig } from '@/lib/supabase/config'

const publicRoutePrefixes = [
  '/login',
  '/auth',
  '/onboarding',
  '/invite',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/demande',
  '/sign',
  '/contrats/signer',
  '/mon-espace',
]

const publicExactRoutes = [
  '/legal',
  '/privacy',
  '/terms',
  '/api/manifest',
  '/api/app-icon',
]

function isPathOrChild(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })
  const { supabaseUrl, supabaseAnonKey } = getSupabaseRuntimeConfig()

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANT : Ne pas écrire de logique entre createServerClient et
  // supabase.auth.getUser(). Une erreur ici peut provoquer des déconnexions
  // aléatoires difficiles à déboguer.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Routes publiques (auth, pages legales, PWA, signatures et flux clients).
  const isPublicRoute =
    publicExactRoutes.includes(pathname) ||
    publicRoutePrefixes.some((prefix) => isPathOrChild(pathname, prefix))

  // 1. Pas de session → /login (sauf routes publiques)
  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // 2. /onboarding sans session → /login
  if (!user && pathname.startsWith('/onboarding')) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // 3. Utilisateur connecté : vérifier onboarding_done
  // Optimisation : on lit d'abord le cookie hint (posé après onboarding) pour éviter
  // une query BDD à chaque navigation. Si absent, on retombe sur la query profiles.
  if (
    user &&
    !isPathOrChild(pathname, '/onboarding') &&
    !isPathOrChild(pathname, '/login') &&
    !isPathOrChild(pathname, '/auth')
  ) {
    const onboardedCookie = request.cookies.get('atelier_onboarded')
    const cookieIsValid = onboardedCookie?.value === user.id

    if (!cookieIsValid) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('onboarding_done')
        .eq('id', user.id)
        .single()

      if (profile && profile.onboarding_done === false) {
        const url = request.nextUrl.clone()
        url.pathname = '/onboarding'
        return NextResponse.redirect(url)
      }

      if (profile?.onboarding_done === true) {
        supabaseResponse.cookies.set('atelier_onboarded', user.id, {
          httpOnly: true,
          sameSite: 'strict',
          maxAge: 60 * 60 * 24 * 365,
          path: '/',
        })
      }
    }
  }

  // IMPORTANT : Retourner supabaseResponse tel quel pour maintenir la
  // synchronisation des cookies entre navigateur et serveur.
  return supabaseResponse
}


export const config = {
  matcher: [
    /*
     * Intercepte toutes les routes SAUF :
     * - _next/static  (fichiers statiques Next.js)
     * - _next/image   (optimisation d'images)
     * - favicon.ico
     * - fichiers images (svg, png, jpg, jpeg, gif, webp)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
