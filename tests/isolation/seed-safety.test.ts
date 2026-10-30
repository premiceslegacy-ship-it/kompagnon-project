import { describe, expect, it } from 'vitest'
import { isLocalSupabaseUrl, seedOwnedOrganizationIds } from './seed-safety'

describe('seed safety', () => {
  it('accepts only parsed loopback Supabase origins', () => {
    expect(isLocalSupabaseUrl('http://127.0.0.1:54321')).toBe(true)
    expect(isLocalSupabaseUrl('http://localhost:54321')).toBe(true)
    expect(isLocalSupabaseUrl('http://[::1]:54321')).toBe(true)
    expect(isLocalSupabaseUrl('https://127.0.0.1.attacker.example')).toBe(false)
    expect(isLocalSupabaseUrl('https://localhost.attacker.example')).toBe(false)
    expect(isLocalSupabaseUrl('http://127.0.0.1@attacker.example')).toBe(false)
    expect(isLocalSupabaseUrl('https://attacker.example/localhost/127.0.0.1')).toBe(false)
    expect(isLocalSupabaseUrl('ftp://localhost:54321')).toBe(false)
  })

  it('never treats a viewer membership in tenant A as an organization to delete', () => {
    expect(seedOwnedOrganizationIds([
      { organization_id: 'tenant-a', role_slug: 'viewer' },
    ], ['tenant-a'])).toEqual([])
  })

  it('cleans a viewer-owned trigger organization but protects tenant A even if roles are inconsistent', () => {
    expect(seedOwnedOrganizationIds([
      { organization_id: 'viewer-trigger-org', role_slug: 'owner' },
      { organization_id: 'tenant-a', role_slug: 'owner' },
      { organization_id: 'tenant-a', role_slug: 'viewer' },
    ], ['tenant-a'])).toEqual(['viewer-trigger-org'])
  })
})
