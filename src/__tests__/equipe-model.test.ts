import { describe, expect, it } from 'vitest'
import { canChangeRole, canRemove, enabledCount, groupPermissions, isValidInviteEmail, memberDescription, memberName, permissionsChanged, permissionSummary, roleDisplayName } from '@/app/(app)/settings/equipeModel'
import type { Permission } from '@/lib/data/queries/roles'

const perm = (key: string, category: string): Permission => ({ key, label: key, category, position: 0 })

describe('équipe : membres', () => {
  it('affiche le nom, sinon l’email, et le rôle du propriétaire en français', () => {
    expect(memberName({ full_name: 'Ana Bo', email: 'a@x.fr' })).toBe('Ana Bo')
    expect(memberName({ full_name: ' ', email: 'a@x.fr' })).toBe('a@x.fr')
    expect(roleDisplayName({ role_slug: 'owner', role_name: 'Dirigeant' })).toBe('Propriétaire')
    expect(roleDisplayName({ role_slug: 'admin', role_name: 'Admin' })).toBe('Admin')
  })

  it('décrit un membre par son poste et son email', () => {
    expect(memberDescription({ job_title: 'Chef', email: 'a@x.fr', full_name: 'Ana' })).toBe('Chef · a@x.fr')
    expect(memberDescription({ job_title: null, email: 'a@x.fr', full_name: 'Ana' })).toBe('a@x.fr')
    expect(memberDescription({ job_title: null, email: 'a@x.fr', full_name: null })).toBe('')
  })

  it('ne laisse jamais modifier ni retirer le propriétaire', () => {
    const all = { canEditRoles: true, canRemoveMembers: true }
    expect(canChangeRole({ role_slug: 'owner' }, all)).toBe(false)
    expect(canRemove({ role_slug: 'owner' }, all)).toBe(false)
    expect(canChangeRole({ role_slug: 'member' }, all)).toBe(true)
    expect(canRemove({ role_slug: 'member' }, { canEditRoles: true, canRemoveMembers: false })).toBe(false)
  })

  it('valide l’email d’invitation', () => {
    expect(isValidInviteEmail('a@b.fr')).toBe(true)
    expect(isValidInviteEmail('a@b')).toBe(false)
    expect(isValidInviteEmail('')).toBe(false)
  })
})

describe('rôles : permissions', () => {
  const all = [perm('a', 'devis'), perm('b', 'devis'), perm('c', 'chantiers')]

  it('regroupe par catégorie et compte les droits activés', () => {
    const groups = groupPermissions(all)
    expect(groups.map(g => g.category)).toEqual(['devis', 'chantiers'])
    expect(enabledCount(groups[0].perms, { a: true, b: false })).toBe(1)
    expect(permissionSummary(groups[0].perms, { a: true, b: true })).toBe('2 sur 2')
    expect(permissionSummary(groups[1].perms, undefined)).toBe('0 sur 1')
  })

  it('détecte un changement en traitant une clé absente comme désactivée', () => {
    expect(permissionsChanged({ a: true }, { a: true, b: false })).toBe(false)
    expect(permissionsChanged({ a: true }, { a: false })).toBe(true)
    expect(permissionsChanged(undefined, { a: true })).toBe(true)
  })
})
