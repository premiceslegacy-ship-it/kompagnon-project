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
  const codeValues = searchParams.getAll('code')
  const tokenHashValues = searchParams.getAll('token_hash')
  const typeValues = searchParams.getAll('type')
  const nextValues = searchParams.getAll('next')
  const hasAmbiguousCredentials =
    codeValues.length > 1
    || tokenHashValues.length > 1
    || typeValues.length > 1
    || nextValues.length > 1
    || (codeValues.length > 0 && tokenHashValues.length > 0)
  if (hasAmbiguousCredentials) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_error`)
  }

  const code = codeValues[0] ?? null
  const token_hash = tokenHashValues[0] ?? null
  const type = typeValues[0] ?? null
  const next = safeNext(nextValues[0] ?? null)
  const supabase = await createClient()

  // PKCE links remain supported, but invitations use token_hash directly so
  // they do not depend on a verifier cookie from the browser that requested it.
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(new URL(next, origin))
  } else if (token_hash && type && ALLOWED_TYPES.has(type)) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash,
      type: type as 'invite' | 'magiclink' | 'email' | 'recovery' | 'signup',
    })
    if (!error) return NextResponse.redirect(new URL(next, origin))
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_error`)
}
