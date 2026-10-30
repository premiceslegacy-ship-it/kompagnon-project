import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// `type` était casté sans liste : une valeur inconnue partait à verifyOtp.
const ALLOWED_TYPES = new Set(['invite', 'magiclink', 'email', 'recovery', 'signup'])

/**
 * N'accepte qu'un chemin interne. `next=@evil.com` produisait
 * `https://app.client.fr@evil.com` (hôte = evil.com) : l'utilisateur était
 * connecté puis redirigé vers un site tiers.
 */
function safeNext(rawNext: string | null): string {
  const candidate = (rawNext ?? '/dashboard').trim()
  if (!candidate.startsWith('/')) return '/dashboard'
  if (candidate.startsWith('//') || candidate.startsWith('/\\')) return '/dashboard'
  // WHATWG URL supprime notamment TAB, CR et LF avant de résoudre l'hôte :
  // « /\t/evil.example » devient une URL protocole-relative si on le laisse passer.
  if (/[\u0000-\u001f\u007f]/.test(candidate)) return '/dashboard'
  return candidate
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const next = safeNext(searchParams.get('next'))

  const supabase = await createClient()

  // PKCE flow (magic link généré via generateLink)
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(new URL(next, origin))
  }

  // OTP flow (token_hash) - utilisé par les liens d'invitation Supabase
  if (token_hash && type && ALLOWED_TYPES.has(type)) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash,
      type: type as 'invite' | 'magiclink' | 'email' | 'recovery' | 'signup',
    })
    if (!error) return NextResponse.redirect(new URL(next, origin))
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_error`)
}
