import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = vi.hoisted(() => ({ user: { id: 'invited-user' } as { id: string } | null }))
vi.mock('@/lib/supabase/config', () => ({
  getSupabaseRuntimeConfig: () => ({ supabaseUrl: 'http://127.0.0.1:55321', supabaseAnonKey: 'local-test-only' }),
}))
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { onboarding_done: false } }) }) }) }),
  }),
}))
import { middleware } from '@/middleware'

beforeEach(() => {
  state.user = { id: 'invited-user' }
  vi.stubEnv('SELF_SERVICE_MODE', 'false')
})
afterEach(() => vi.unstubAllEnvs())

describe('invitation access before organization onboarding', () => {
  it.each(['/invite/accept', '/invite/setup'])('lets %s validate its invitation instead of losing its error to onboarding', async path => {
    const response = await middleware(new NextRequest(`https://atelier.example${path}?invitation_id=fixture`))
    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
  })

  it('still sends an unfinished account to onboarding before business access', async () => {
    const response = await middleware(new NextRequest('https://atelier.example/dashboard'))
    expect(response.status).toBe(307)
    expect(new URL(response.headers.get('location')!).pathname).toBe('/onboarding')
  })

  it('still requires authentication and explains an expired business session', async () => {
    state.user = null
    const response = await middleware(new NextRequest('https://atelier.example/finances', {
      headers: { cookie: 'sb-fixture-auth-token=expired' },
    }))
    const target = new URL(response.headers.get('location')!)
    expect(response.status).toBe(307)
    expect(target.pathname).toBe('/login')
    expect(target.searchParams.get('session')).toBe('expired')
  })
})
