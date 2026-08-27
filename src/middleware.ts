import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseRuntimeConfig } from '@/lib/supabase/config'
import { hasActiveAccess, entitlementFromDb } from '@/lib/subscription-access'

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
  '/api/auth/member-verify',
  // PDF à accès public par token de signature (page /sign/[token] et /contrats/signer) :
  // le handler valide lui-même signature_token en base avant de servir le document.
  '/api/pdf/quote',
  '/api/pdf/contract',
  // Routes serveur-à-serveur : elles portent leur propre authentification
  // (x-cron-secret ou signature HMAC x-operator-signature) et n'ont jamais
  // de session utilisateur. Sans ces exclusions, le middleware les redirige
  // vers /login (307) et elles ne s'exécutent jamais en production — ça a
  // cassé silencieusement ingest/config-sync jusqu'au 2026-08-08 (seul
  // /api/operator/cron était exclu, pas ingest ni config-sync).
  '/api/cron',
  '/api/webhooks',
  '/api/operator',
  // Callback OAuth Super PDP (cote cockpit) : Super PDP y redirige l'utilisateur
  // cross-domain apres autorisation, sans cookie de session Atelier. Le state
  // signe HMAC (src/lib/super-pdp/oauth-state.ts) est la seule protection —
  // meme categorie de piege que le commentaire ci-dessus sur ingest/config-sync.
  '/api/einvoicing',
]

const publicExactRoutes = [
  '/legal',
  '/privacy',
  '/terms',
  '/api/manifest',
  '/api/app-icon',
  // Appels serveur-à-serveur signés par l'instance mutualisée. Le portail
  // Stripe reste volontairement absent : il exige la session utilisateur.
  '/api/stripe/checkout-session',
  '/api/stripe/cancel-subscription',
]

const lockedAccessPrefixes = [
  '/activation',
  '/api/operator',
  '/api/webhooks',
  '/api/cron',
  '/api/manifest',
  '/api/app-icon',
  '/api/einvoicing',
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
  let isOnboarded = false
  if (
    user &&
    !isPathOrChild(pathname, '/onboarding') &&
    !isPathOrChild(pathname, '/login') &&
    !isPathOrChild(pathname, '/auth')
  ) {
    const onboardedCookie = request.cookies.get('atelier_onboarded')
    const cookieIsValid = onboardedCookie?.value === user.id
    isOnboarded = cookieIsValid

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
        isOnboarded = true
        supabaseResponse.cookies.set('atelier_onboarded', user.id, {
          httpOnly: true,
          sameSite: 'strict',
          maxAge: 60 * 60 * 24 * 365,
          path: '/',
        })
      }
    }
  }

  // Le verrou commercial est propre à l'instance self-service. Les instances
  // dédiées historiques ne créent aucune ligne d'entitlement et conservent donc
  // exactement leur comportement actuel.
  if (
    process.env.SELF_SERVICE_MODE === 'true'
    && user
    && isOnboarded
    && !isPublicRoute
    && !lockedAccessPrefixes.some((prefix) => isPathOrChild(pathname, prefix))
  ) {
    const { data: membership } = await supabase
      .from('memberships')
      .select('organization_id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single()

    const { data: entitlementRow } = membership?.organization_id
      ? await supabase
        .from('organization_entitlements')
        .select('organization_id, access_status, effective_tier, preferred_tier, trial_started_at, trial_ends_at, access_ends_at, updated_at')
        .eq('organization_id', membership.organization_id)
        .maybeSingle()
      : { data: null }
    const entitlement = entitlementRow
      ? entitlementFromDb(entitlementRow as Record<string, unknown>)
      : null

    if (!hasActiveAccess(entitlement)) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return NextResponse.json(
          { error: 'access_locked', activation_url: '/activation' },
          { status: 403 },
        )
      }
      const url = request.nextUrl.clone()
      url.pathname = '/activation'
      url.search = ''
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
