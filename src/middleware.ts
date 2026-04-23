import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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

  // Routes publiques (auth + flux mot de passe + invitations)
  const isAuthRoute =
    pathname.startsWith('/login') ||
    pathname.startsWith('/auth') ||
    pathname.startsWith('/onboarding') ||
    pathname.startsWith('/invite') ||
    pathname.startsWith('/forgot-password') ||
    pathname.startsWith('/reset-password') ||
    pathname.startsWith('/verify-email') ||
    pathname.startsWith('/request') ||
    pathname.startsWith('/demande')

  // 1. Pas de session → /login (sauf routes publiques)
  if (!user && !isAuthRoute) {
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
  if (user && !pathname.startsWith('/onboarding') && !pathname.startsWith('/login') && !pathname.startsWith('/auth')) {
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
