import { describe, expect, it } from 'vitest'
import { canOpenTab, groupTitleOf, isSettingsTab, profileDirty, profileInitials, settingsGroups } from '@/app/(app)/settings/settingsModel'

const all = { canEditOrg: true, canEditRoles: true, canConfigureEinvoicing: true, isOwner: true }
const counts = { members: 3, roles: 4 }

describe('réglages : liste groupée', () => {
  it('montre toutes les entrées à un propriétaire', () => {
    const groups = settingsGroups(all, counts)
    expect(groups.map(g => g.title)).toEqual(['Compte', 'Entreprise', 'Documents et relances', 'Équipe et rôles', 'Abonnement', 'Données'])
    expect(groups.flatMap(g => g.entries).map(e => e.tab)).toHaveLength(14)
  })

  it('masque ce que les droits ne permettent pas, sans groupe vide', () => {
    const groups = settingsGroups({ canEditOrg: false, canEditRoles: false, canConfigureEinvoicing: false, isOwner: false }, counts)
    expect(groups.map(g => g.title)).toEqual(['Compte', 'Documents et relances', 'Équipe et rôles', 'Données'])
    const tabs = groups.flatMap(g => g.entries.map(e => e.tab))
    expect(tabs).not.toContain('entreprise')
    expect(tabs).not.toContain('legal')
    expect(tabs).not.toContain('paiement')
    expect(tabs).not.toContain('devis')
    expect(tabs).not.toContain('roles')
    expect(tabs).not.toContain('abonnement')
    expect(tabs).not.toContain('facturation')
  })

  it('compte les membres et les rôles au singulier et au pluriel', () => {
    const team = (m: number, r: number) => settingsGroups(all, { members: m, roles: r }).flatMap(g => g.entries)
    expect(team(1, 1).find(e => e.tab === 'equipe')!.description).toBe('1 membre, invitations')
    expect(team(1, 1).find(e => e.tab === 'roles')!.description).toBe('1 rôle')
    expect(team(3, 4).find(e => e.tab === 'roles')!.description).toBe('4 rôles')
  })

  it('valide les onglets demandés et trouve leur groupe', () => {
    expect(isSettingsTab('roles')).toBe(true)
    expect(isSettingsTab('nimportequoi')).toBe(false)
    expect(isSettingsTab(null)).toBe(false)
    expect(canOpenTab('roles', { ...all, canEditRoles: false }, counts)).toBe(false)
    expect(canOpenTab('profil', { canEditOrg: false, canEditRoles: false, canConfigureEinvoicing: false, isOwner: false }, counts)).toBe(true)
    expect(groupTitleOf('integration', all, counts)).toBe('Documents et relances')
  })

  it('détecte un profil modifié et calcule les initiales', () => {
    const saved = { first_name: 'Samuel', last_name: 'Mbeboura', email: 's@x.fr' }
    expect(profileDirty(saved, saved)).toBe(false)
    expect(profileDirty(saved, { ...saved, last_name: 'M' })).toBe(true)
    expect(profileInitials(saved)).toBe('SM')
    expect(profileInitials({ first_name: '', last_name: '', email: 'abc@x.fr' })).toBe('A')
  })
})
