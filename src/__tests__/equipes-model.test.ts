import { describe, expect, it } from 'vitest'
import { fullName, initials, membresDispoForEquipe } from '@/app/(app)/chantiers/equipes/equipesModel'
import type { Equipe } from '@/lib/data/queries/chantiers'
import type { IndividualMember } from '@/lib/data/queries/members'

const membre = (id: string, name: string) => ({ id, name, prenom: null }) as never
const equipe = (id: string, name: string, membres: never[]) => ({ id, name, membres }) as unknown as Equipe

describe('équipes', () => {
  it('compose noms et initiales', () => {
    expect(fullName({ prenom: 'Karim', name: 'Aziz' })).toBe('Karim Aziz')
    expect(fullName({ prenom: null, name: 'Aziz' })).toBe('Aziz')
    expect(initials({ prenom: 'Karim', name: 'Aziz' })).toBe('KA')
    expect(initials({ prenom: null, name: '' })).toBe('?')
  })

  it('propose les solos et les membres des autres équipes, jamais ceux déjà dans l’équipe', () => {
    const a = equipe('a', 'Équipe A', [membre('m1', 'Karim')])
    const b = equipe('b', 'Équipe B', [membre('m2', 'Léa')])
    const solo = [{ id: 's1', name: 'Samuel', prenom: null }, { id: 'm1', name: 'Karim', prenom: null }] as unknown as IndividualMember[]
    const dispo = membresDispoForEquipe([a, b], solo, 'a')
    expect(dispo.map(m => m.id)).toEqual(['s1', 'm2'])
    expect(dispo.find(m => m.id === 'm2')?.equipe_name).toBe('Équipe B')
  })
})
