import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth }),
}))

import { GET } from '@/app/auth/callback/route'

const origin = 'https://atelier.example'

beforeEach(() => {
  auth.exchangeCodeForSession.mockReset().mockResolvedValue({ error: null })
  auth.verifyOtp.mockReset().mockResolvedValue({ error: null })
})

async function callback(next: string | null, flow: 'pkce' | 'otp' = 'pkce') {
  const url = new URL('/auth/callback', origin)
  if (flow === 'pkce') url.searchParams.set('code', 'local-code')
  else {
    url.searchParams.set('token_hash', 'local-hash')
    url.searchParams.set('type', 'invite')
  }
  if (next !== null) url.searchParams.set('next', next)
  return GET(new Request(url))
}

describe.each(['pkce', 'otp'] as const)('redirection après authentification %s', (flow) => {
  it('préserve le chemin interne, ses paramètres et son fragment', async () => {
    const response = await callback('/sign/abc?x=1#signature', flow)
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(`${origin}/sign/abc?x=1#signature`)
  })

  it.each([
    '@evil.example',
    'https://evil.example/path',
    '//evil.example/path',
    '/\\evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    '/\r/evil.example',
  ])('refuse la destination externe ou ambiguë %j', async (next) => {
    const response = await callback(next, flow)
    expect(response.headers.get('location')).toBe(`${origin}/dashboard`)
  })

  it('utilise la destination par défaut en l’absence de next', async () => {
    expect((await callback(null, flow)).headers.get('location')).toBe(`${origin}/dashboard`)
  })
})

it('ne redirige pas vers next si l’échange de session échoue', async () => {
  auth.exchangeCodeForSession.mockResolvedValue({ error: { message: 'invalid code' } })
  expect((await callback('/settings')).headers.get('location'))
    .toBe(`${origin}/login?error=auth_callback_error`)
})

it('refuse un type OTP inconnu avant de vérifier le token', async () => {
  const response = await GET(new Request(`${origin}/auth/callback?token_hash=x&type=unknown&next=/settings`))
  expect(auth.verifyOtp).not.toHaveBeenCalled()
  expect(response.headers.get('location')).toBe(`${origin}/login?error=auth_callback_error`)
})
it('vérifie un lien d’invitation par token_hash sans dépendre du vérificateur PKCE', async () => {
  const invitationId = '4a2483d1-7364-4f58-94fb-f275d64d637d'
  const response = await callback(`/invite/accept?invitation_id=${invitationId}`, 'otp')
  expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: 'local-hash', type: 'invite' })
  expect(auth.exchangeCodeForSession).not.toHaveBeenCalled()
  expect(response.headers.get('location')).toBe(`${origin}/invite/accept?invitation_id=${invitationId}`)
})

it.each([
  '/auth/callback?code=one&code=two',
  '/auth/callback?code=one&token_hash=two&type=invite',
])('refuse les identifiants de callback ambigus : %s', async path => {
  const response = await GET(new Request(new URL(path, origin)))
  expect(auth.verifyOtp).not.toHaveBeenCalled()
  expect(auth.exchangeCodeForSession).not.toHaveBeenCalled()
  expect(response.headers.get('location')).toBe(`${origin}/login?error=auth_callback_error`)
})
