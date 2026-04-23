import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * Route de callback Supabase (PKCE).
 * Appelée après une inscription par email ou un clic sur magic link.
 * Supabase redirige ici avec un `code` à échanger contre une session.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  // `next` permet de rediriger vers une page spécifique post-auth
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Échec de l'échange de code → retour à la page de connexion avec message
  return NextResponse.redirect(`${origin}/login?error=auth_callback_error`)
}
